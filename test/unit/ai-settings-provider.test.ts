/**
 * Provider + model-tier settings: defaults, persistence, and model validation.
 */
import { resetChromeMock } from '../mocks/chrome';
import {
  getAIProvider,
  setAIProvider,
  getAnthropicApiKey,
  setAnthropicApiKey,
  clearAnthropicApiKey,
  getAnthropicModel,
  setAnthropicModel,
  DEFAULT_ANTHROPIC_FAST_MODEL,
  DEFAULT_ANTHROPIC_QUALITY_MODEL,
  ANTHROPIC_MODELS,
  getGeminiModel,
  setGeminiModel,
  getTierProvider,
  setTierProvider,
  AI_MODEL_CATALOG,
  DEFAULT_GEMINI_FAST_MODEL,
  DEFAULT_GEMINI_QUALITY_MODEL,
  GEMINI_MODELS,
  getAIChatMaxWords,
  setAIChatMaxWords,
  getAIChatInstructions,
  setAIChatInstructions,
  DEFAULT_CHAT_MAX_WORDS,
  CHAT_MAX_WORDS_MAX,
  getChatPrompts,
  setChatPrompts,
  DEFAULT_CHAT_PROMPTS,
  normalizeChatPrompts,
  CHAT_PROMPTS_MAX,
} from '@/lib/ai-settings';

beforeEach(() => {
  resetChromeMock();
});

describe('AI provider setting', () => {
  it('defaults to gemini and round-trips anthropic', async () => {
    expect(await getAIProvider()).toBe('gemini');
    await setAIProvider('anthropic');
    expect(await getAIProvider()).toBe('anthropic');
  });

  it('falls back to gemini for an unknown stored value', async () => {
    await chrome.storage.local.set({ aiProvider: 'openai' as any });
    expect(await getAIProvider()).toBe('gemini');
  });
});

describe('Anthropic API key', () => {
  it('round-trips and clears', async () => {
    expect(await getAnthropicApiKey()).toBeNull();
    await setAnthropicApiKey('sk-ant-123');
    expect(await getAnthropicApiKey()).toBe('sk-ant-123');
    await clearAnthropicApiKey();
    expect(await getAnthropicApiKey()).toBeNull();
  });
});

describe('Anthropic model tiers', () => {
  it('defaults fast → Haiku and quality → Sonnet', async () => {
    expect(await getAnthropicModel('fast')).toBe(DEFAULT_ANTHROPIC_FAST_MODEL);
    expect(await getAnthropicModel('quality')).toBe(DEFAULT_ANTHROPIC_QUALITY_MODEL);
    expect(DEFAULT_ANTHROPIC_FAST_MODEL).toBe('claude-haiku-4-5');
    expect(DEFAULT_ANTHROPIC_QUALITY_MODEL).toBe('claude-sonnet-5');
  });

  it('persists a chosen model per tier independently', async () => {
    await setAnthropicModel('fast', 'claude-sonnet-5');
    await setAnthropicModel('quality', 'claude-opus-5');
    expect(await getAnthropicModel('fast')).toBe('claude-sonnet-5');
    expect(await getAnthropicModel('quality')).toBe('claude-opus-5');
  });

  it('ignores an unknown model id on write and falls back on read', async () => {
    await setAnthropicModel('fast', 'gpt-5' as any);
    expect(await getAnthropicModel('fast')).toBe(DEFAULT_ANTHROPIC_FAST_MODEL);

    await chrome.storage.local.set({ anthropicQualityModel: 'bogus-model' });
    expect(await getAnthropicModel('quality')).toBe(DEFAULT_ANTHROPIC_QUALITY_MODEL);
  });

  it('offers Haiku, Sonnet, and Opus in the picker, cheapest first', () => {
    expect(ANTHROPIC_MODELS.map((m) => m.id)).toEqual([
      'claude-haiku-4-5',
      'claude-sonnet-5',
      'claude-opus-5',
    ]);
  });
});

