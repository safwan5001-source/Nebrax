// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { useTranslations } from 'next-intl';
import { renderIntl, TEST_LOCALES } from '@/test-utils/intl';
import arMessages from '@/messages/ar.json';

afterEach(cleanup);

/**
 * كل مسارات الأوراق النصّية تحت `developer` **بلا وسائط** (بلا `{...}`)، ومع تخطّي
 * المفاتيح المنقّطة (مثل `events.partner.created`) لأنها تُعنوَن بـ `t.raw` لا `t()`
 * (next-intl يقسّم على النقطة). تُفحَص خريطة الأحداث منفصلةً أدناه.
 */
function argFreeLeafPaths(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return node.includes('{') ? [] : [prefix];
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
      key.includes('.') ? [] : argFreeLeafPaths(value, prefix ? `${prefix}.${key}` : key));
  }
  return [];
}

const PATHS = argFreeLeafPaths(arMessages.developer);

function Probe({ path }: { path: string }) {
  const t = useTranslations('developer');
  return <>{t(path)}</>;
}

function EventsProbe() {
  const t = useTranslations('developer');
  const events = t.raw('events') as Record<string, string>;
  return <>{Object.entries(events).map(([key, value]) => <span key={key} data-key={key}>{value}</span>)}</>;
}

/**
 * حارس تصيير الترجمة: يرصد الرسائل التي يكسرها مُحلِّل ICU/الوسوم في next-intl —
 * `<...>` (تُقرأ وسماً) أو `{...}` بلا وسيطة — فيتحوّل النصّ إلى مفتاحه الخام على
 * الشاشة (كما حدث في `security.bearerBody`/`signatureBody`). يُصيّر كل رسالة بلا
 * وسائط ويؤكّد أنها لا تظهر كمسار مفتاح.
 */
describe('developer namespace renders (no ICU/tag breakage)', () => {
  it('has argument-free leaves to check', () => {
    expect(PATHS.length).toBeGreaterThan(50);
  });

  it('resolves dotted event-description keys via t.raw (three events)', () => {
    for (const locale of TEST_LOCALES) {
      const { container, unmount } = renderIntl(<EventsProbe />, locale);
      const spans = container.querySelectorAll('span[data-key]');
      expect(spans.length).toBe(3);
      spans.forEach((span) => expect((span.textContent ?? '').length).toBeGreaterThan(3));
      unmount();
    }
  });

  for (const locale of TEST_LOCALES) {
    it(`renders every argument-free message as text, not a raw key (${locale})`, () => {
      for (const path of PATHS) {
        const { container, unmount } = renderIntl(<Probe path={path} />, locale);
        const text = container.textContent ?? '';
        expect(text, `developer.${path}`).not.toContain('developer.');
        expect(text.length, `developer.${path}`).toBeGreaterThan(0);
        unmount();
      }
    });
  }
});
