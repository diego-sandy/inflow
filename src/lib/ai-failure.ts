import { debugLog } from './debug-log';

/**
 * Why an AI call produced no text, in words a user can act on.
 *
 * Every provider path used to catch its errors and return null, so a rate
 * limit, a bad key, a safety block, an unreachable connector and a model that
 * spent its whole budget thinking all surfaced as the same "the AI returned
 * nothing". These describe the actual cause; callers log it and can show it.
 */

export type AIFailureReporter = (reason: string) => void;

/** Log a failure (so it shows in the debug panel) and pass it on to the caller. */
export function reportAIFailure(onFailure: AIFailureReporter | undefined, reason: string): void {
  debugLog('warn', `[AI] ${reason}`);
  onFailure?.(reason);
}

/** A failed HTTP response from Gemini or Anthropic, with the provider's own message when it gives one. */
export function describeHttpFailure(provider: 'Gemini' | 'Claude', status: number, detail?: string): string {
  const base =
    status === 400
      ? `${provider} rejected the request`
      : status === 401 || status === 403
        ? `${provider} refused the key`
        : status === 404
          ? `${provider} doesn't recognise the model`
          : status === 429
            ? `${provider} is rate-limiting requests; wait a minute and try again`
            : status >= 500
              ? `${provider} is having trouble (error ${status}); try again shortly`
              : `${provider} returned error ${status}`;
  return detail ? `${base}: ${detail}` : base;
}

/**
 * A Gemini response with no text, explained from its finish/block reason.
 * `MAX_TOKENS` with no text means the model's thinking used up the output
 * budget before it wrote anything.
 */
export function describeEmptyGemini(finishReason?: string, blockReason?: string): string {
  if (blockReason) return `Gemini blocked the request (${blockReason.toLowerCase()})`;
  switch (finishReason) {
    case 'MAX_TOKENS':
      return 'Gemini ran out of room before writing anything';
    case 'SAFETY':
    case 'PROHIBITED_CONTENT':
    case 'BLOCKLIST':
    case 'SPII':
      return "Gemini's safety filter stopped the answer";
    case 'RECITATION':
      return 'Gemini stopped because the answer resembled existing text';
    default:
      return finishReason ? `Gemini returned no text (finish reason: ${finishReason})` : 'Gemini returned no text';
  }
}

/** An Anthropic response with no text, explained from its stop reason. */
export function describeEmptyAnthropic(stopReason?: string): string {
  if (stopReason === 'max_tokens') return 'Claude ran out of room before writing anything';
  if (stopReason === 'refusal') return 'Claude declined to write this';
  return stopReason ? `Claude returned no text (stop reason: ${stopReason})` : 'Claude returned no text';
}
