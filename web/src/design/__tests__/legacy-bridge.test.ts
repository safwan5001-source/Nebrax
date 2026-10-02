import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCss, LEGACY_ALIAS_MAP } from '../../../scripts/generate-awj-tokens.mjs';

// AWJ v3 (Horizon 5) — the legacy-variable bridge (TOKEN_REFERENCE.md §10).
// Under the gate, v2.0 variables are aliases of semantic v3 tokens, so Light and Dark are
// each defined once. Outside the gate nothing changes.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../');
const tokens = JSON.parse(readFileSync(path.join(repoRoot, 'design-system/tokens/awj.tokens.json'), 'utf8'));
const css = buildCss(tokens);

/** Every `--awj-*` variable the generated CSS defines, in any block. */
const defined = new Set([...css.matchAll(/(--awj-[a-z0-9-]+):/g)].map((m) => m[1]));

describe('legacy variable bridge', () => {
  it('re-points exactly the v2.0 variables the shared utilities read', () => {
    expect(Object.keys(LEGACY_ALIAS_MAP).sort()).toEqual([
      '--background', '--border', '--muted', '--negative', '--positive', '--primary',
      '--primary-foreground', '--primary-hover', '--primary-soft', '--surface', '--text', '--warning',
    ]);
  });

  it('every alias target is a real generated semantic token', () => {
    for (const [legacy, target] of Object.entries(LEGACY_ALIAS_MAP)) {
      const name = /^var\((--awj-[a-z0-9-]+)\)$/.exec(target as string)?.[1];
      expect(name, `${legacy} must alias a --awj-* token`).toBeTruthy();
      expect(defined.has(name as string), `${legacy} → ${name} is not defined by the generator`).toBe(true);
    }
  });

  it('is emitted behind the v3 gate only, and once (mode-independent: var() resolves per mode)', () => {
    const start = css.indexOf('html[data-awj-ui="3"] {\n  --background:');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).toContain('--background: var(--awj-surface-desk)');
    expect(block).toContain('--surface: var(--awj-surface-paper)');
    expect(block).toContain('--muted: var(--awj-text-secondary)');
    // Not duplicated per mode, so Light and Dark can never drift apart again.
    expect(css.match(/--surface: var\(--awj-surface-paper\)/g)).toHaveLength(1);
  });

  it('leaves the v2.0 definitions untouched outside the gate', () => {
    const globals = readFileSync(path.join(repoRoot, 'web/src/app/globals.css'), 'utf8');
    expect(globals).toMatch(/:root \{\n  --background: #f6f7f9;/);
    expect(globals).toMatch(/\.dark \{\n  --background: #0e1014;/);
  });
});
