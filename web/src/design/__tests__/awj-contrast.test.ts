import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkContrasts, contrastRatio } from '../../../scripts/generate-awj-tokens.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../');
const tokensPath = path.resolve(repoRoot, 'design-system/tokens/awj.tokens.json');

function loadTokens() {
  return JSON.parse(readFileSync(tokensPath, 'utf8'));
}

describe('contrastRatio (WCAG 2.x relative luminance)', () => {
  it('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
  });

  it('is symmetric regardless of argument order', () => {
    expect(contrastRatio('#15181D', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#15181D'), 5);
  });

  it('matches the text-primary/paper ratio documented in TOKEN_REFERENCE.md §12 (17.79)', () => {
    expect(contrastRatio('#15181D', '#FFFFFF')).toBeCloseTo(17.79, 1);
  });
});

interface ContrastResult {
  name: string;
  fg: string;
  bg: string;
  min: number;
  ratio: number;
  pass: boolean;
}

describe('AWJ v3 contrast registry (design-system/tokens/awj.tokens.json → contrastChecks)', () => {
  const tokens = loadTokens();
  const results = checkContrasts(tokens) as ContrastResult[];

  it('declares at least the pairs documented in TOKEN_REFERENCE.md §12', () => {
    expect(results.length).toBeGreaterThanOrEqual(20);
  });

  const cases: Array<[string, ContrastResult]> = results.map((r) => [r.name, r]);

  it.each(cases)('%s meets its minimum ratio', (_name: string, r: ContrastResult) => {
    expect(
      r.pass,
      `${r.name}: ${r.ratio.toFixed(2)} < required ${r.min} (fg=${r.fg} bg=${r.bg}) — this pair is forbidden; see FOUNDATIONS.md §5 / TOKEN_REFERENCE.md §12 for the allowed substitute.`
    ).toBe(true);
  });
});
