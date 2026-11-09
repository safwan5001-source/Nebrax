// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CATALOG, STATION, closedDetail, frozenCollection, translator } from './__fixtures__';
import { buildShiftReport } from './model';
import { ShiftReportPreview } from './preview';

afterEach(cleanup);

const model = (locale: 'ar' | 'en') => buildShiftReport({
  t: translator(locale), company: { name: 'Acme' }, station: STATION, detail: closedDetail(), catalog: CATALOG, collection: frozenCollection(),
  viewer: { id: 'u1', name: 'Sami Operator' }, paper: 'a4', generatedAt: new Date('2026-11-03T14:00:00Z'),
});

/** المعاينة تعزل النص اللاتيني/الأرقام LTR كي لا يقلب سياق RTL ترتيب «التاريخ الوقت» (انحدار: نمط regex خاطئ كان سيُسقط dir). */
describe('report preview direction', () => {
  it.each([['ar'], ['en']] as const)('(%s) timestamps, litres and the shift number are isolated LTR; Arabic text is left to its context', (locale) => {
    const { container } = render(<div dir={locale === 'ar' ? 'rtl' : 'ltr'}><ShiftReportPreview model={model(locale)} /></div>);
    const spanOf = (value: string) => Array.from(container.querySelectorAll('span')).find((el) => el.textContent === value) as HTMLElement | undefined;
    for (const value of ['2026-11-03 08:00', '2026-11-03 16:00', 'SH-100', '8:00', '790.500']) {
      const el = spanOf(value);
      expect(el, `${value} (${locale})`).toBeTruthy();
      expect(el?.getAttribute('dir'), `${value} (${locale})`).toBe('ltr');
    }
    // نص عربي أو مختلط (عملة عربية) لا يُجبَر على LTR.
    const arabic = Array.from(container.querySelectorAll('span')).filter((el) => /[؀-ۿ]/.test(el.textContent ?? ''));
    for (const el of arabic) expect(el.getAttribute('dir')).toBeNull();
  });
});
