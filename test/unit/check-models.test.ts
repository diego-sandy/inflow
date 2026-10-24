/**
 * The release check for AI models (scripts/check-models.mjs). It reads the
 * providers' public lifecycle pages, as Markdown, and compares them with the
 * models inflow offers. Only a model that no longer works blocks a release;
 * deprecations, replacements and newer models are warnings.
 *
 * These use excerpts of the real tables, so they need no network.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  readCatalog,
  parseAnthropic,
  parseGemini,
  checkAnthropic,
  checkGemini,
  anthropicLine,
  geminiLine,
} from '../../scripts/check-models.mjs';

const ANTHROPIC = `
| API model name             | Current state | Deprecated         | Tentative retirement date          |
| :------------------------- | :------------ | :----------------- | :--------------------------------- |
| claude-opus-5-5            | Active        | N/A                | Not sooner than September 22, 2027 |
| claude-opus-5              | Active        | N/A                | Not sooner than July 24, 2027      |
| claude-sonnet-5-5          | Active        | N/A                | Not sooner than September 28, 2027 |
| claude-sonnet-5            | Active        | N/A                | Not sooner than June 30, 2027      |
| claude-sonnet-4-5-20250929 | Deprecated    | September 30, 2026 | November 30, 2026                  |
| claude-sonnet-4-20250514   | Retired       | April 14, 2026     | June 15, 2026                      |
| claude-haiku-5-5           | Active        | N/A                | Not sooner than October 7, 2027    |
| claude-haiku-4-5-20251001  | Active        | N/A                | Not sooner than October 15, 2026   |
`;

const GEMINI = `
| **Model** | **Release date** | **Shutdown date** | **Recommended replacement** |
|---|---|---|---|
| \`gemini-3.8-flash\` | September 2, 2026 | No shutdown date announced |   |
| \`gemini-3.7-flash\` | August 13, 2026 | N/A | \`gemini-3.8-flash\` (not available to select in Google AI Studio; the endpoint is not shutting down and automatically routes API requests to \`gemini-3.8-flash\`) |
| \`gemini-3.6-flash\` | July 21, 2026 | No shutdown date announced |   |
| \`gemini-3.5-flash-lite\` | July 21, 2026 | No shutdown date announced |   |
| \`gemini-3.5-flash\` | May 19, 2026 | N/A | \`gemini-3.6-flash\` (not available to select in Google AI Studio; the endpoint is not shutting down and automatically routes API requests to \`gemini-3.6-flash\`) |
| \`gemini-3.1-flash-lite\` | May 7, 2026 | May 7, 2027 | \`gemini-3.5-flash-lite\` |
| \`gemini-3.8-flash-tts\` | September 22, 2026 | No shutdown date announced |   |
| \`gemini-3.1-pro-preview\` | February 19, 2026 | No shutdown date announced |   |
| \`gemini-2.0-flash\` | February 5, 2025 | June 1, 2026 | \`gemini-3.6-flash\` |
`;

const TODAY = new Date('2026-10-24T12:00:00Z');
const messages = (findings: { level: string; id: string; message: string }[]) =>
  findings.map((f) => `${f.level} ${f.id}: ${f.message}`);

describe('reading inflow’s own list', () => {
  it('finds every model offered in ai-settings.ts', () => {
    const src = readFileSync(resolve(__dirname, '../../src/lib/ai-settings.ts'), 'utf8');
    const catalog = readCatalog(src);
    expect(catalog.anthropic.length).toBeGreaterThanOrEqual(3);
    expect(catalog.gemini.length).toBeGreaterThanOrEqual(3);
    expect(catalog.anthropic.every((id: string) => id.startsWith('claude-'))).toBe(true);
    // The superseded-id map isn't an offered model.
    expect(catalog.gemini).not.toContain('gemini-3.5-flash');
  });
});

describe('Anthropic', () => {
  const table = parseAnthropic(ANTHROPIC);

  it('parses the status table, header and divider excluded', () => {
    expect(table.size).toBe(8);
    expect(table.get('claude-sonnet-4-20250514')).toMatchObject({ status: 'Retired' });
  });

  it('matches an alias to its dated id, and flags a passed earliest-retirement date', () => {
    expect(messages(checkAnthropic(['claude-haiku-4-5'], table, TODAY))).toEqual([
      'warn claude-haiku-4-5: its earliest retirement date (October 15, 2026) has passed; it can now be retired with notice',
      'warn claude-haiku-4-5: a newer haiku is available: claude-haiku-5-5',
    ]);
  });

  it('names a newer model in the same line', () => {
    expect(messages(checkAnthropic(['claude-sonnet-5'], table, TODAY))).toEqual([
      'warn claude-sonnet-5: a newer sonnet is available: claude-sonnet-5-5',
    ]);
  });

  it('warns on a deprecated model with its retirement date', () => {
    expect(messages(checkAnthropic(['claude-sonnet-4-5-20250929'], table, TODAY))[0]).toBe(
      'warn claude-sonnet-4-5-20250929: deprecated September 30, 2026; retires November 30, 2026',
    );
  });

  it('blocks on a retired model', () => {
    const f = checkAnthropic(['claude-sonnet-4-20250514'], table, TODAY);
    expect(f[0]).toMatchObject({ level: 'error', message: expect.stringMatching(/retired/) });
  });

  it('warns, not blocks, on an id the table does not list', () => {
    expect(checkAnthropic(['claude-made-up-9'], table, TODAY)[0]).toMatchObject({ level: 'warn' });
  });

  it('reports nothing for the newest active model', () => {
    expect(checkAnthropic(['claude-opus-5-5'], table, TODAY)).toEqual([]);
  });
});

describe('Gemini', () => {
  const table = parseGemini(GEMINI);

  it('parses the tables, with backticks stripped', () => {
    expect(table.get('gemini-3.1-flash-lite')).toMatchObject({ shutdown: 'May 7, 2027', replacement: 'gemini-3.5-flash-lite' });
  });

  it('warns on an announced shutdown and names the replacement', () => {
    expect(messages(checkGemini(['gemini-3.1-flash-lite'], table, TODAY))).toEqual([
      'warn gemini-3.1-flash-lite: shuts down May 7, 2027',
      'warn gemini-3.1-flash-lite: Google recommends gemini-3.5-flash-lite instead',
    ]);
  });

  it('names the newest model in the line, not one Google already routes elsewhere', () => {
    expect(messages(checkGemini(['gemini-3.6-flash'], table, TODAY))).toEqual([
      'warn gemini-3.6-flash: a newer flash is available: gemini-3.8-flash',
    ]);
  });

  it('says when Google already routes an id to its replacement', () => {
    expect(messages(checkGemini(['gemini-3.5-flash'], table, TODAY))[0]).toBe(
      'warn gemini-3.5-flash: Google recommends gemini-3.6-flash instead (Google already routes it there)',
    );
  });

  it('blocks on a model that has shut down', () => {
    expect(checkGemini(['gemini-2.0-flash'], table, TODAY)[0]).toMatchObject({ level: 'error' });
  });

  it('reports nothing for a current model with nothing newer', () => {
    expect(checkGemini(['gemini-3.1-pro-preview'], table, TODAY)).toEqual([]);
  });
});

describe('model lines', () => {
  it('reads lines and versions from ids', () => {
    expect(anthropicLine('claude-haiku-4-5-20251001')).toEqual({ line: 'haiku', version: [4, 5] });
    expect(anthropicLine('claude-sonnet-5')).toEqual({ line: 'sonnet', version: [5] });
    expect(anthropicLine('claude-3-5-haiku-20241022')).toBeNull();
    expect(geminiLine('gemini-3.5-flash-lite')).toEqual({ line: 'flash-lite', version: [3, 5] });
    expect(geminiLine('gemini-3.8-flash-tts')).toBeNull();
  });
});
