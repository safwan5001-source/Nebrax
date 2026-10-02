// AWJ v3 token generator.
//
// Source of truth: design-system/tokens/awj.tokens.json
// Output: a generated CSS block written into web/src/app/globals.css between the
//   /* AWJ-TOKENS:GENERATED:BEGIN */ ... /* AWJ-TOKENS:GENERATED:END */ markers.
//
// Pure functions (resolveRef, getPath, buildCss, contrastRatio, checkContrasts) are
// exported for unit testing (web/src/design/__tests__/*.test.ts) and have no file-system
// side effects. Only `main()` touches disk, and only when this file is executed directly.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const BEGIN_MARKER = '/* AWJ-TOKENS:GENERATED:BEGIN — do not hand-edit, see design-system/tokens/awj.tokens.json */';
export const END_MARKER = '/* AWJ-TOKENS:GENERATED:END */';

export function getPath(root, refPath) {
  const parts = refPath.split('.');
  let node = root;
  for (const part of parts) {
    if (node == null) return undefined;
    node = node[part];
  }
  if (node && typeof node === 'object' && !Array.isArray(node) && 'value' in node) {
    node = node.value;
  }
  return node;
}

export function resolveRef(value, root, depth = 0) {
  if (typeof value !== 'string') return value;
  if (depth > 10) throw new Error(`AWJ token reference depth exceeded resolving: ${value}`);
  const refPattern = /\{([^{}]+)\}/g;
  let sawRef = false;
  const resolved = value.replace(refPattern, (_, refPath) => {
    sawRef = true;
    const found = getPath(root, refPath);
    if (found === undefined) {
      throw new Error(`AWJ token: unresolved reference {${refPath}}`);
    }
    return typeof found === 'string' ? found : String(found);
  });
  if (sawRef && /\{[^{}]+\}/.test(resolved)) {
    return resolveRef(resolved, root, depth + 1);
  }
  return resolved;
}

function resolveGroup(root, group, prefix) {
  const out = {};
  for (const [key, node] of Object.entries(group)) {
    const raw = node && typeof node === 'object' && !Array.isArray(node) && 'value' in node ? node.value : node;
    out[`--awj-${prefix}-${key}`] = resolveRef(raw, root);
  }
  return out;
}

// Builds the resolved token maps used both for CSS emission and for contrast testing.
export function buildTokens(tokens) {
  const base = {
    ...resolveGroup(tokens, tokens.semantic.surface, 'surface'),
    ...resolveGroup(tokens, tokens.semantic.border, 'border'),
    ...resolveGroup(tokens, tokens.semantic.text, 'text'),
    ...resolveGroup(tokens, tokens.semantic.action, 'action'),
    ...resolveGroup(tokens, tokens.semantic.status, 'status'),
    '--awj-brand-soft': resolveRef(tokens.semantic['brand-soft'].value, tokens),
    ...resolveGroup(tokens, tokens.interaction, 'state'),
    '--awj-elevation-0': resolveRef(tokens.elevation['0'].value, tokens),
    '--awj-elevation-1': resolveRef(tokens.elevation['1'].value, tokens),
    '--awj-elevation-2': resolveRef(tokens.elevation['2'].value, tokens),
    '--awj-elevation-3': resolveRef(tokens.elevation['3'].value, tokens),
    '--awj-elevation-4': resolveRef(tokens.elevation['4'].value, tokens),
    '--awj-elevation-scrim': resolveRef(tokens.elevation.scrim.value, tokens),
    '--awj-shell-cast': resolveRef(tokens.elevation['shell-cast'].value, tokens),
    '--awj-shell-cast-edge': resolveRef(tokens.elevation['shell-cast-edge'].value, tokens),
    ...resolveGroup(tokens, tokens.radius, 'radius'),
    ...resolveGroup(tokens, tokens.rule, 'rule'),
    '--awj-apex-rail': resolveRef(tokens.apex.rail.value, tokens),
    '--awj-apex-cap-w': resolveRef(tokens.apex['cap-w'].value, tokens),
    '--awj-apex-cap-h': resolveRef(tokens.apex['cap-h'].value, tokens),
  };

  const themeDefault = resolveThemeBlock(tokens, tokens.theme.default);
  const themeInk = resolveThemeBlock(tokens, tokens.theme.ink);
  const darkBase = buildDarkBase(tokens);

  // Mode-independent tokens: valid in light AND dark under the gate. Outcome is
  // mode-fixed (THEMES.md D-13 — the ink surface never changes with theme or mode),
  // so it is resolved once here rather than duplicated in `base` and `darkBase`.
  const modeless = {
    '--awj-surface-outcome': resolveRef(tokens.semantic.surface.outcome.value, tokens),
    ...resolveGroup(tokens, tokens.outcome, 'outcome'),
    ...densityVars(tokens, 'standard'),
  };

  return { base, themeDefault, themeInk, darkBase, modeless };
}

