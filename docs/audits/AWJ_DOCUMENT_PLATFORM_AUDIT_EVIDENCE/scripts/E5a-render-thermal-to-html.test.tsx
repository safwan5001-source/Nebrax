// @vitest-environment node
// Scratch (not in repo): render the real thermal templates to static HTML with real ar/en messages.
import { describe, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import ar from '/home/user/Nebrax/web/src/messages/ar.json';
import en from '/home/user/Nebrax/web/src/messages/en.json';
import { TaxReceiptThermal58, TaxReceiptThermal80 } from '/home/user/Nebrax/web/src/modules/documents/templates/thermal-receipt';
import { makeDocumentQaModel } from '/home/user/Nebrax/web/src/modules/documents/qa/document-qa-fixtures';
import { getTheme } from '/home/user/Nebrax/web/src/modules/documents/themes';

const state = { locale: 'ar' as 'ar' | 'en' };
function lookup(ns: string, key: string) {
  const root: any = state.locale === 'ar' ? ar : en;
  const v = ns.split('.').reduce((o: any, k) => o?.[k], root)?.[key];
  return typeof v === 'string' ? v : `[${ns}.${key}]`;
}
vi.mock('next-intl', () => ({
  useLocale: () => state.locale,
  useTranslations: (ns: string) => (key: string) => lookup(ns, key),
}));

const OUT = process.env.THERM_OUT as string;
describe('render thermal', () => {
  it('writes html', () => {
    fs.mkdirSync(OUT, { recursive: true });
    for (const locale of ['ar', 'en'] as const) {
      state.locale = locale;
      for (const scenario of ['single', 'five', 'twenty', 'long_content'] as const) {
        for (const w of [58, 80] as const) {
          const model = makeDocumentQaModel({ documentType: 'simplified_tax_invoice', scenario, direction: locale === 'ar' ? 'rtl' : 'ltr', showQr: true, showAssets: true });
          const C = w === 58 ? TaxReceiptThermal58 : TaxReceiptThermal80;
          const html = renderToStaticMarkup(<C model={model} theme={getTheme('blue')} formatMoney={(m: number) => (m / 100).toFixed(2) + ' SAR'} rootId="print-root" />);
          fs.writeFileSync(`${OUT}/thermal_${w}_${locale}_${scenario}.html`, html);
        }
      }
    }
  });
});