describe('Gemini model tiers', () => {
  it('defaults both tiers to Flash-Lite (unchanged from the original single model)', async () => {
    expect(await getGeminiModel('fast')).toBe(DEFAULT_GEMINI_FAST_MODEL);
    expect(await getGeminiModel('quality')).toBe(DEFAULT_GEMINI_QUALITY_MODEL);
    expect(DEFAULT_GEMINI_FAST_MODEL).toBe('gemini-3.1-flash-lite');
    expect(DEFAULT_GEMINI_QUALITY_MODEL).toBe('gemini-3.1-flash-lite');
  });

  it('persists a chosen model per tier independently', async () => {
    await setGeminiModel('fast', 'gemini-3.5-flash');
    await setGeminiModel('quality', 'gemini-3.5-flash');
    expect(await getGeminiModel('fast')).toBe('gemini-3.5-flash');
    expect(await getGeminiModel('quality')).toBe('gemini-3.5-flash');
  });

  it('ignores an unknown model id on write and falls back on read', async () => {
    await setGeminiModel('fast', 'gpt-5' as any);
    expect(await getGeminiModel('fast')).toBe(DEFAULT_GEMINI_FAST_MODEL);

    await chrome.storage.local.set({ geminiQualityModel: 'bogus-model' });
    expect(await getGeminiModel('quality')).toBe(DEFAULT_GEMINI_QUALITY_MODEL);
  });

  it('offers Flash-Lite, Flash, and Pro in the picker, cheapest first', () => {
    expect(GEMINI_MODELS.map((m) => m.id)).toEqual([
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.1-pro-preview',
    ]);
  });
});

describe('AI Chat advanced settings', () => {
  it('defaults to no target and round-trips a clamped value', async () => {
    expect(await getAIChatMaxWords()).toBe(DEFAULT_CHAT_MAX_WORDS); // 0 = no target
    await setAIChatMaxWords(999999);
    expect(await getAIChatMaxWords()).toBe(CHAT_MAX_WORDS_MAX);
    await setAIChatMaxWords(-100);
    expect(await getAIChatMaxWords()).toBe(0);
    await setAIChatMaxWords(1500);
    expect(await getAIChatMaxWords()).toBe(1500);
  });

  it('round-trips custom instructions (default empty)', async () => {
    expect(await getAIChatInstructions()).toBe('');
    await setAIChatInstructions('Answer in bullets.');
    expect(await getAIChatInstructions()).toBe('Answer in bullets.');
  });
});

describe('per-tier provider selection', () => {
  it('defaults each tier to the legacy provider (gemini) and round-trips per tier', async () => {
    expect(await getTierProvider('fast')).toBe('gemini');
    expect(await getTierProvider('quality')).toBe('gemini');
    await setTierProvider('quality', 'anthropic');
    expect(await getTierProvider('quality')).toBe('anthropic');
    expect(await getTierProvider('fast')).toBe('gemini'); // independent
  });

  it('migrates from the old single provider when a tier is unset', async () => {
    await setAIProvider('anthropic');
    expect(await getTierProvider('fast')).toBe('anthropic');
    await setTierProvider('fast', 'gemini'); // explicit overrides the legacy fallback
    expect(await getTierProvider('fast')).toBe('gemini');
  });

  it('the model catalog covers both providers and tags recommendations', () => {
    expect(AI_MODEL_CATALOG.some((m) => m.provider === 'gemini')).toBe(true);
    expect(AI_MODEL_CATALOG.some((m) => m.provider === 'anthropic')).toBe(true);
    expect(AI_MODEL_CATALOG.some((m) => m.recommendedFor === 'fast')).toBe(true);
    expect(AI_MODEL_CATALOG.some((m) => m.recommendedFor === 'quality')).toBe(true);
  });
});

describe('editable chat starter questions', () => {
  it('defaults until customized, then round-trips a cleaned list', async () => {
    expect(await getChatPrompts()).toEqual(DEFAULT_CHAT_PROMPTS);
    await setChatPrompts(['  Who should I reconnect with?  ', '', 'Any new founders?']);
    expect(await getChatPrompts()).toEqual(['Who should I reconnect with?', 'Any new founders?']);
  });

  it('normalizes: trims, drops blanks, bounds count', () => {
    expect(normalizeChatPrompts(null)).toEqual(DEFAULT_CHAT_PROMPTS);
    expect(normalizeChatPrompts([' a ', '  ', 'b'])).toEqual(['a', 'b']);
    const many = Array.from({ length: CHAT_PROMPTS_MAX + 5 }, (_, i) => `q${i}`);
    expect(normalizeChatPrompts(many)).toHaveLength(CHAT_PROMPTS_MAX);
  });
});