// Dark v3 (Horizon 3, S10): real semantic dark tokens, not an alias back to the old
// v2.0 `.dark` variables. Resolved the same way as the light `base` group above, from
// design-system/tokens/awj.tokens.json `dark.*`. Shell tokens are deliberately absent
// here — Ink-Dark = Default-Dark (THEMES.md D-12) reuses the resolved Ink theme block
// verbatim in buildCss() rather than maintaining a second dark shell matrix.
function buildDarkBase(tokens) {
  const d = tokens.dark;
  return {
    ...resolveGroup(tokens, d.surface, 'surface'),
    ...resolveGroup(tokens, d.border, 'border'),
    ...resolveGroup(tokens, d.text, 'text'),
    ...resolveGroup(tokens, d.action, 'action'),
    ...resolveGroup(tokens, d.status, 'status'),
    '--awj-brand-soft': resolveRef(d['brand-soft'].value, tokens),
    ...resolveGroup(tokens, d.interaction, 'state'),
    '--awj-elevation-0': resolveRef(d.elevation['0'].value, tokens),
    '--awj-elevation-1': resolveRef(d.elevation['1'].value, tokens),
    '--awj-elevation-2': resolveRef(d.elevation['2'].value, tokens),
    '--awj-elevation-3': resolveRef(d.elevation['3'].value, tokens),
    '--awj-elevation-4': resolveRef(d.elevation['4'].value, tokens),
    '--awj-elevation-scrim': resolveRef(d.elevation.scrim.value, tokens),
    '--awj-shell-cast': resolveRef(d.elevation['shell-cast'].value, tokens),
    '--awj-shell-cast-edge': resolveRef(d.elevation['shell-cast-edge'].value, tokens),
    '--awj-outcome-edge': resolveRef(d['outcome-edge'].value, tokens),
  };
}

// Density tokens carry a `standard` value and a `compact` value. Compact applies
// automatically on short viewports (FOUNDATIONS.md §14); there is no user-facing tier.
function densityVars(tokens, tier) {
  const out = {};
  for (const [key, node] of Object.entries(tokens.density ?? {})) {
    out[`--awj-${key}`] = resolveRef(node[tier], tokens);
  }
  return out;
}

function resolveThemeBlock(tokens, themeNode) {
  const out = {};
  for (const [key, raw] of Object.entries(themeNode)) {
    out[`--awj-${key}`] = resolveRef(raw, tokens);
  }
  return out;
}

function cssBlock(selector, vars, indent = '  ') {
  const lines = Object.entries(vars).map(([k, v]) => `${indent}${k}: ${v};`);
  return `${selector} {\n${lines.join('\n')}\n}`;
}

export function buildCss(tokens) {
  const { base, themeDefault, themeInk, darkBase, modeless } = buildTokens(tokens);

  const blocks = [];
  blocks.push(cssBlock('html[data-awj-ui="3"]', modeless));
  blocks.push(
    cssBlock('html[data-awj-ui="3"]:not(.dark)', { ...base, ...themeDefault })
  );
  blocks.push(
    cssBlock('html[data-awj-ui="3"][data-awj-theme="ink"]:not(.dark)', themeInk)
  );
  blocks.push(
    `@media (max-height: 740px) {\n${cssBlock('html[data-awj-ui="3"]', densityVars(tokens, 'compact'), '    ')
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')}\n}`
  );
  // Dark v3 (Horizon 3, S10): real semantic dark tokens from design-system/tokens/awj.tokens.json
  // `dark.*` (buildDarkBase above) — no longer aliases to the old v2.0 `.dark` variables.
  // Per THEMES.md D-12, Ink-Dark = Default-Dark: dark mode always renders the Ink shell
  // values regardless of `data-awj-theme`, so this single block is unconditional and the
  // `[data-awj-theme="ink"]:not(.dark)` block above simply stops matching once `.dark` is
  // present — no shell values are duplicated or redefined, just reused.
  blocks.push(
    cssBlock('html[data-awj-ui="3"].dark', { ...darkBase, ...themeInk })
  );

  return `${BEGIN_MARKER}\n${blocks.join('\n\n')}\n${END_MARKER}`;
}

// --- WCAG 2.x contrast (relative luminance) -------------------------------------------

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex) {
  const m = hex.replace('#', '');
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export function checkContrasts(tokens) {
  return tokens.contrastChecks.map((check) => {
    const fg = resolveRef(check.fg, tokens);
    const bg = resolveRef(check.bg, tokens);
    const ratio = contrastRatio(fg, bg);
    return { name: check.name, fg, bg, min: check.min, ratio, pass: ratio >= check.min };
  });
}

// --- CLI (file-system side effects; not exercised by unit tests) ---------------------

export function spliceGenerated(cssSource, generatedBlock) {
  const beginIdx = cssSource.indexOf(BEGIN_MARKER);
  const endIdx = cssSource.indexOf(END_MARKER);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error('AWJ token markers not found in globals.css — expected BEGIN/END marker comments.');
  }
  const before = cssSource.slice(0, beginIdx);
  const after = cssSource.slice(endIdx + END_MARKER.length);
  return `${before}${generatedBlock}${after}`;
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const tokensPath = path.resolve(here, '../../design-system/tokens/awj.tokens.json');
  const cssPath = path.resolve(here, '../src/app/globals.css');

  const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'));
  const contrastResults = checkContrasts(tokens);
  const failures = contrastResults.filter((c) => !c.pass);
  if (failures.length > 0) {
    console.error('AWJ token generator: contrast check failures:');
    for (const f of failures) {
      console.error(`  ✗ ${f.name}: ${f.ratio.toFixed(2)} < ${f.min} (fg=${f.fg} bg=${f.bg})`);
    }
    process.exitCode = 1;
    return;
  }

  const generatedBlock = buildCss(tokens);
  const cssSource = readFileSync(cssPath, 'utf8');
  const nextCss = spliceGenerated(cssSource, generatedBlock);
  writeFileSync(cssPath, nextCss, 'utf8');
  console.log(`AWJ token generator: wrote ${Object.keys(buildTokens(tokens).base).length + Object.keys(buildTokens(tokens).themeDefault).length} variables into ${path.relative(process.cwd(), cssPath)}`);
  console.log(`AWJ token generator: ${contrastResults.length} contrast pairs checked, all passing.`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main();
}
