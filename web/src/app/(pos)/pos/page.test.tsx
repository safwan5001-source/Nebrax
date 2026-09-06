import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast';
import PosPage from './page';

/**
 * PR-8: يثبت هذا الاختبار أن مكوّن مساحة عمل POS (أكبر ملفات الواجهة، بلا أي
 * تغطية اختبارية سابقة) **يُركَّب في jsdom دون تعليق العملية أو استثناء غير
 * مُعالَج** — الفجوة الموثّقة في تقريري PR-6/PR-7 كانت افتراضاً غير مؤكَّد
 * بإعادة إنتاج مباشرة؛ هذا الاختبار يثبت العكس بدليل قابل للتكرار. تغطية
 * التفاعل الكاملة (فتح جلسة حقيقية، إضافة سلة، دفع) تبقى مؤجَّلة — تحتاج محاكاة
 * حقيقية لكل نقطة API التي تستدعيها الصفحة عند الإقلاع، لا لضبطٍ عابرٍ كهذا.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'ar',
}));

beforeAll(() => {
  // jsdom لا يطبّق matchMedia افتراضياً؛ الصفحة تستعمله لاكتشاف نمط سطح المكتب/الجوال.
  window.matchMedia = window.matchMedia || ((): MediaQueryList => ({
    matches: false,
    media: '',
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
});

describe('مساحة عمل نقطة البيع', () => {
  it('تُركَّب دون استثناء أو تعليق العملية (بلا جلسة/توكن — لا يوجد اتصال شبكي حقيقي)', () => {
    const { unmount } = render(
      <ToastProvider>
        <PosPage />
      </ToastProvider>,
    );
    expect(document.body).toBeTruthy();
    unmount();
  });
});
