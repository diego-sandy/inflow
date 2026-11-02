/**
 * Phase 2 — the Claude tool-use loop (provider transport injected).
 *
 * Pure and transport-free so it's unit-testable: given a `callModel` that runs
 * one Anthropic Messages request and a `runTool` that executes a tool, it drives
 * the agent loop — call the model, run any requested tools, feed the results
 * back, repeat — until Claude answers or the step budget runs out.
 *
 * inflow's tools are read-only except `create_draft` (adds an Outbox draft the
 * user reviews and sends). Nothing here ever sends a message.
 */

/** An Anthropic tool definition ({name, description, input_schema}). */
export interface AgentTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** A single tool invocation, surfaced for the live step UI. */
export interface AgentStep {
  tool: string;
  input: Record<string, any>;
}

/** One Messages API call. Returns the parsed Anthropic message (content + stop_reason). */
export type CallModel = (req: {
  system: string;
  messages: any[];
  tools: AgentTool[];
  maxTokens: number;
}) => Promise<{ content?: any[]; stop_reason?: string } | null>;

export type RunTool = (name: string, input: Record<string, any>) => Promise<unknown>;

/** An earlier turn of the same chat, as the transcript saved it. */
export interface PriorTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** How much of the earlier conversation goes along with a question, in characters. */
export const HISTORY_CHAR_BUDGET = 40000;

export interface RunAgentOptions {
  system: string;
  question: string;
  /** The chat so far, oldest first, so a follow-up can lean on what was said. */
  history?: PriorTurn[];
  tools: AgentTool[];
  callModel: CallModel;
  runTool: RunTool;
  /** Called before each tool runs (for live status). */
  onStep?: (step: AgentStep) => void;
  /** Max model round-trips before we stop looping. */
  maxSteps?: number;
  /** Output-token cap per model call. */
  maxTokens?: number;
}

function textOf(content: any[]): string {
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

/**
 * The earlier turns as Messages API turns. Only the text survives from past
 * turns (the tool calls behind an answer aren't saved), which is enough for
 * Claude to know who "they" or "the second one" is. Keeps the most recent
 * turns that fit the budget, merges same-role neighbours (a failed turn leaves
 * two questions in a row) and starts on a user turn, as the API requires.
 */
export function historyMessages(history: PriorTurn[] = [], budget = HISTORY_CHAR_BUDGET): any[] {
  const kept: PriorTurn[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    const text = typeof turn?.content === 'string' ? turn.content.trim() : '';
    if (!text || (turn.role !== 'user' && turn.role !== 'assistant')) continue;
    if (used + text.length > budget) break;
    used += text.length;
    kept.unshift({ role: turn.role, content: text });
  }
  const merged: PriorTurn[] = [];
  for (const turn of kept) {
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) last.content += `\n\n${turn.content}`;
    else merged.push({ ...turn });
  }
  while (merged.length && merged[0].role !== 'user') merged.shift();
  // The new question follows as a user turn, so the history must end on Claude's.
  if (merged.length && merged[merged.length - 1].role === 'user') {
    merged.push({ role: 'assistant', content: '(no answer)' });
  }
  return merged;
}

/**
 * Run the agent loop and return the final answer text. Throws if the model
 * transport rejects (surfaced to the caller for a friendly error).
 */
export async function runToolAgent(opts: RunAgentOptions): Promise<string> {
  const { system, question, tools, callModel, runTool, onStep } = opts;
  const maxSteps = opts.maxSteps ?? 6;
  const maxTokens = opts.maxTokens ?? 8192;

  const messages: any[] = [...historyMessages(opts.history), { role: 'user', content: question }];
  let lastText = '';

  for (let step = 0; step < maxSteps; step++) {
    const res = await callModel({ system, messages, tools, maxTokens });
    const content = Array.isArray(res?.content) ? res!.content : [];
    messages.push({ role: 'assistant', content });

    const toolUses = content.filter((b: any) => b?.type === 'tool_use');
    lastText = textOf(content) || lastText;

    // Claude wants to use tools → run them locally and feed results back.
    if (res?.stop_reason === 'tool_use' && toolUses.length > 0) {
      const results: any[] = [];
      for (const tu of toolUses) {
        const input = (tu.input && typeof tu.input === 'object' ? tu.input : {}) as Record<string, any>;
        onStep?.({ tool: tu.name, input });
        let out: unknown;
        let isError = false;
        try {
          out = await runTool(tu.name, input);
        } catch (e: any) {
          out = { error: e?.message || 'tool failed' };
          isError = true;
        }
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: typeof out === 'string' ? out : JSON.stringify(out),
          ...(isError ? { is_error: true } : {}),
        });
      }
      messages.push({ role: 'user', content: results });
      continue;
    }

    // No tool use → this is the answer.
    return lastText;
  }

  // Step budget exhausted — return whatever text we have, or a clear note.
  return lastText || 'I ran out of steps before finishing. Try a more specific question.';
}
