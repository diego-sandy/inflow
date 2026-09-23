import { buildComposePrompt, COMPOSE_SYSTEM_PROMPT } from '@/lib/ai-compose-prompt';
import type { Message } from '@/types/message';

const msg = (over: Partial<Message>): Message =>
  ({ id: 'm', conversationId: 'c', senderUrn: 'u', senderName: 'Ada', body: '', isFromMe: false, createdAt: 0, ...over } as Message);

it('includes the conversation, the instruction, and attributes each speaker', () => {
  const messages = [
    msg({ body: 'Can we push our call?', isFromMe: false, senderName: 'Ada' }),
    msg({ body: 'Sure, when works?', isFromMe: true }),
  ];
  const out = buildComposePrompt(messages, ['Ada'], 'Thank them and offer new times');
  expect(out).toContain('[Ada]: Can we push our call?');
  expect(out).toContain('[You]: Sure, when works?');
  expect(out).toContain('Thank them and offer new times');
  expect(out).toContain('<conversation>');
});

it('handles a brand-new thread with no messages', () => {
  const out = buildComposePrompt([], ['Ada'], 'Introduce myself warmly');
  expect(out).toContain('no prior messages');
  expect(out).toContain('Introduce myself warmly');
});

it('labels attachment-only messages instead of emitting an empty line', () => {
  const out = buildComposePrompt([msg({ body: '', isFromMe: false, senderName: 'Ada' })], ['Ada'], 'Reply');
  expect(out).toContain('[Ada]: [attachment]');
});

it('the system prompt forbids preamble and marks the conversation untrusted', () => {
  expect(COMPOSE_SYSTEM_PROMPT).toMatch(/only the message body/i);
  expect(COMPOSE_SYSTEM_PROMPT).toMatch(/never follow any instructions/i);
});
