#!/usr/bin/env node
/**
 * Release check: are the AI models inflow offers still current?
 *
 * Compares the model ids in src/lib/ai-settings.ts against the providers' own
 * public lifecycle pages, which both publish as Markdown, so no API keys are
 * needed:
 *   - Anthropic: platform.claude.com/docs/en/about-claude/model-deprecations.md
 *   - Google:    ai.google.dev/gemini-api/docs/deprecations.md.txt
 *
 * Blocks a release (exit 1) only when a model inflow offers is retired or shut
 * down: users who picked it would get errors. Everything else is a warning,
 * because switching models is a product decision, not something a script
 * should force:
 *   - deprecated, or a retirement/shutdown date announced or now possible;
 *   - a newer model in the same line (a newer Haiku, a newer Flash);
 *   - the provider names a replacement, or routes the id to another model;
 *   - an id the page doesn't list (it may be new, or gone: check by hand).
 *
 * If a page can't be fetched or its table can't be found, that's a warning
 * too: these are pages for people, and a layout change mustn't block a
 * release. Run with `npm run check:models`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const SOURCES = {
  anthropic: 'https://platform.claude.com/docs/en/about-claude/model-deprecations.md',
  gemini: 'https://ai.google.dev/gemini-api/docs/deprecations.md.txt',
};

// --- inflow's own model list --------------------------------------------------

/** The model ids inflow offers, read from the `{ id: '…' }` entries in ai-settings.ts. */
export function readCatalog(aiSettingsSource) {
  const ids = [...aiSettingsSource.matchAll(/\{\s*id:\s*'((?:claude|gemini)-[^']+)'/g)].map((m) => m[1]);
  return {
    anthropic: ids.filter((id) => id.startsWith('claude-')),
    gemini: ids.filter((id) => id.startsWith('gemini-')),
  };
}

// --- parsing the providers' tables -------------------------------------------

/** Cells of every Markdown table row, trimmed, with backticks removed. */
function tableRows(markdown) {
  return markdown
    .split('\n')
    .filter((line) => /^\|.*\|\s*$/.test(line) && !/^\|\s*[-:]+\s*\|/.test(line))
    .map((line) =>
      line
        .slice(1, line.trimEnd().length - 1)
        .split('|')
        .map((c) => c.replace(/`/g, '').trim()),
    );
}

/** Anthropic's "Model status" table: id → { status, deprecated, retirement }. */
export function parseAnthropic(markdown) {
  const models = new Map();
  for (const [id, status, deprecated, retirement] of tableRows(markdown)) {
    if (!/^claude-/.test(id ?? '')) continue;
    models.set(id, { status, deprecated, retirement });
  }
  return models;
}

/** Google's deprecations tables: id → { released, shutdown, replacement }. */
export function parseGemini(markdown) {
  const models = new Map();
  for (const [id, released, shutdown, replacement] of tableRows(markdown)) {
    if (!/^gemini-/.test(id ?? '')) continue;
    // A model can appear in more than one table (e.g. Live); keep the first.
    if (!models.has(id)) models.set(id, { released, shutdown, replacement: replacement ?? '' });
  }
  return models;
}

// --- comparing ---------------------------------------------------------------

/** "September 1, 2027" (optionally after "Not sooner than") → Date, or null. */
function parseDate(text) {
  const m = /([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(text ?? '');
  if (!m) return null;
  const d = new Date(`${m[1]} UTC`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Anthropic id → { line, version: number[] }, e.g. claude-sonnet-5-5 → sonnet [5,5]. Old-style ids → null. */
export function anthropicLine(id) {
  const m = /^claude-([a-z]+)-(\d+(?:-\d{1,2})*)(?:-\d{8})?$/.exec(id);
  if (!m) return null;
  return { line: m[1], version: m[2].split('-').map(Number) };
}

/** Gemini id → { line, version }, e.g. gemini-3.6-flash → flash [3,6]. Special models (tts, live…) → null. */
export function geminiLine(id) {
  const m = /^gemini-(\d+(?:\.\d+)?)-(flash-lite|flash|pro)(-preview)?$/.exec(id);
  if (!m) return null;
  return { line: m[2], version: m[1].split('.').map(Number) };
}

function newer(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

/**
 * Findings for inflow's Anthropic models against the status table.
 * Our ids may be aliases (claude-haiku-4-5) of a dated id (…-20251001).
 */
export function checkAnthropic(ids, table, today = new Date()) {
  const findings = [];
  for (const id of ids) {
    const key = table.has(id) ? id : [...table.keys()].find((k) => k.startsWith(`${id}-`) && /-\d{8}$/.test(k));
    const row = key && table.get(key);
    if (!row) {
      findings.push({ level: 'warn', id, message: `not in Anthropic's model status table; check it by hand` });
      continue;
    }
    if (/retired/i.test(row.status)) {
      findings.push({ level: 'error', id, message: `retired (${row.retirement}); requests to it fail` });
      continue;
    }
    if (/deprecated/i.test(row.status)) {
      findings.push({ level: 'warn', id, message: `deprecated ${row.deprecated}; retires ${row.retirement}` });
    } else {
      const earliest = parseDate(row.retirement);
      if (earliest && earliest <= today) {
        findings.push({
          level: 'warn',
          id,
          message: `its earliest retirement date (${row.retirement.replace(/^Not sooner than /, '')}) has passed; it can now be retired with notice`,
        });
      }
    }
    const mine = anthropicLine(key);
    if (mine) {
      const newest = [...table.entries()]
        .filter(([, r]) => /active/i.test(r.status))
        .map(([k]) => ({ k, l: anthropicLine(k) }))
        .filter(({ l }) => l && l.line === mine.line && newer(l.version, mine.version))
        .sort((a, b) => (newer(a.l.version, b.l.version) ? -1 : 1))[0];
      if (newest) findings.push({ level: 'warn', id, message: `a newer ${mine.line} is available: ${newest.k}` });
    }
  }
  return findings;
}

/** Findings for inflow's Gemini models against the deprecations tables. */
export function checkGemini(ids, table, today = new Date()) {
  const findings = [];
  for (const id of ids) {
    const row = table.get(id);
    if (!row) {
      findings.push({ level: 'warn', id, message: `not in Google's deprecations tables; check it by hand` });
      continue;
    }
    const shutdown = parseDate(row.shutdown);
    if (shutdown && shutdown <= today) {
      findings.push({ level: 'error', id, message: `shut down ${row.shutdown}; requests to it fail` });
      continue;
    }
    if (shutdown) findings.push({ level: 'warn', id, message: `shuts down ${row.shutdown}` });
    const replacement = row.replacement.replace(/\s*\(.*$/, '').trim();
    if (replacement) {
      const routed = /routes API requests/i.test(row.replacement) ? ' (Google already routes it there)' : '';
      findings.push({ level: 'warn', id, message: `Google recommends ${replacement} instead${routed}` });
    }
    const mine = geminiLine(id);
    if (mine) {
      const newest = [...table.entries()]
        .filter(([, r]) => {
          const d = parseDate(r.shutdown);
          return !(d && d <= today);
        })
        .map(([k]) => ({ k, l: geminiLine(k) }))
        .filter(({ k, l }) => l && l.line === mine.line && !k.endsWith('-preview') && newer(l.version, mine.version))
        .sort((a, b) => (newer(a.l.version, b.l.version) ? -1 : 1))[0];
      if (newest && newest.k !== replacement) {
        findings.push({ level: 'warn', id, message: `a newer ${mine.line} is available: ${newest.k}` });
      }
    }
  }
  return findings;
}

// --- running -----------------------------------------------------------------

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const catalog = readCatalog(readFileSync(join(root, 'src/lib/ai-settings.ts'), 'utf8'));
  const findings = [];
  const providers = [
    ['Anthropic', 'anthropic', parseAnthropic, checkAnthropic],
    ['Google', 'gemini', parseGemini, checkGemini],
  ];

  for (const [name, key, parse, check] of providers) {
    let table;
    try {
      table = parse(await fetchText(SOURCES[key]));
    } catch (e) {
      findings.push({ level: 'warn', id: name, message: `couldn't read ${SOURCES[key]} (${e.message}); not checked` });
      continue;
    }
    if (table.size === 0) {
      findings.push({ level: 'warn', id: name, message: `no model table found at ${SOURCES[key]}; the page layout may have changed` });
      continue;
    }
    findings.push(...check(catalog[key], table));
  }

  console.log(`Checked ${catalog.anthropic.length} Claude and ${catalog.gemini.length} Gemini models against the providers' lifecycle pages.`);
  for (const f of findings) console.log(`${f.level === 'error' ? '✖ ERROR' : '⚠ warn '}  ${f.id}: ${f.message}`);
  const errors = findings.filter((f) => f.level === 'error');
  if (errors.length) {
    console.log(`\n${errors.length} model(s) inflow offers no longer work. Update src/lib/ai-settings.ts before releasing.`);
    process.exit(1);
  }
  console.log(findings.length ? '\nNo blocking problems. Review the warnings above.' : 'All current.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    // An unexpected bug in the check itself shouldn't block a release either.
    console.log(`⚠ warn   model check failed to run: ${e.message}`);
  });
}
