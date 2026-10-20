// @vitest-environment jsdom
// A key saved in the browser shows as a hint (first 6 + last 4), says where it
// lives, points to where the full key can be found, and can be replaced in
// place: the old key keeps working until the new one verifies.
import '../dom-setup';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { mockFetch } from '../mocks/fetch';
import { AIKeySettings } from '@/components/settings/AIKeySettings';
import { getGeminiApiKey } from '@/lib/ai-settings';

const OLD = 'AIzaOLD-0000000000000000000001a2b';
const NEW = 'AIzaNEW-0000000000000000000009z8y';

beforeEach(async () => {
  await chrome.storage.local.set({ geminiApiKey: OLD });
});

async function renderSaved() {
  render(<AIKeySettings />);
  return screen.findByLabelText('Saved Gemini key');
}

it('shows only a hint of the saved key, and where it lives', async () => {
  const hint = await renderSaved();
  expect(hint).toHaveTextContent('AIzaOL…1a2b');
  expect(screen.queryByText(OLD)).not.toBeInTheDocument();
  expect(screen.getByText('Active · in this browser')).toBeInTheDocument();
});

it('points to Google AI Studio for the full key', async () => {
  await renderSaved();
  expect(screen.getByRole('link', { name: 'Google AI Studio' })).toHaveAttribute(
    'href',
    'https://aistudio.google.com/apikey',
  );
});

it('replaces the key in place once the new one verifies', async () => {
  mockFetch('generativelanguage.googleapis.com', async () => new Response('{}', { status: 200 }));
  await renderSaved();

  fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
  fireEvent.change(screen.getByPlaceholderText('Paste your new Gemini API key'), { target: { value: NEW } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(screen.getByLabelText('Saved Gemini key')).toHaveTextContent('AIzaNE…9z8y'));
  expect(await getGeminiApiKey()).toBe(NEW);
  // The replace box closes once the new key is in.
  await waitFor(() =>
    expect(screen.queryByPlaceholderText('Paste your new Gemini API key')).not.toBeInTheDocument(),
  );
});

it('keeps the old key when the new one fails to verify', async () => {
  mockFetch('generativelanguage.googleapis.com', async () => new Response('{}', { status: 400 }));
  await renderSaved();

  fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
  fireEvent.change(screen.getByPlaceholderText('Paste your new Gemini API key'), { target: { value: 'typo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await screen.findByText('Invalid API key');
  expect(await getGeminiApiKey()).toBe(OLD);
  expect(screen.getByLabelText('Saved Gemini key')).toHaveTextContent('AIzaOL…1a2b');
});

it('cancel discards what was typed and keeps the old key', async () => {
  await renderSaved();

  fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
  fireEvent.change(screen.getByPlaceholderText('Paste your new Gemini API key'), { target: { value: NEW } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(screen.queryByPlaceholderText('Paste your new Gemini API key')).not.toBeInTheDocument();
  expect(await getGeminiApiKey()).toBe(OLD);

  // Reopening starts empty rather than with the abandoned text.
  fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
  expect(screen.getByPlaceholderText('Paste your new Gemini API key')).toHaveValue('');
});

it('says the Claude key cannot be copied again, and how to get a new one', async () => {
  await chrome.storage.local.set({ anthropicApiKey: 'sk-ant-api03-abcdefgh-wxyz', aiFastProvider: 'anthropic' });
  render(<AIKeySettings />);
  await screen.findByLabelText('Saved Claude key');
  expect(screen.getByText(/only shown once/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'the Anthropic Console' })).toHaveAttribute(
    'href',
    'https://console.anthropic.com/settings/keys',
  );
});

it('closes the replace box even when the new key is the same one', async () => {
  mockFetch('generativelanguage.googleapis.com', async () => new Response('{}', { status: 200 }));
  await renderSaved();

  fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
  fireEvent.change(screen.getByPlaceholderText('Paste your new Gemini API key'), { target: { value: OLD } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() =>
    expect(screen.queryByPlaceholderText('Paste your new Gemini API key')).not.toBeInTheDocument(),
  );
});
