import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('platform AI provider actions', () => {
  it('keeps provider connection testing available before the extraction engine is enabled', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/platform/integrations/page.tsx'), 'utf8');

    expect(source).not.toContain('engineEnabled');
    expect(source).not.toContain('disabled={!engineEnabled');
    expect(source).not.toContain('title={!engineEnabled');
    expect(source).toContain('disabled={busy !== null || testing !== null}');
    expect(source).toContain("body: { provider }");
  });
});
