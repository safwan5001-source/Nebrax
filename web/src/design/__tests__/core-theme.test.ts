import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCss, buildTokens, checkContrasts, contrastRatio } from '../../../scripts/generate-awj-tokens.mjs';

// AWJ Core (third V3 theme) — THEMES.md §6A. The owner-approved contract:
//   Light shell (sidebar + topbar) = #1E40AF · Dark shell = #1E3A8A (design M, PR #1535 · D-42) ·
//   everything else unchanged.
// These tests pin the colors, the "shell tokens only" boundary, the Default/Ink invariants and
// the contrast of every foreground / state role against each Core background.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../');
const tokens = JSON.parse(readFileSync(path.join(repoRoot, 'design-system/tokens/awj.tokens.json'), 'utf8'));
const css = buildCss(tokens);
const resolved = buildTokens(tokens) as Record<string, Record<string, string>>;

const SHELL_TOKENS = [
  'shell-bg', 'shell-fg', 'shell-fg-muted', 'shell-line', 'shell-hover', 'shell-active-bg', 'shell-active-fg',
  'shell-active-shadow', 'shell-apex', 'shell-field-bg', 'shell-field-line', 'shell-focus-ring', 'shell-brandmark-bg',
].map((name) => `--awj-${name}`);

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing block: ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}', start) + 2);
}

const CORE_LIGHT = 'html[data-awj-ui="3"][data-awj-theme="core"]:not(.dark)';
const CORE_DARK = 'html[data-awj-ui="3"][data-awj-theme="core"].dark';

