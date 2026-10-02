import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  BEGIN_MARKER,
  END_MARKER,
  buildCss,
  getPath,
  resolveRef,
} from '../../../scripts/generate-awj-tokens.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../');
const tokensPath = path.resolve(repoRoot, 'design-system/tokens/awj.tokens.json');
const cssPath = path.resolve(repoRoot, 'web/src/app/globals.css');

function loadTokens() {
  return JSON.parse(readFileSync(tokensPath, 'utf8'));
}

describe('resolveRef / getPath', () => {
  it('resolves a direct primitive reference', () => {
    const tokens = { primitive: { brand: { 600: '#1E40AF' } } };
    expect(getPath(tokens, 'primitive.brand.600')).toBe('#1E40AF');
  });

  it('resolves a nested {value} wrapper one level deep', () => {
    const tokens = {
      primitive: { brand: { 600: '#1E40AF' } },
      semantic: { action: { primary: { value: '{primitive.brand.600}' } } },
    };
    expect(resolveRef('{semantic.action.primary}', tokens)).toBe('#1E40AF');
  });

  it('resolves references embedded inside a longer literal string', () => {
    const tokens = { semantic: { text: { primary: { value: '#15181D' } } } };
    expect(resolveRef('4px double {semantic.text.primary}', tokens)).toBe('4px double #15181D');
  });

  it('throws on an unresolved reference rather than silently emitting garbage', () => {
    expect(() => resolveRef('{does.not.exist}', {})).toThrow(/unresolved reference/);
  });
});

describe('AWJ token drift guard', () => {
  it('the generated block checked into globals.css matches a fresh build from awj.tokens.json', () => {
    // This is the ratchet: if someone edits the JSON source without re-running the
    // generator, or hand-edits the generated CSS block directly, this test fails.
    const tokens = loadTokens();
    const expected = buildCss(tokens);

    const css = readFileSync(cssPath, 'utf8');
    const beginIdx = css.indexOf(BEGIN_MARKER);
    const endIdx = css.indexOf(END_MARKER);
    expect(beginIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(-1);

    const actual = css.slice(beginIdx, endIdx + END_MARKER.length);
    expect(actual).toBe(expected);
  });

  it('every generated rule is scoped under the html[data-awj-ui="3"] gate', () => {
    // Structural guarantee behind "gate OFF must preserve current behavior": nothing
    // generated can leak outside the gated selector.
    const tokens = loadTokens();
    const block = buildCss(tokens);
    const selectorLines = block
      .split('\n')
      .filter((line) => line.trimEnd().endsWith('{'))
      .map((line) => line.trim());

    expect(selectorLines.length).toBeGreaterThan(0);
    for (const selector of selectorLines) {
      // `@media (max-height…) {` wrappers are fine; the rule inside them is checked on its own line.
      expect(selector.startsWith('html[data-awj-ui="3"]') || selector.startsWith('@media')).toBe(true);
    }
  });

  it('globals.css still defines every v2.0 alias variable the gate-off experience depends on', () => {
    const css = readFileSync(cssPath, 'utf8');
    const rootBlock = css.slice(css.indexOf(':root'), css.indexOf('.dark {'));
    for (const legacyVar of [
      '--background',
      '--surface',
      '--text',
      '--muted',
      '--border',
      '--primary',
      '--primary-hover',
      '--primary-soft',
      '--primary-foreground',
      '--positive',
      '--negative',
      '--warning',
    ]) {
      expect(rootBlock.includes(`${legacyVar}:`)).toBe(true);
    }
  });
});
