/**
 * Generate the companion's bundled default tool catalog from the extension's own
 * descriptors, so a freshly installed companion advertises tools before the
 * inflow tab has ever paired. Run via `npm run gen:mcp-tools` (and automatically
 * as part of `pack:companion`). The drift guard test fails if it's out of date.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { toolDescriptors } from '../src/lib/mcp/tools';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../mcp-companion/src/default-tools.json');
const tools = toolDescriptors();
writeFileSync(out, JSON.stringify(tools, null, 2) + '\n');
console.log(`Wrote ${tools.length} tools -> ${out}`);
