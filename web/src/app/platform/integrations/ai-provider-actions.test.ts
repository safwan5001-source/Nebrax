import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('platform AI provider actions', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/platform/integrations/page.tsx'), 'utf8');

  it('keeps provider connection testing available before the extraction engine is enabled', () => {
    expect(source).not.toContain('engineEnabled');
    expect(source).not.toContain('disabled={!engineEnabled');
    expect(source).not.toContain('title={!engineEnabled');
    expect(source).toContain('disabled={busy !== null || testing !== null}');
    expect(source).toContain("body: { provider }");
  });

  it('blocks Gemini tests on unsaved changes without rehydrating the AI form after a test', () => {
    const start = source.indexOf('async function testAiProvider');
    const end = source.indexOf('if (loading && !overview)');
    const testFn = source.slice(start, end);

    expect(testFn).toContain('isGoogleGeminiDirty');
    expect(testFn).toContain('saveBeforeTest');
    expect(testFn).toContain("body: { provider }");
    expect(testFn).not.toContain('hydrateAiForm');
    expect(testFn).not.toContain('await load()');
    expect(source).toContain("provider === 'google_gemini' ? saveAi : undefined");
  });
});
