// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

afterEach(() => cleanup());
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { useDocumentLabelMode } from './use-document-label-mode';
import type { DocumentModel } from '../types';

function wrap(locale: 'ar' | 'en') {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={{}}>
        {children}
      </NextIntlClientProvider>
    );
  };
}

const base: DocumentModel = {
  type: 'tax_invoice',
  currency: 'SAR',
  direction: 'rtl',
  seller: { name: 'نبراكس', vatNumber: null, crNumber: null, address: null, phone: null, mobile: null, tagline: null, logoText: null, logoUrl: null, logoHeight: null },
  buyer: { name: 'عميل', vatNumber: null, city: null },
  meta: { number: 'INV-1', date: '2026-01-01', dueDate: null, paymentType: 'cash' },
  lines: [],
  totals: { subtotal: 0, discount: 0, shipping: 0, adjustment: 0, tax: 0, grandTotal: 0 },
};

describe('useDocumentLabelMode — document language beats UI locale', () => {
  it('يعطي الأولوية لـmodel.language=ar بغضّ النظر عن UI EN', () => {
    const { result } = renderHook(() => useDocumentLabelMode({ ...base, language: 'ar' }), { wrapper: wrap('en') });
    expect(result.current.mode).toBe('ar');
  });

  it('يعطي الأولوية لـmodel.language=en بغضّ النظر عن UI AR', () => {
    const { result } = renderHook(() => useDocumentLabelMode({ ...base, language: 'en' }), { wrapper: wrap('ar') });
    expect(result.current.mode).toBe('en');
  });

  it('bilingual يفرض السطرين حتى مع تطابق UI locale مع اتجاه المستند', () => {
    const { result } = renderHook(() => useDocumentLabelMode({ ...base, language: 'bilingual' }), { wrapper: wrap('ar') });
    expect(result.current.mode).toBe('bilingual');
  });

  it('غياب model.language يبقي السلوك القديم: UI ar + rtl = ar', () => {
    const { result } = renderHook(() => useDocumentLabelMode({ ...base, language: null }), { wrapper: wrap('ar') });
    expect(result.current.mode).toBe('ar');
  });

  it('غياب model.language + UI en + rtl = bilingual (سلوك ما قبل PR-LANG-1 حرفياً)', () => {
    const { result } = renderHook(() => useDocumentLabelMode({ ...base, language: null, direction: 'rtl' }), { wrapper: wrap('en') });
    expect(result.current.mode).toBe('bilingual');
  });
});
