import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AI provider test draft preservation', () => {
  it('does not reload the form after provider connection testing', () => {
    const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
    const start = source.indexOf('async function testAiProvider');
    const end = source.indexOf('\n  if (loading && !overview)', start);
    const testFunction = source.slice(start, end);

    expect(testFunction).not.toContain('await load()');
  });
});
