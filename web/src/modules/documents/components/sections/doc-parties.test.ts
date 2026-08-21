import { describe, expect, it } from 'vitest';
import { DOCUMENT_PARTY_CARD_LABEL_CLASS } from './doc-parties';

describe('DOCUMENT_PARTY_CARD_LABEL_CLASS', () => {
  it('لا يضيف تباعداً بين حروف عناوين البائع والعميل وبيانات الفاتورة', () => {
    expect(DOCUMENT_PARTY_CARD_LABEL_CLASS).not.toContain('tracking-');
    expect(DOCUMENT_PARTY_CARD_LABEL_CLASS).not.toContain('uppercase');
  });

  it('يحافظ على الحجم والوزن واللون الدلالي للعناوين', () => {
    expect(DOCUMENT_PARTY_CARD_LABEL_CLASS).toContain('text-[10px]');
    expect(DOCUMENT_PARTY_CARD_LABEL_CLASS).toContain('font-bold');
    expect(DOCUMENT_PARTY_CARD_LABEL_CLASS).toContain('text-muted');
  });
});
