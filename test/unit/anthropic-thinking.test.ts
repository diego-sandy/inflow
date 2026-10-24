/**
 * Each Claude model gets the thinking setting that turns it down furthest
 * without being rejected (per Anthropic's effort and thinking docs), and the
 * direct browser call actually sends it. A wrong setting is a 400 on every
 * draft: Sonnet 5.5 and Opus 5.5 reject thinking "disabled".
 */
import { anthropicRequestShape } from '@/lib/anthropic-thinking';
import { predictAnthropic } from '@/lib/anthropic-client';
import { ANTHROPIC_MODELS } from '@/lib/ai-settings';

describe('anthropicRequestShape', () => {
  it('turns thinking off on Haiku 5.5', () => {
    expect(anthropicRequestShape('claude-haiku-5-5', 512)).toEqual({ maxTokens: 512, extra: { thinking: { type: 'disabled' } } });
  });

  it('uses between_tools on Sonnet 5.5, which rejects "disabled"', () => {
    expect(anthropicRequestShape('claude-sonnet-5-5', 512)).toEqual({ maxTokens: 512, extra: { thinking: { type: 'between_tools' } } });
  });

  it('asks Opus 5.5 for low effort, sends no thinking field, and leaves room for its thinking', () => {
    const shape = anthropicRequestShape('claude-opus-5-5', 512);
    expect(shape.extra).toEqual({ output_config: { effort: 'low' } });
    expect(shape.extra).not.toHaveProperty('thinking');
    expect(shape.maxTokens).toBeGreaterThan(512);
  });

  it('keeps the earlier models working: Haiku 4.5 sends nothing, Sonnet and Opus 5 disable thinking', () => {
    expect(anthropicRequestShape('claude-haiku-4-5', 512).extra).toEqual({});
    expect(anthropicRequestShape('claude-sonnet-5', 512).extra).toEqual({ thinking: { type: 'disabled' } });
    expect(anthropicRequestShape('claude-opus-5', 512).extra).toEqual({ thinking: { type: 'disabled' } });
  });

  it('sends nothing extra for a model it does not know, rather than risk a rejected setting', () => {
    expect(anthropicRequestShape('claude-something-9', 512)).toEqual({ maxTokens: 512, extra: {} });
  });

  it('has a setting for every model inflow offers', () => {
    for (const m of ANTHROPIC_MODELS) {
      const { extra } = anthropicRequestShape(m.id, 512);
      // "disabled" only where the model accepts it.
      if (/sonnet-5-5|opus-5-5/.test(m.id)) expect(extra).not.toEqual({ thinking: { type: 'disabled' } });
      expect(Object.keys(extra).length).toBeGreaterThan(0);
    }
  });
});

describe('the direct call sends it', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const body = () => JSON.parse(fetchMock.mock.calls[0][1].body);

  it.each([
    ['claude-haiku-5-5', { thinking: { type: 'disabled' } }],
    ['claude-sonnet-5-5', { thinking: { type: 'between_tools' } }],
    ['claude-opus-5-5', { output_config: { effort: 'low' } }],
  ])('%s', async (model, expected) => {
    await predictAnthropic('hi', 'sk-ant-test', model, { maxTokens: 512 });
    expect(body()).toMatchObject({ model, ...expected });
  });
});
