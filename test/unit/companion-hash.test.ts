/**
 * The companion's version stamp is a fingerprint of its code. It must not
 * depend on commit order (a companion packed before its change was committed
 * used to report itself out of date) or on files that don't change behaviour
 * (an icon change used to ask everyone to reinstall).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { companionCodeHash } from '../../scripts/companion-hash.mjs';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'companion-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'package.json'), '{"name":"inflow-mcp"}');
  writeFileSync(join(dir, 'src', 'index.mjs'), 'export const x = 1;');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it('is the same for the same code', () => {
  expect(companionCodeHash(dir)).toBe(companionCodeHash(dir));
  expect(companionCodeHash(dir)).toMatch(/^[0-9a-f]{7}$/);
});

it('changes when the code changes', () => {
  const before = companionCodeHash(dir);
  writeFileSync(join(dir, 'src', 'index.mjs'), 'export const x = 2;');
  expect(companionCodeHash(dir)).not.toBe(before);
});

it('ignores the icon, the manifest, the stamp itself and the live tool catalog', () => {
  const before = companionCodeHash(dir);
  writeFileSync(join(dir, 'icon.png'), 'new icon');
  writeFileSync(join(dir, 'manifest.json'), '{}');
  writeFileSync(join(dir, 'src', 'build-info.json'), '{"codeCommit":"x"}');
  writeFileSync(join(dir, 'src', 'default-tools.json'), '[]');
  expect(companionCodeHash(dir)).toBe(before);
});
