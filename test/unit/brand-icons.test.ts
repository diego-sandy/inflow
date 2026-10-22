/**
 * The extension icons are rendered from assets/brand/inflow-mark*.svg. Guards
 * that every size the manifest declares exists at the size it claims (Chrome
 * silently rescales a wrong-sized file, which blurs the toolbar icon), that
 * they carry transparency, and that the 32px Retina size is declared at all.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const config = readFileSync(resolve(root, 'wxt.config.ts'), 'utf8');

/** Width, height and colour type straight from a PNG's IHDR chunk. */
function pngInfo(path: string) {
  const b = readFileSync(path);
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] };
}

/** The `'size': 'file'` pairs inside one block of the manifest config. */
function declared(block: 'icons' | 'default_icon'): Record<string, string> {
  const m = new RegExp(`${block}: \\{([^}]*)\\}`).exec(config);
  expect(m, `${block} block in wxt.config.ts`).toBeTruthy();
  return Object.fromEntries([...m![1].matchAll(/'(\d+)': '([^']+)'/g)].map((x) => [x[1], x[2]]));
}

describe.each(['icons', 'default_icon'] as const)('manifest %s', (block) => {
  const icons = declared(block);

  it('declares 16, 32, 48 and 128', () => {
    expect(Object.keys(icons).sort((a, b) => +a - +b)).toEqual(['16', '32', '48', '128']);
  });

  it.each(Object.entries(icons))('%spx is a %s at that size, with transparency', (size, file) => {
    const path = resolve(root, 'public', file);
    expect(existsSync(path)).toBe(true);
    const { width, height, colorType } = pngInfo(path);
    expect([width, height]).toEqual([+size, +size]);
    // 6 = RGBA. An opaque icon would show a box on any non-white toolbar.
    expect(colorType).toBe(6);
  });
});

it('keeps the vector masters the icons are rendered from', () => {
  for (const f of ['inflow-mark.svg', 'inflow-mark-small.svg']) {
    const svg = readFileSync(resolve(root, 'assets/brand', f), 'utf8');
    expect(svg).toContain('viewBox="150 155 980 980"');
  }
});

it('gives the Claude companion the same mark', () => {
  const { width, colorType } = pngInfo(resolve(root, 'mcp-companion/icon.png'));
  expect(width).toBe(128);
  expect(colorType).toBe(6);
});
