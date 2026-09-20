// The inbox tab labels: Focused/Other are user-renamable (default Primary/InMail);
// Archive/Spam/Drafts/Scheduled are fixed.
import { tabLabel, normalizeInboxLabels, DEFAULT_INBOX_LABELS } from '@/lib/inbox-labels';

describe('inbox labels', () => {
  it('defaults to Primary / InMail', () => {
    expect(DEFAULT_INBOX_LABELS).toEqual({ focused: 'Primary', other: 'InMail' });
  });

  it('resolves renamable tabs from the given labels', () => {
    const labels = { focused: 'Clients', other: 'Recruiters' };
    expect(tabLabel('focused', labels)).toBe('Clients');
    expect(tabLabel('other', labels)).toBe('Recruiters');
  });

  it('keeps the fixed tabs fixed regardless of overrides', () => {
    const labels = { focused: 'A', other: 'B' };
    expect(tabLabel('archived', labels)).toBe('Archive');
    expect(tabLabel('spam', labels)).toBe('Spam');
    expect(tabLabel('drafts', labels)).toBe('Drafts');
    expect(tabLabel('scheduled', labels)).toBe('Scheduled');
  });

  it('falls back to the default when a custom label is blank', () => {
    expect(tabLabel('focused', { focused: '   ', other: 'X' })).toBe('Primary');
    expect(tabLabel('other', { focused: 'X', other: '' })).toBe('InMail');
  });

  it('normalizes partial / empty stored data to a complete set', () => {
    expect(normalizeInboxLabels(null)).toEqual(DEFAULT_INBOX_LABELS);
    expect(normalizeInboxLabels({ focused: 'Leads' })).toEqual({ focused: 'Leads', other: 'InMail' });
    expect(normalizeInboxLabels({ focused: '  ', other: '  ' })).toEqual(DEFAULT_INBOX_LABELS);
  });
});
