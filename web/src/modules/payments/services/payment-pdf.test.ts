import { describe, expect, it } from 'vitest';
import type { DocSectionLayoutItem } from '@/modules/documents/types';
import { resolvePaymentPdfBlockContent } from './payment-pdf';

const bankLayout = (visible: boolean, staticContent?: string): DocSectionLayoutItem[] => [
  { key: 'bank', visible, properties: staticContent === undefined ? undefined : { static_content: staticContent } },
];

describe('محتوى كتلة بنك PDF السند', () => {
  it('يفضّل المحتوى الثابت للمراجعة المنشورة على القيمة الحية', () => {
    expect(resolvePaymentPdfBlockContent(bankLayout(true, 'IBAN SA0000000000000000000000'), 'bank', 'قيمة حية أحدث'))
      .toBe('IBAN SA0000000000000000000000');
  });

  it('لا يعرض قيمة البنك إذا كانت الكتلة المثبتة مخفية', () => {
    expect(resolvePaymentPdfBlockContent(bankLayout(false), 'bank', 'قيمة حية أحدث')).toBeNull();
  });

  it('يعامل المحتوى الثابت الفارغ كتعطيل صريح للرجوع الحي', () => {
    expect(resolvePaymentPdfBlockContent(bankLayout(true, '   '), 'bank', 'قيمة حية أحدث')).toBeNull();
  });
});
