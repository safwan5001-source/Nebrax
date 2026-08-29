import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Guardrail: date/time display formatting must go through `@/lib/formatting`.
 * Direct `ar-SA` / bare `toLocaleString()` for dates reintroduces Hijri or
 * Eastern Arabic digits on Safari and some ICU builds.
 *
 * Allowed exceptions are listed explicitly with rationale.
 */
const ROOT = join(__dirname, '../..');

const ALLOWED_DIRECT_INTL_FILES = new Set([
  // Central formatter — the only place that constructs DateTimeFormat for display.
  'lib/formatting.ts',
  // Tests that assert locale contracts and formatter output.
  'lib/__tests__/formatting.test.ts',
  'lib/__tests__/date-formatting-guardrail.test.ts',
]);

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: 'direct Intl.DateTimeFormat outside central formatter',
    pattern: /Intl\.DateTimeFormat\s*\(/,
  },
  {
    name: 'bare ar-SA DateTimeFormat/toLocale without gregory+latn',
    pattern: /(?:DateTimeFormat|toLocale(?:Date|Time)?String)\([^)]*['"]ar-SA['"]/,
  },
  {
    name: 'locale === ar ? ar-SA ternary',
    pattern: /locale\s*===\s*['"]ar['"]\s*\?\s*['"]ar-SA['"]/,
  },
  {
    name: 'bare toLocaleString() with no locale (browser default)',
    pattern: /\.toLocaleString\(\s*\)/,
  },
  {
    name: 'bare toLocaleDateString() with no locale',
    pattern: /\.toLocaleDateString\(\s*\)/,
  },
  {
    name: 'Date#toLocaleString with non-display locale',
    pattern: /new Date\([^)]*\)\.toLocale(?:Date|Time)?String\(/,
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('date formatting guardrail', () => {
  it('forbids non-central date formatting patterns outside allowlisted files', () => {
    const files = walk(ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      if (ALLOWED_DIRECT_INTL_FILES.has(rel)) continue;
      if (rel.includes('.test.') || rel.includes('.spec.')) continue;

      const source = readFileSync(file, 'utf8');
      for (const { name, pattern } of FORBIDDEN_PATTERNS) {
        if (pattern.test(source)) {
          violations.push(`${rel}: ${name}`);
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });
});
