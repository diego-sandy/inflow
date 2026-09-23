import { getAIComposeHideWhenUnavailable, setAIComposeHideWhenUnavailable } from '@/lib/ai-settings';

beforeEach(async () => {
  await chrome.storage.local.remove('aiComposeHideWhenUnavailable');
});

it('defaults to false (show the button, greyed, when unavailable)', async () => {
  expect(await getAIComposeHideWhenUnavailable()).toBe(false);
});

it('persists true and reads it back', async () => {
  await setAIComposeHideWhenUnavailable(true);
  expect(await getAIComposeHideWhenUnavailable()).toBe(true);
  await setAIComposeHideWhenUnavailable(false);
  expect(await getAIComposeHideWhenUnavailable()).toBe(false);
});
