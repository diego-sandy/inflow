/**
 * Deterministic local id for a not-yet-sent "draft" conversation, derived from
 * its recipients. Shared by the New Message composer, the thread ComposeBox, and
 * the Outbox so reopening a draft always resolves to the same placeholder thread.
 */
export function makeDraftConversationId(profileUrns: string[]): string {
  const ids = profileUrns
    .map((urn) => urn.split(':').pop()!)
    .sort()
    .join('+');
  return `draft-${ids}`;
}
