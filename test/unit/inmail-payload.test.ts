/**
 * InMail payload shape, pinned against a capture from LinkedIn's own web client.
 *
 * InMail reaches a non-connection and spends one of the account's InMail
 * credits, so a wrong payload is not a retryable error: it is wasted outreach.
 * It rides the SAME endpoint as an ordinary new conversation and differs in
 * exactly three ways, all asserted here.
 */
const mockVoyagerFetch = vi.fn();

vi.mock('../../entrypoints/background/api/client', () => ({
  voyagerFetch: mockVoyagerFetch,
}));
vi.mock('../../entrypoints/background/auth/session', () => ({
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));
vi.mock('../../entrypoints/background/api/conversations', () => ({
  findConversationByRecipients: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

beforeEach(() => {
  mockVoyagerFetch.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({ value: { conversationUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:SELF,2-abc)' } }),
  });
});

/** The JSON body of the single voyagerFetch call. */
function sentPayload() {
  const [, init] = mockVoyagerFetch.mock.calls[0];
  return JSON.parse(init.body);
}

const RECIPIENT = 'urn:li:fsd_profile:RECIPIENT';

it('sends an InMail on the same endpoint as any new conversation', async () => {
  const { createConversation } = await import('../../entrypoints/background/api/messages');
  await createConversation([RECIPIENT], 'hello', undefined, { subject: 'Working smarter' });
  expect(mockVoyagerFetch.mock.calls[0][0]).toBe('/voyagerMessagingDashMessengerMessages?action=createMessage');
});

it('carries the subject, the premiumInMail marker, and omits `recipients`', async () => {
  const { createConversation } = await import('../../entrypoints/background/api/messages');
  await createConversation([RECIPIENT], 'hello', undefined, { subject: 'Working smarter' });
  const p = sentPayload();

  expect(p.message.subject).toBe('Working smarter');
  expect(p.hostMessageCreateContent).toEqual({
    'com.linkedin.voyager.dash.messaging.MessageCreateContent': {
      messageCreateContentUnion: { premiumInMail: {} },
    },
  });
  expect(p.hostRecipientUrns).toEqual([RECIPIENT]);
  // LinkedIn's InMail payload has no `recipients`; sending a superset risks
  // rejection, and a rejected InMail is wasted outreach rather than a retry.
  expect(p).not.toHaveProperty('recipients');
});

it('leaves an ordinary new conversation exactly as it was', async () => {
  const { createConversation } = await import('../../entrypoints/background/api/messages');
  await createConversation([RECIPIENT], 'hello');
  const p = sentPayload();

  expect(p.recipients).toEqual([RECIPIENT]);
  expect(p.hostRecipientUrns).toEqual([RECIPIENT]);
  expect(p).not.toHaveProperty('hostMessageCreateContent');
  expect(p.message).not.toHaveProperty('subject');
});

it('keeps the shared fields identical between the two', async () => {
  const { createConversation } = await import('../../entrypoints/background/api/messages');
  await createConversation([RECIPIENT], 'hello', undefined, { subject: 's' });
  const p = sentPayload();

  expect(p.mailboxUrn).toBe('urn:li:fsd_profile:SELF');
  expect(p.dedupeByClientGeneratedToken).toBe(false);
  expect(p.message.body).toEqual({ attributes: [], text: 'hello' });
  expect(p.message.renderContentUnions).toEqual([]);
  expect(typeof p.message.originToken).toBe('string');
  // 16 raw bytes as a string, as the web client sends.
  expect(p.trackingId).toHaveLength(16);
});
