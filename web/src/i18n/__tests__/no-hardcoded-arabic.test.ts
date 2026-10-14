import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ERP-UX-025: نصوص عربية مكتوبة في الكود تتجاوز كتالوج الترجمة فتظهر في الواجهة الإنجليزية.
 * الملفات المحوَّلة تُضاف هنا فلا تعود إليها نصوص ثابتة. يُستثنى السطر التعليقي فقط.
 */
const CONVERTED = [
  'app/(app)/invoices/page.tsx',
  'app/(app)/products/page.tsx',
  'app/(app)/credit-notes/page.tsx',
  'app/(app)/debit-notes/page.tsx',
  'app/(app)/suppliers/page.tsx',
];

const ARABIC = /[؀-ۿ]/;
const LITERAL = /(['"`])((?:(?!\1).)*?)\1/g;
const JSX_TEXT = />([^<>{}]*[؀-ۿ][^<>{}]*)</g;

function arabicLiterals(path: string): string[] {
  const source = readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
  const hits: string[] = [];
  source.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('{/*')) return;
    const code = line.includes('://') ? line : line.split('//')[0];
    for (const match of code.matchAll(LITERAL)) if (ARABIC.test(match[2])) hits.push(`${index + 1}: ${match[2]}`);
    for (const match of code.matchAll(JSX_TEXT)) hits.push(`${index + 1}: ${match[1].trim()}`);
  });
  return hits;
}

describe('no hard-coded Arabic UI strings in converted files', () => {
  it.each(CONVERTED)('%s', (path) => {
    expect(arabicLiterals(path)).toEqual([]);
  });
});