describe('AWJ Core — owner-approved shell colors', () => {
  it('Light shell background is exactly #1E40AF (AWJ original primary blue)', () => {
    expect(resolved.themeCoreLight['--awj-shell-bg'].toUpperCase()).toBe('#1E40AF');
    expect(block(CORE_LIGHT)).toContain('--awj-shell-bg: #1E40AF;');
  });

  it('Dark shell background is exactly #1E3A8A (owner-approved design M = primitive.brand.700)', () => {
    expect(resolved.themeCoreDark['--awj-shell-bg'].toUpperCase()).toBe('#1E3A8A');
    expect(block(CORE_DARK)).toContain('--awj-shell-bg: #1E3A8A;');
    expect(tokens.theme.core.dark['shell-bg']).toBe('{primitive.brand.700}');
  });

  it('Dark foregrounds are light again (white on #1E3A8A passes 4.5:1) and Apex is the approved #A9C4FF', () => {
    const dark = resolved.themeCoreDark;
    expect(dark['--awj-shell-fg'].toUpperCase()).toBe('#FFFFFF');
    expect(dark['--awj-shell-apex'].toUpperCase()).toBe('#A9C4FF');
    expect(contrastRatio(dark['--awj-shell-fg'], dark['--awj-shell-bg'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dark['--awj-shell-apex'], dark['--awj-shell-bg'])).toBeGreaterThanOrEqual(4.5);
  });

  it('Core Light is pinned: the 13 Light shell values are unchanged by the Dark work', () => {
    const light = resolved.themeCoreLight;
    expect(Object.fromEntries(Object.entries(light).map(([k, v]) => [k, v.toUpperCase()]))).toEqual({
      '--awj-shell-bg': '#1E40AF', '--awj-shell-fg': '#FFFFFF', '--awj-shell-fg-muted': '#CBD9FB',
      '--awj-shell-line': '#5573D2', '--awj-shell-hover': '#2A4DBF', '--awj-shell-active-bg': '#3558C8',
      '--awj-shell-active-fg': '#FFFFFF', '--awj-shell-active-shadow': 'INSET 0 0 0 1PX #6F8BE0',
      '--awj-shell-apex': '#FFFFFF', '--awj-shell-field-bg': '#18368F', '--awj-shell-field-line': '#9DB4EE',
      '--awj-shell-focus-ring': '#FFFFFF', '--awj-shell-brandmark-bg': '#FFFFFF',
    });
  });
});

describe('AWJ Core-Dark — Active / Hover / Shell separation and identity (design M)', () => {
  const d = resolved.themeCoreDark;
  const shell = d['--awj-shell-bg'];
  const hover = d['--awj-shell-hover'];
  const active = d['--awj-shell-active-bg'];

  it('Shell → Hover ≥ 1.2, Hover → Active ≥ 1.3, Shell → Active ≥ 1.6 (selected state is not a whisper)', () => {
    expect(contrastRatio(shell, hover)).toBeGreaterThanOrEqual(1.2);
    expect(contrastRatio(hover, active)).toBeGreaterThanOrEqual(1.3);
    expect(contrastRatio(shell, active)).toBeGreaterThanOrEqual(1.6);
  });

  it('is distinct from Ink-Dark (≥ 1.5:1 against #0E1A31) …', () => {
    expect(contrastRatio(shell, resolved.themeInk['--awj-shell-bg'])).toBeGreaterThanOrEqual(1.5);
  });

  it('… and does not return to the bright #4F8CFF slab (< 3:1 against the dark Desk; it was 6.2:1)', () => {
    expect(contrastRatio(shell, tokens.primitive.night.desk)).toBeLessThan(3);
  });

  it('focus ring clears 3:1 on every shell surface it can touch (shell, hover, active plate, search field)', () => {
    const ring = d['--awj-shell-focus-ring'];
    for (const surface of [shell, hover, active, d['--awj-shell-field-bg']]) {
      expect(contrastRatio(ring, surface), `${ring} on ${surface}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('AWJ Core — scope boundary (shell tokens only)', () => {
  it.each([['light', CORE_LIGHT], ['dark', CORE_DARK]])('%s block defines exactly the 13 shell tokens and nothing else', (_mode, selector) => {
    const names = [...block(selector).matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]).sort();
    expect(names).toEqual([...SHELL_TOKENS].sort());
  });

  it('is gated and keyed on the theme attribute: no Core rule can apply without data-awj-ui="3" + data-awj-theme="core"', () => {
    expect(block(CORE_LIGHT).startsWith('html[data-awj-ui="3"][data-awj-theme="core"]')).toBe(true);
    expect(block(CORE_DARK).startsWith('html[data-awj-ui="3"][data-awj-theme="core"]')).toBe(true);
    expect(css.match(/data-awj-theme="core"/g)?.length).toBe(2);
  });

  it('the Dark override comes after the unconditional dark block so it wins on order as well as specificity', () => {
    expect(css.indexOf(CORE_DARK)).toBeGreaterThan(css.indexOf('html[data-awj-ui="3"].dark {'));
    expect(css.indexOf(CORE_LIGHT)).toBeGreaterThan(css.indexOf('html[data-awj-ui="3"][data-awj-theme="ink"]:not(.dark)'));
  });
});

describe('AWJ Core — Default and Ink are untouched', () => {
  it('Default Light shell values are unchanged', () => {
    const defaults = block('html[data-awj-ui="3"]:not(.dark)');
    expect(defaults).toContain('--awj-shell-bg: #D5DFF0;');
    expect(defaults).toContain('--awj-shell-fg: #12203B;');
    expect(defaults).toContain('--awj-shell-active-bg: #FFFFFF;');
    expect(defaults).toContain('--awj-shell-apex: #1E40AF;');
  });

  it('Ink Light shell values are unchanged', () => {
    const ink = block('html[data-awj-ui="3"][data-awj-theme="ink"]:not(.dark)');
    expect(ink).toContain('--awj-shell-bg: #0E1A31;');
    expect(ink).toContain('--awj-shell-fg: #E8EEF9;');
    expect(ink).toContain('--awj-shell-apex: #7FA8FF;');
  });

  it('Ink-Dark = Default-Dark (D-12) still holds: the unconditional dark block carries the Ink shell values', () => {
    const dark = block('html[data-awj-ui="3"].dark');
    for (const [name, value] of Object.entries(resolved.themeInk)) {
      expect(dark, `${name} must be reused verbatim from theme.ink`).toContain(`${name}: ${value};`);
    }
  });

  it('Core has the same token set as Default and Ink (values differ, roles and names do not)', () => {
    const keys = (o: Record<string, string>) => Object.keys(o).sort();
    expect(keys(resolved.themeCoreLight)).toEqual(keys(resolved.themeDefault));
    expect(keys(resolved.themeCoreDark)).toEqual(keys(resolved.themeInk));
  });
});

describe('AWJ Core — contrast of every shell role against its background', () => {
  const REQUIRED_ROLES = [
    'shell-fg/shell-bg',
    'shell-fg-muted/shell-bg',
    'shell-fg-muted/shell-hover',
    'shell-apex/shell-bg (leaf text)',
    'shell-apex/shell-hover (hover text)',
    'shell-active-fg/shell-active-bg',
    'shell-apex/shell-active-bg (rail)',
    'shell-fg/shell-field-bg',
    'shell-fg-muted/shell-field-bg',
    'shell-field-line/shell-field-bg',
    'shell-focus-ring/shell-bg',
    'shell-focus-ring/shell-field-bg',
    'shell-brandmark-bg/shell-bg',
  ];
  const results = checkContrasts(tokens) as Array<{ name: string; ratio: number; min: number; pass: boolean }>;

  it.each(['light', 'dark'].flatMap((mode) => REQUIRED_ROLES.map((role) => [mode, role] as const)))(
    'core.%s %s is registered and passes',
    (mode, role) => {
      const hit = results.find((r) => r.name === `theme.core.${mode}.${role}`);
      expect(hit, `contrast check theme.core.${mode}.${role} is not registered`).toBeTruthy();
      expect(hit!.pass, `${hit!.name}: ${hit!.ratio.toFixed(2)} < ${hit!.min}`).toBe(true);
    }
  );

  // Core-Dark only: the Active/Hover/Focus roles added with design M (D-42).
  const DARK_EXTRA_ROLES = [
    'shell-fg/shell-hover',
    'shell-fg-muted/shell-active-bg',
    'shell-focus-ring/shell-hover',
    'shell-focus-ring/shell-active-bg',
    'shell-hover/shell-bg (structural)',
    'shell-active-bg/shell-hover (structural)',
    'shell-active-bg/shell-bg (structural)',
  ];
  it.each(DARK_EXTRA_ROLES)('core.dark %s is registered and passes', (role) => {
    const hit = results.find((r) => r.name === `theme.core.dark.${role}`);
    expect(hit, `contrast check theme.core.dark.${role} is not registered`).toBeTruthy();
    expect(hit!.pass, `${hit!.name}: ${hit!.ratio.toFixed(2)} < ${hit!.min}`).toBe(true);
  });

  it('text roles require 4.5:1, non-text indicators 3:1, structural separations their own floor', () => {
    for (const r of results.filter((x) => x.name.startsWith('theme.core.'))) {
      if (r.name.includes('(structural)')) {
        expect(r.min, r.name).toBeGreaterThanOrEqual(1.2);
        continue;
      }
      const textual = /(shell-fg|leaf text|hover text|shell-active-fg)/.test(r.name);
      expect(r.min, r.name).toBe(textual ? 4.5 : 3.0);
    }
  });
});

describe('AWJ Core — hand-written shell focus rule (globals.css)', () => {
  const globals = readFileSync(path.join(repoRoot, 'web/src/app/globals.css'), 'utf8');
  const rule = globals.slice(globals.indexOf('/* AWJ Core shell focus'));

  it('is scoped to Core inside the shell, so Default/Ink focus rendering is unchanged', () => {
    expect(rule).toContain('html[data-awj-ui="3"][data-awj-theme="core"] [data-awj-shell] :is(a[href], button');
    expect(rule).toContain('outline-color: var(--awj-shell-focus-ring);');
  });

  it('leaves popovers inside the chrome (which sit on Paper) on the workspace ring', () => {
    expect(rule).toContain(':not(:is([role="menu"], [role="dialog"], [role="listbox"], [role="tooltip"]) *)');
  });

  it('uses tokens only — no raw hex in the Core rule', () => {
    const body = rule.slice(rule.indexOf('*/') + 2, rule.indexOf('}') + 1);
    expect(body).toContain('outline-color');
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
