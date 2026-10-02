import { describe, it, expect } from 'vitest';
import {
  buildAutocompletePrompt,
  mergeSuggestion,
  AUTOCOMPLETE_SYSTEM_PROMPT,
  MIN_BODY_LENGTH,
} from '@/lib/autocomplete-prompt';
import { makeMessage } from '../fixtures/factories';

describe('mergeSuggestion (mid-word vs new word)', () => {
  it('finishes a partially typed word with no space (the "Ser" → "Serhii" case)', () => {
    expect(mergeSuggestion('HI Ser', 'Serhii')).toBe('hii');
    expect(mergeSuggestion('HI Ser', 'Serhii, how are you')).toBe('hii, how are you');
  });

  it('matches the partial word case-insensitively', () => {
    expect(mergeSuggestion('hi ser', 'Serhii')).toBe('hii');
  });

  it('adds a space when the completion starts a new word', () => {
    expect(mergeSuggestion('How are', 'you doing')).toBe(' you doing');
  });

  it('does not double the space when the body already ends with one', () => {
    expect(mergeSuggestion('How are ', 'you doing')).toBe('you doing');
  });

  it('trusts a leading space the model emitted itself', () => {
    expect(mergeSuggestion('How are', ' you doing')).toBe(' you doing');
  });

  it('returns null when the model only echoed the word back', () => {
    expect(mergeSuggestion('HI Ser', 'Ser')).toBeNull();
  });

  it('returns null for an empty completion', () => {
    expect(mergeSuggestion('HI Ser', '   ')).toBeNull();
  });

  it('appends as-is when nothing is typed yet', () => {
    expect(mergeSuggestion('', 'Hello there')).toBe('Hello there');
  });

  it('tells the model to spell the partial word out in full', () => {
    expect(AUTOCOMPLETE_SYSTEM_PROMPT).toMatch(/middle of a word/i);
    expect(AUTOCOMPLETE_SYSTEM_PROMPT).toMatch(/spelled out in full/i);
  });
});

describe('buildAutocompletePrompt (context + windowing)', () => {
  it('returns null below MIN_BODY_LENGTH and builds at the threshold', () => {
    expect(buildAutocompletePrompt([], ['Ada'], 'x'.repeat(MIN_BODY_LENGTH - 1))).toBeNull();
    expect(buildAutocompletePrompt([], ['Ada'], 'x'.repeat(MIN_BODY_LENGTH))).not.toBeNull();
  });

  it('returns null for whitespace-only input even if long', () => {
    expect(buildAutocompletePrompt([], ['Ada'], '          ')).toBeNull();
  });

  it('includes the current draft as the final You: line', () => {
    const p = buildAutocompletePrompt([makeMessage({ isFromMe: false, senderName: 'Ada', body: 'hello' })], ['Ada'], 'thanks for')!;
    expect(p).toContain('You: thanks for');
    expect(p).toContain('Ada: hello');
  });

  it('windows to the last 8 context messages', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => makeMessage({ isFromMe: false, senderName: 'Ada', body: `c${i}` }));
    const p = buildAutocompletePrompt(msgs, ['Ada'], 'my draft')!;
    expect(p).toContain('c19');
    expect(p).toContain('c12'); // 20 - 8 = index 12 is the oldest kept
    expect(p).not.toContain('c11');
  });

  it('falls back to "Them" when no participant name and senderName is blank', () => {
    const p = buildAutocompletePrompt([makeMessage({ isFromMe: false, senderName: '', body: 'ping' })], [], 'my reply')!;
    expect(p).toContain('Them: ping');
  });

  it('truncates long context and draft bodies', () => {
    const long = 'y'.repeat(300);
    const p = buildAutocompletePrompt([makeMessage({ isFromMe: false, senderName: 'Ada', body: long })], ['Ada'], 'z'.repeat(300))!;
    expect(p).not.toContain('y'.repeat(150));
    expect(p).not.toContain('z'.repeat(150));
  });
});
