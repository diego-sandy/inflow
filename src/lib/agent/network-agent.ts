import { toolDescriptors, callTool } from '@/lib/mcp/tools';
import { requestAnthropicViaCompanion } from '@/lib/mcp/bridge-client';
import { runToolAgent, type AgentStep, type AgentTool } from './claude-agent';

/**
 * The in-app Claude agent for AI Chat (Phase 2). Instead of stuffing the network
 * into the prompt, Claude uses inflow's tools (search/get connections, network
 * stats, conversation summaries, create draft) to answer. Runs through the
 * companion (server-side) so it works despite the org's browser/CORS block and
 * keeps the API key out of the browser.
 */

export const AGENT_SYSTEM_PROMPT =
  'You are the user\'s assistant over their LinkedIn network, inside the inflow app. ' +
  'Answer questions and help with outreach using ONLY the provided tools — never guess ' +
  'names, roles, or facts. Search and read before you answer; if a tool returns nothing, ' +
  'say so plainly.\n\n' +
  'Be complete and specific: when a question covers many people, include every relevant ' +
  'one. Format lists as short Markdown bullets (name in **bold**, then a few words of why).\n\n' +
  'You may draft messages with create_draft, which only adds a draft to the user\'s Outbox ' +
  'for them to review and send — you never send anything yourself. Always tell the user when ' +
  'you\'ve created a draft.';

/**
 * Anthropic tool definitions from inflow's MCP toolbox — reading and drafting
 * only. The actions the connector can be allowed (tidy, send, delete) are not
 * offered here: AI Chat answers questions, and its prompt promises it never
 * sends.
 */
export function agentTools(): AgentTool[] {
  return toolDescriptors(['read']).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Record<string, unknown>,
  }));
}

export interface AnswerWithAgentOptions {
  question: string;
  model: string;
  system?: string;
  onStep?: (step: AgentStep) => void;
  maxTokens?: number;
}

/** Answer one question with the Claude tool-use agent, via the companion. */
export async function answerWithClaudeAgent(opts: AnswerWithAgentOptions): Promise<string> {
  const tools = agentTools();
  const system = opts.system ?? AGENT_SYSTEM_PROMPT;

  const callModel = ({ system, messages, tools, maxTokens }: {
    system: string;
    messages: any[];
    tools: AgentTool[];
    maxTokens: number;
  }) =>
    requestAnthropicViaCompanion({
      model: opts.model,
      max_tokens: maxTokens,
      system,
      tools,
      messages,
    });

  return runToolAgent({
    system,
    question: opts.question,
    tools,
    callModel,
    runTool: (name, args) => callTool(name, args, ['read']),
    onStep: opts.onStep,
    maxTokens: opts.maxTokens ?? 8192,
  });
}
