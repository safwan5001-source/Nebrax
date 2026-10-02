// AWJ v3 drift ratchet (Horizon 5, GOVERNANCE.md §4.3).
//
// Counts, per source file, the visual values that bypass the semantic token layer:
//   - fixed-palette Tailwind classes (bg-white, text-neutral-600, border-slate-200, …)
//   - raw hex literals in TSX
// The committed baseline (design-system/governance/baseline.json) records today's counts.
// The test fails on ANY increase, and on any new file that is not at zero — so drift can
// only go down. Lowering the baseline is a deliberate commit:  node scripts/awj-drift-scan.mjs --write
//
// Print documents (white paper by design) and the Studio Builder (scoped overrides until the
// legacy path is retired) are the accepted exceptions recorded in the baseline; see
// design-system/v3/MIGRATION.md §7.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../..');
export const SRC_ROOT = path.join(REPO_ROOT, 'web/src');
export const BASELINE_PATH = path.join(REPO_ROOT, 'design-system/governance/baseline.json');

const PALETTE_CLASS = /\b(?:bg|text|border|ring|fill|stroke|from|to|via|divide|outline|decoration|accent|caret|shadow)-(?:white|black|neutral|slate|gray|zinc|stone|red|green|amber|emerald|rose|yellow|blue|indigo|sky|orange|teal|cyan|violet|purple|pink|lime)(?:-[0-9]{2,3})?\b/g;
const HEX = /#[0-9a-fA-F]{6}\b/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function scan() {
  const result = {};
  for (const file of walk(SRC_ROOT)) {
    if (!/\.tsx$/.test(file) || /\.(test|spec)\.tsx$/.test(file) || file.includes('__tests__')) continue;
    const source = readFileSync(file, 'utf8');
    const palette = (source.match(PALETTE_CLASS) ?? []).length;
    const hex = (source.match(HEX) ?? []).length;
    if (palette + hex > 0) result[path.relative(REPO_ROOT, file)] = { palette, hex };
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

if (process.argv.includes('--write')) {
  const files = scan();
  const totals = Object.values(files).reduce((acc, v) => ({ palette: acc.palette + v.palette, hex: acc.hex + v.hex }), { palette: 0, hex: 0 });
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ $comment: 'Per-file counts of fixed-palette classes and raw hex in TSX. Ratchet: may only go down. Regenerate with `node scripts/awj-drift-scan.mjs --write` after a reduction.', totals, files }, null, 2)}\n`);
  console.log(`baseline written: ${Object.keys(files).length} files, ${totals.palette} palette classes, ${totals.hex} hex`);
}
