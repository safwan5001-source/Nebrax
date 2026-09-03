import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AI provider save action', () => {
  it('keeps save and test actions together on each provider card', () => {
    const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('update={(field, value) => updateProvider(provider, field, value)} save={saveAi} test={() => testAiProvider(provider)}');
    expect(source).toContain('update, save, test, t');
    expect(source).toContain('onClick={save}');
    expect(source).toContain("busy === 'document_ai'");
    expect(source).toContain("{t('save')}");
  });
});
