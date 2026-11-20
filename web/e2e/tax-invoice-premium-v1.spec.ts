import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { inspectPdf } from '../src/lib/__tests__/helpers/pdf-inspect';

/**
 * AWJ-DOC-TAX-PREMIUM-V1 — الفاتورة الضريبية الفاخرة في Chromium حقيقي (حاضنة `/document-qa`).
 * هندسة المعاينة (بلا فيضان/تداخل/كلمات مكسورة) + PDF التصدير الفعلي: صفحة A4 واحدة لعينة المرجع بهامش 0،
 * وأكثر من صفحة للفاتورة الطويلة. حدود صريحة: لا طابعة حقيقية، ولا Safari/iPhone.
 * التشغيل: `npx playwright test e2e/tax-invoice-premium-v1.spec.ts --project=desktop`.
 */
const base = '/document-qa?type=tax_invoice&template=tax-invoice-premium-v1&qr=on&logo=on&assets=on';

async function open(page: Page, scenario: string, direction: 'rtl' | 'ltr', extra = '') {
  await page.goto(`${base}&scenario=${scenario}&direction=${direction}${extra}`, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.addStyleTag({ content: 'nextjs-portal, #next-logo, [data-nextjs-dev-tools-button], [data-nextjs-toast] { display: none !important; }' });
  await expect(page.locator('#qa-print-root')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const root = document.getElementById('qa-print-root') as HTMLElement;
    const rr = root.getBoundingClientRect();
    const mm = (px: number) => (px * 25.4) / 96;
    const all = [...root.querySelectorAll<HTMLElement>('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const outside = all.filter((e) => { const r = e.getBoundingClientRect(); return r.right > rr.right + 1 || r.left < rr.left - 1; }).length;
    let overlaps = 0;
    for (const tr of root.querySelectorAll('tr')) {
      const cells = [...tr.children].map((c) => c.getBoundingClientRect());
      for (let i = 0; i < cells.length; i += 1) for (let j = i + 1; j < cells.length; j += 1) {
        const a = cells[i]; const b = cells[j];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps += 1;
      }
    }
    return { wMm: mm(rr.width), hMm: mm(rr.height), outside, overlaps, composition: root.getAttribute('data-doc-composition'), dir: root.getAttribute('dir') };
  });
}

async function exportPdf(page: Page) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.getByTestId('qa-download-pdf').click()]);
  return inspectPdf(await readFile((await download.path())!));
}

for (const direction of ['rtl', 'ltr'] as const) {
  test.describe(`tax-invoice-premium-v1 ${direction}`, () => {
    test('default A4: 210mm sheet, no overflow, no overlapping cells', async ({ page }) => {
      await open(page, 'reference_sample', direction);
      const g = await geometry(page);
      expect(g.composition).toBe('tax_invoice_premium');
      expect(g.dir).toBe(direction);
      expect(g.wMm).toBeCloseTo(210, 0);
      expect(g.outside).toBe(0);
      expect(g.overlaps).toBe(0);
    });

    test('A4 with zero margins: the reference sample fits exactly one A4 page (preview + exported PDF)', async ({ page }) => {
      await open(page, 'reference_sample', direction, '&paper=a4&orientation=portrait&margins=0');
      const g = await geometry(page);
      expect(g.hMm).toBeLessThanOrEqual(297.5);
      expect(g.outside).toBe(0);
      const pdf = await exportPdf(page);
      expect(pdf.pageCount).toBe(1);
      expect(pdf.mediaBoxes[0].widthPt).toBeCloseTo(595.28, 0);
    });

    test('a 40-line invoice flows onto several pages without clipping', async ({ page }) => {
      await open(page, 'multipage', direction, '&paper=a4&orientation=portrait&margins=0');
      const g = await geometry(page);
      expect(g.hMm).toBeGreaterThan(297.5);
      expect(g.outside).toBe(0);
      expect(g.overlaps).toBe(0);
      const pdf = await exportPdf(page);
      expect(pdf.pageCount).toBeGreaterThanOrEqual(2);
    });
  });
}

test('unsupported paper (A5) is rejected by the template contract: preview stays on the legacy A4 frame', async ({ page }) => {
  await open(page, 'reference_sample', 'rtl', '&paper=a5&orientation=portrait');
  expect((await geometry(page)).wMm).toBeCloseTo(210, 0);
});
