import { describe, expect, it } from 'vitest';
import {
  confidencePercentage,
  documentFieldTranslationKey,
  reviewHasVisibleBlocker,
} from './document-review';

describe('مساعدات مساحة مراجعة المستندات', () => {
  it('تستبدل مفاتيح الدليل الشائعة بتسميات مترجمة', () => {
    expect(documentFieldTranslationKey('document_number')).toBe('fieldDocumentNumber');
    expect(documentFieldTranslationKey('total_minor')).toBe('fieldTotalMinor');
    expect(documentFieldTranslationKey('unmapped_field')).toBe('field');
  });

  it('تحول درجة الأساس الصحيحة إلى نسبة آمنة للعرض', () => {
    expect(confidencePercentage(8750)).toBe(88);
    expect(confidencePercentage(10001)).toBeNull();
    expect(confidencePercentage(null)).toBeNull();
  });

  it('يعطل الإكمال المرئي عند مطابقة معلقة أو مشكلة مانعة', () => {
    expect(reviewHasVisibleBlocker([{ status: 'suggested' }], [])).toBe(true);
    expect(reviewHasVisibleBlocker([{ status: 'confirmed' }], [{ severity: 'blocking', status: 'open' }])).toBe(true);
    expect(reviewHasVisibleBlocker([{ status: 'confirmed' }], [{ severity: 'warning', status: 'open' }])).toBe(false);
  });
});
