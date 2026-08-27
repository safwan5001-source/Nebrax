import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('DataTable mobile records', () => {
  it('does not render persistent row-selection checkboxes for structured mobile records', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/data-table.tsx'), 'utf8');
    expect(source).toContain('selection && !mobileRecord && rowId != null');
  });
});
