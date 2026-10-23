/**
 * A fingerprint of the companion's code, used to tell whether an installed
 * companion is stale. Shared by the companion packer (gen-companion-build.mjs),
 * which stamps it into the bundle, and the extension build (wxt.config.ts),
 * which bakes in the one it expects, so both always compute it the same way.
 *
 * It hashes the files themselves rather than asking git for "the last commit
 * that touched the companion". That commit only exists after committing, so a
 * companion packed before its change was committed (the normal order) was
 * stamped with the previous commit and reported itself as out of date the
 * moment the change landed. A content hash is the same whenever the code is.
 *
 * Only what affects behaviour counts: package.json and src/, minus the stamp
 * itself and default-tools.json (refreshed live at pairing). The icon and
 * manifest don't, so a new icon never asks anyone to reinstall.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

const IGNORED = new Set(['build-info.json', 'default-tools.json']);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Short hex fingerprint of the companion code under `companionDir`. */
export function companionCodeHash(companionDir) {
  const files = [join(companionDir, 'package.json'), ...walk(join(companionDir, 'src'))]
    .filter((f) => !IGNORED.has(basename(f)))
    .sort();
  const hash = createHash('sha256');
  for (const file of files) {
    // The relative path is part of the hash, with / separators on every OS.
    hash.update(relative(companionDir, file).split(sep).join('/'));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 7);
}
