// The Claude tool-use loop: drive the model, run requested tools, feed results
// back, and stop on the final answer or the step budget.
import { runToolAgent, historyMessages, type CallModel, type RunTool } from '@/lib/agent/claude-agent';

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

describe('conversation history', () => {
  it('puts earlier turns before the new question', async () => {
    const callModel: CallModel = vi.fn().mockResolvedValue(textMsg('Sam.'));
    await runToolAgent({
      system: 's', question: 'which one is in Boston?', tools, callModel, runTool: vi.fn(),
      history: [
        { role: 'user', content: 'who are my investors?' },
        { role: 'assistant', content: 'Dana and Sam.' },
      ],
    });
    expect((callModel as any).mock.calls[0][0].messages.slice(0, 3)).toEqual([
      { role: 'user', content: 'who are my investors?' },
      { role: 'assistant', content: 'Dana and Sam.' },
      { role: 'user', content: 'which one is in Boston?' },
    ]);
  });

  it('keeps the most recent turns that fit the budget', () => {
    const out = historyMessages(
      [
        { role: 'user', content: 'x'.repeat(50) },
        { role: 'assistant', content: 'y'.repeat(50) },
        { role: 'user', content: 'recent question' },
        { role: 'assistant', content: 'recent answer' },
      ],
      40,
    );
    expect(out).toEqual([
      { role: 'user', content: 'recent question' },
      { role: 'assistant', content: 'recent answer' },
    ]);
  });

  it('merges same-role neighbours, skips empties, and starts on a user turn', () => {
    const out = historyMessages([
      { role: 'assistant', content: 'stray' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: '  ' },
      { role: 'user', content: 'second' },
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'first\n\nsecond' },
      { role: 'assistant', content: '(no answer)' },
    ]);
  });
});
