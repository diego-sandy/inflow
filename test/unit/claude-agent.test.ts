// The Claude tool-use loop: drive the model, run requested tools, feed results
// back, and stop on the final answer or the step budget.
import { runToolAgent, type CallModel, type RunTool } from '@/lib/agent/claude-agent';

const tools = [{ name: 'search_connections', description: 'search', input_schema: { type: 'object' } }];

function textMsg(text: string) {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn' };
}
function toolMsg(id: string, name: string, input: any) {
  return { content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' };
}

it('returns the answer directly when the model uses no tools', async () => {
  const callModel: CallModel = vi.fn().mockResolvedValue(textMsg('Here you go.'));
  const runTool: RunTool = vi.fn();
  const out = await runToolAgent({ system: 's', question: 'hi', tools, callModel, runTool });
  expect(out).toBe('Here you go.');
  expect(runTool).not.toHaveBeenCalled();
  expect(callModel).toHaveBeenCalledTimes(1);
});

it('runs a requested tool, feeds the result back, then answers', async () => {
  const callModel: CallModel = vi
    .fn()
    .mockResolvedValueOnce(toolMsg('tu1', 'search_connections', { query: 'investor' }))
    .mockResolvedValueOnce(textMsg('Found 3 investors.'));
  const runTool: RunTool = vi.fn().mockResolvedValue([{ name: 'Ada' }]);
  const steps: string[] = [];

  const out = await runToolAgent({
    system: 's', question: 'who are my investors?', tools, callModel, runTool,
    onStep: (s) => steps.push(s.tool),
  });

  expect(out).toBe('Found 3 investors.');
  expect(runTool).toHaveBeenCalledWith('search_connections', { query: 'investor' });
  expect(steps).toEqual(['search_connections']);
  // Second model call must include the tool_result fed back as a user turn.
  const secondMessages = (callModel as any).mock.calls[1][0].messages;
  const toolResultTurn = secondMessages.find((m: any) => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result');
  expect(toolResultTurn.content[0].tool_use_id).toBe('tu1');
});

it('feeds a tool error back (is_error) and keeps going', async () => {
  const callModel: CallModel = vi
    .fn()
    .mockResolvedValueOnce(toolMsg('tu1', 'search_connections', {}))
    .mockResolvedValueOnce(textMsg('Handled the error.'));
  const runTool: RunTool = vi.fn().mockRejectedValue(new Error('boom'));

  const out = await runToolAgent({ system: 's', question: 'q', tools, callModel, runTool });
  expect(out).toBe('Handled the error.');
  const secondMessages = (callModel as any).mock.calls[1][0].messages;
  const res = secondMessages
    .find((m: any) => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result')
    .content[0];
  expect(res.is_error).toBe(true);
  expect(res.content).toContain('boom');
});

it('stops at the step budget', async () => {
  // Always asks for a tool → never terminates on its own.
  const callModel: CallModel = vi.fn().mockResolvedValue(toolMsg('tu', 'search_connections', {}));
  const runTool: RunTool = vi.fn().mockResolvedValue({});
  const out = await runToolAgent({ system: 's', question: 'q', tools, callModel, runTool, maxSteps: 3 });
  expect((callModel as any).mock.calls.length).toBe(3);
  expect(out).toMatch(/ran out of steps/i);
});
