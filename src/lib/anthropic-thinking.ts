/**
 * The thinking settings for a single-shot Claude request (drafts, summaries,
 * tagging), per model. inflow wants the answer, not deliberation, and thinking
 * counts against `max_tokens`, so a small cap left to an always-thinking model
 * can be spent before any text. Each line turns it down differently, per
 * Anthropic's effort and thinking docs:
 *
 *  - Haiku 5.5 (and the Claude 5 models): `thinking: {type: "disabled"}`.
 *  - Sonnet 5.5: rejects "disabled" with a 400; its lowest setting is
 *    `thinking: {type: "between_tools"}`, which skips up-front thinking (and
 *    these requests use no tools).
 *  - Opus 5.5, Fable: thinking is always on and "disabled" is a 400 at every
 *    effort level, so leave `thinking` out, ask for low effort, and leave room
 *    in `max_tokens` for the thinking it still does.
 *  - Haiku 4.5: thinking is off by default; send nothing.
 *
 * Unknown models get nothing extra, which runs Anthropic's default (adaptive
 * thinking) rather than risking a setting the model rejects.
 */
export interface AnthropicRequestShape {
  maxTokens: number;
  /** Fields to spread into the request body. */
  extra: Record<string, unknown>;
}

/** Headroom for the thinking an always-thinking model does even at low effort. */
const ALWAYS_THINKING_ROOM = 4096;

export function anthropicRequestShape(model: string, maxTokens: number): AnthropicRequestShape {
  if (/^claude-(opus-5-5|fable-|mythos-)/.test(model)) {
    return { maxTokens: maxTokens + ALWAYS_THINKING_ROOM, extra: { output_config: { effort: 'low' } } };
  }
  if (/^claude-sonnet-5-5/.test(model)) {
    return { maxTokens, extra: { thinking: { type: 'between_tools' } } };
  }
  if (/^claude-haiku-4-5/.test(model)) {
    return { maxTokens, extra: {} };
  }
  if (/^claude-(haiku-5-5|sonnet-5|opus-5)(-|$)/.test(model)) {
    return { maxTokens, extra: { thinking: { type: 'disabled' } } };
  }
  return { maxTokens, extra: {} };
}
