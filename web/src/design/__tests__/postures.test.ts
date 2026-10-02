import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCss } from '../../../scripts/generate-awj-tokens.mjs';

// AWJ v3 (Horizon 4) — platform postures + the Admin/Storefront boundary.
// Postures change variables, never meaning; the boundary keeps three namespaces apart:
//   --awj-*        shared/admin system        --awj-editor-* Studio chrome only
//   --store-*      merchant Storefront/Canvas (WORKSPACE_POSTURES.md, STOREFRONT_BOUNDARY.md).

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../');
const tokens = JSON.parse(readFileSync(path.join(repoRoot, 'design-system/tokens/awj.tokens.json'), 'utf8'));
const css = buildCss(tokens);

/** The closed list of allowed posture variation keys (WORKSPACE_POSTURES.md §4). */
const ALLOWED_POSTURE_KEYS = new Set([
  'density-tier', 'touch-min', 'chrome-h', 'shell-variant', 'workspace-bg', 'media-thumb',
  'motion-scale', 'display-money-size', 'selection-overlay', 'contrast-mode',
  // Concrete variable names the closed keys are realised as in this codebase:
  'control-h', 'action-h', 'row-1l', 'row-2l', 'display-money-fs',
]);

function blockFor(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing block for ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('posture tokens', () => {
  it('only uses keys from the closed allowed-variation list', () => {
    for (const posture of ['floor', 'studio'] as const) {
      for (const key of Object.keys(tokens.posture[posture])) {
        if (key.startsWith('$')) continue;
        expect(ALLOWED_POSTURE_KEYS.has(key), `${posture}.${key} is outside the closed posture key list`).toBe(true);
      }
    }
  });

  it('emits Floor variables under [data-posture="floor"] with the touch-first values', () => {
    const floor = blockFor('html[data-awj-ui="3"] [data-posture="floor"]');
    expect(floor).toContain('--awj-touch-min: 44px');
    expect(floor).toContain('--awj-action-h: 56px');
    expect(floor).toContain('--awj-display-money-fs: 36px');
  });

  it('keeps the 44px touch minimum on Floor even on the short-height (compact) layer', () => {
    const compact = css.slice(css.indexOf('@media (max-height: 740px)'));
    const floorCompact = compact.slice(compact.indexOf('[data-posture="floor"]'));
    expect(floorCompact).toContain('--awj-touch-min: 44px');
  });

  it('every generated posture/editor rule stays behind the v3 gate', () => {
    const selectors = css.split('\n').filter((line) => line.trimEnd().endsWith('{')).map((line) => line.trim());
    for (const selector of selectors) {
      expect(selector.startsWith('html[data-awj-ui="3"]') || selector.startsWith('@media')).toBe(true);
    }
  });

  it('defines the outcome action pair as fixed (mode-independent) tokens', () => {
    const modeless = blockFor('html[data-awj-ui="3"]');
    expect(modeless).toContain('--awj-outcome-action:');
    expect(modeless).toContain('--awj-outcome-action-fg:');
    expect(blockFor('html[data-awj-ui="3"].dark')).not.toContain('--awj-outcome-action');
  });
});

describe('Studio editor chrome (--awj-editor-*)', () => {
  it('is defined only under [data-posture="studio"] — never on html, Ledger or Floor', () => {
    const studio = blockFor('html[data-awj-ui="3"] [data-posture="studio"]');
    expect(studio).toContain('--awj-editor-chrome:');
    const withoutStudio = css.replace(studio, '');
    // The only other mention allowed is the Canvas reset (`initial`), which removes it.
    const leaks = withoutStudio.split('\n').filter((line) => line.includes('--awj-editor-') && !line.includes(': initial'));
    expect(leaks).toEqual([]);
  });

  it('is mode-fixed: no Light/Dark or Default/Ink variant of the editor chrome exists', () => {
    for (const selector of ['html[data-awj-ui="3"]:not(.dark)', 'html[data-awj-ui="3"].dark', 'html[data-awj-ui="3"][data-awj-theme="ink"]:not(.dark)']) {
      expect(blockFor(selector)).not.toContain('--awj-editor-');
    }
  });

  it('is reset inside the merchant Canvas root so chrome tokens cannot reach merchant content', () => {
    const reset = blockFor('html[data-awj-ui="3"] [data-posture="studio"] .awj-store-preview');
    for (const name of Object.keys(tokens.editor).filter((key) => !key.startsWith('$'))) {
      expect(reset).toContain(`--awj-editor-${name}: initial`);
    }
  });
});

describe('Admin ↔ Storefront boundary', () => {
  it('the merchant Canvas stylesheet never references the Admin namespace', () => {
    const preview = stripCssComments(readFileSync(path.join(repoRoot, 'web/src/modules/store-experience-builder/store-preview.css'), 'utf8'));
    expect(preview).not.toMatch(/--awj-/);
  });

  it('the Canvas component source never reads Admin tokens', () => {
    const canvas = readFileSync(path.join(repoRoot, 'web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx'), 'utf8');
    expect(canvas).not.toMatch(/--awj-/);
    expect(canvas).not.toMatch(/data-awj-/);
  });

  it('hand-authored Admin CSS never reads merchant tokens (comments excluded)', () => {
    const globals = stripCssComments(readFileSync(path.join(repoRoot, 'web/src/app/globals.css'), 'utf8'));
    expect(globals).not.toMatch(/var\(--store-/);
  });

  it('the public storefront package only owns the editor namespace, never the shared admin one', () => {
    const files = walk(path.join(repoRoot, 'storefront/src')).filter((file) => /\.(css|tsx?)$/.test(file) && !/\.test\./.test(file));
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const stripped = source.replace(/--awj-editor-[a-z-]+/g, '');
      if (/--awj-/.test(stripped)) offenders.push(path.relative(repoRoot, file));
    }
    expect(offenders).toEqual([]);
  });

  it('no Admin component outside the Studio module reads --store-* variables', () => {
    const allowed = [
      path.join('web', 'src', 'modules', 'store-experience-builder'),
      path.join('web', 'src', 'modules', 'app-builder'),
      path.join('web', 'src', 'app', 'globals.css'),
    ];
    const files = walk(path.join(repoRoot, 'web/src')).filter((file) => /\.(css|tsx?)$/.test(file) && !/\.test\./.test(file));
    const offenders = files
      .filter((file) => !allowed.some((prefix) => path.relative(repoRoot, file).startsWith(prefix)))
      .filter((file) => /var\(--store-/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(repoRoot, file));
    expect(offenders).toEqual([]);
  });
});
