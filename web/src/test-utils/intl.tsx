import * as React from 'react';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import arMessages from '@/messages/ar.json';
import enMessages from '@/messages/en.json';

/**
 * عرضٌ داخل مزوّد الترجمة الحقيقي برسائل المشروع نفسها — لا رسائل وهمية.
 *
 * مكوّنات `nebrax/` طبقةٌ ستُعمَّم على واجهة ثنائية اللغة، فاختبارُها بترجمةٍ
 * مزيّفة يثبت أنها تستدعي مفتاحاً لا أنها تعرض النصّ الصحيح في كل لغة. هنا
 * تُقرأ `ar.json` و`en.json` كما تُقرأ في الإنتاج، فينكسر الاختبار حين ينكسر
 * المفتاح فعلاً.
 */
export const TEST_MESSAGES = { ar: arMessages, en: enMessages } as const;

export type TestLocale = keyof typeof TEST_MESSAGES;

export const TEST_LOCALES: TestLocale[] = ['ar', 'en'];

export function renderIntl(
  ui: React.ReactElement,
  locale: TestLocale = 'ar',
  options?: Omit<RenderOptions, 'wrapper'>
): RenderResult {
  return render(ui, {
    ...options,
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <NextIntlClientProvider locale={locale} messages={TEST_MESSAGES[locale] as unknown as AbstractIntlMessages} timeZone="Asia/Riyadh">
        {children}
      </NextIntlClientProvider>
    ),
  });
}

/** نصّ مترجَم من مجموعة `nebrax` — مصدرُ التوقّع هو ملفّ الرسائل لا نسخةٌ يدوية. */
export function nebraxText(locale: TestLocale, key: keyof typeof arMessages.nebrax): string {
  return TEST_MESSAGES[locale].nebrax[key];
}
