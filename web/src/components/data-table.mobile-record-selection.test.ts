import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('DataTable mobile records', () => {
  it('keeps row-selection controls available for structured mobile records', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/data-table.tsx'), 'utf8');
    expect(source).toContain('selection && rowId != null');
    expect(source).not.toContain('selection && !mobileRecord');
  });
});
