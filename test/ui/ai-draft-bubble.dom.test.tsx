// @vitest-environment jsdom
// The pending AI draft bubble in the thread: shows "not sent", streams while
// generating, and offers Approve / Regenerate / Discard once there's a draft.
import '../dom-setup';

import { render, screen, fireEvent } from '@testing-library/react';
import { AiDraftBubble } from '@/components/thread/AiDraftBubble';
import type { AiComposeApi } from '@/hooks/useAiCompose';

function mockAi(over: Partial<AiComposeApi> = {}): AiComposeApi {
  return {
    available: true, hideWhenUnavailable: false, enabled: true, instruction: '', draft: null, status: 'idle', error: null,
    setEnabled: vi.fn(), setInstruction: vi.fn(), generate: vi.fn(), approve: vi.fn(), discard: vi.fn(),
    ...over,
  };
}

it('while generating with no text yet, shows a thinking state and no actions', () => {
  render(<AiDraftBubble ai={mockAi({ status: 'generating', draft: '' })} />);
  expect(screen.getByText(/AI is writing/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Approve/i })).not.toBeInTheDocument();
});

it('with a finished draft, offers Approve / Regenerate / Discard and wires them', () => {
  const ai = mockAi({ status: 'idle', draft: 'Hi Ada — happy to reschedule.' });
  render(<AiDraftBubble ai={ai} />);
  expect(screen.getByText('Hi Ada — happy to reschedule.')).toBeInTheDocument();
  expect(screen.getByText(/not sent/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Approve/i }));
  expect(ai.approve).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Regenerate/i }));
  expect(ai.generate).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Discard/i }));
  expect(ai.discard).toHaveBeenCalled();
});

it('on error, shows the reason and a Try again (no Approve)', () => {
  const ai = mockAi({ status: 'error', draft: null, error: 'Companion not connected.' });
  render(<AiDraftBubble ai={ai} />);
  expect(screen.getByText('Companion not connected.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Approve/i })).not.toBeInTheDocument();
});
