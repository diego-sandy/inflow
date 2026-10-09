/**
 * Drift guard: the companion ships a generated copy of the tool catalog
 * (mcp-companion/src/default-tools.json) so a freshly installed companion can
 * advertise tools before the inflow tab has ever paired. That snapshot must
 * match the extension's live descriptors — otherwise a new user sees a stale
 * or incomplete toolbox on first launch.
 *
 * If this fails, regenerate it:  npm run gen:mcp-tools
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { toolDescriptors } from '@/lib/mcp/tools';

const BUNDLED = resolve(process.cwd(), 'mcp-companion/src/default-tools.json');

it('the companion ships a bundled default catalog', () => {
  expect(existsSync(BUNDLED)).toBe(true);
});

it('the bundled catalog matches the extension descriptors (run: npm run gen:mcp-tools)', () => {
  const bundled = JSON.parse(readFileSync(BUNDLED, 'utf8'));
  const live = toolDescriptors();
  // Compare names first — a mismatch here gives a far clearer failure than a
  // deep-equal diff across ten full JSON Schemas.
  expect(bundled.map((t: any) => t.name)).toEqual(live.map((t) => t.name));
  expect(bundled).toEqual(live);
});
