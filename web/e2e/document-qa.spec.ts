import { expect, test, type Page } from '@playwright/test';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const evidenceDir = path.resolve(process.cwd(), 'test-results/document-qa');
const templates = ['tax-invoice-erp', 'tax-invoice-modern', 'tax-invoice-minimal'] as const;
const commercialTypes = ['quotation', 'sales_order', 'purchase_order', 'purchase_invoice', 'delivery_note'] as const;
const visualSamples = new Set([
  'quotation:tax-invoice-erp:rtl',
  'sales_order:tax-invoice-modern:rtl',
  'purchase_order:tax-invoice-erp:ltr',
  'purchase_invoice:tax-invoice-erp:rtl',
  'delivery_note:tax-invoice-minimal:rtl',
  'delivery_note:tax-invoice-modern:ltr',
]);
const viewports = [
  { name: '390', width: 390, height: 844 },
  { name: '430', width: 430, height: 932 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 900 },
  { name: '1440', width: 1440, height: 960 },
] as const;

type QaMetrics = {
  viewport: number;
  documentWidth: number;
  horizontalOverflow: boolean;
  rootWidth: number;
  rootHeight: number;
  rootScrollWidth: number;
  rootScrollHeight: number;
  scalerWidth: number;
  selectorVisible: boolean;
  selectorClipped: boolean;
};

function qaUrl(options: Record<string, string>) {
  return `${baseUrl}/document-qa?${new URLSearchParams(options).toString()}`;
}

async function saveEvidence(name: string, value: unknown) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, `${name}.json`), JSON.stringify(value, null, 2));
}

async function captureMetrics(page: Page): Promise<QaMetrics> {
  return page.evaluate(() => {
    const root = document.getElementById('qa-print-root');
    const scaler = document.querySelector<HTMLElement>('.doc-scaler-outer');
    const selector = document.querySelector<HTMLElement>('[data-testid="qa-template-selector"]');
    if (!root || !scaler || !selector) throw new Error('QA preview controls are missing');
    const rootRect = root.getBoundingClientRect();
    const selectorRect = selector.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      rootWidth: Math.round(rootRect.width),
      rootHeight: Math.round(rootRect.height),
      rootScrollWidth: root.scrollWidth,
      rootScrollHeight: root.scrollHeight,
      scalerWidth: Math.round(scaler.getBoundingClientRect().width),
      selectorVisible: selectorRect.width > 0 && selectorRect.height > 0,
      selectorClipped: selectorRect.left < 0 || selectorRect.right > window.innerWidth || selectorRect.top < 0 || selectorRect.bottom > window.innerHeight,
    };
  });
}

async function openQa(page: Page, options: Record<string, string>) {
  await page.context().addCookies([{
    name: 'locale',
    value: options.direction === 'ltr' ? 'en' : 'ar',
    url: baseUrl,
  }]);
  await page.goto(qaUrl(options));
  await expect(page.getByTestId('document-qa-page')).toBeVisible();
  await expect(page.locator('#qa-print-root')).toBeVisible();
  await expect(page.getByTestId('qa-template-selector')).toBeVisible();
}

test.describe('Document QA — scenarios, A4 and responsive preview', () => {
  test.setTimeout(900_000);

  test('يرسم ERP وModern وMinimal لكل نوع واتجاه، ويغطي أحجام البنود الأربعة لكل نوع من دون تجاوز أفقي', async ({ page }) => {
    const evidence: Array<Record<string, unknown>> = [];
    const scenarios = ['single', 'five', 'twenty', 'multipage'] as const;
    const cases = [
      ...commercialTypes.flatMap((type) => templates.flatMap((template) => ['rtl', 'ltr'].map((direction) => ({ type, template, direction, scenario: 'five' as const })))),
      ...commercialTypes.flatMap((type) => scenarios.map((scenario) => ({ type, template: 'tax-invoice-erp' as const, direction: 'rtl' as const, scenario }))),
    ];

    for (const { type, template, direction, scenario } of cases) {
      const qaPage = await page.context().newPage();
      try {
        await qaPage.setViewportSize({ width: 1440, height: 960 });
        await openQa(qaPage, { type, template, direction, scenario, logo: 'on', qr: 'on', assets: 'on' });
        const metrics = await captureMetrics(qaPage);
        expect(metrics.horizontalOverflow, JSON.stringify(metrics)).toBe(false);
        expect(metrics.rootScrollWidth).toBeGreaterThanOrEqual(790);
        expect(metrics.rootHeight).toBeGreaterThan(1_040);
        expect(metrics.selectorVisible).toBe(true);
        expect(metrics.selectorClipped).toBe(false);
        if (scenario === 'multipage') expect(metrics.rootHeight).toBeGreaterThan(2_000);
        if (scenario === 'five' && visualSamples.has(`${type}:${template}:${direction}`)) {
          await qaPage.screenshot({ path: `test-results/document-qa/visual-${type}-${template}-${direction}.png`, fullPage: true });
        }
        evidence.push({ type, template, direction, scenario, ...metrics });
      } finally {
        await qaPage.close();
      }
    }

    await saveEvidence('scenario-matrix', evidence);
    await test.info().attach('scenario-matrix.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  });

  test('يتحقق من logo وBank وStamp وSignature عند دعمها، ويمنع QR والملخص المالي في Delivery Note', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    for (const type of commercialTypes) {
      for (const template of ['tax-invoice-erp'] as const) {
        const qaPage = await page.context().newPage();
        try {
          await qaPage.setViewportSize({ width: 1440, height: 960 });
          await openQa(qaPage, { type, template, direction: 'rtl', scenario: 'multipage', logo: 'on', qr: 'on', assets: 'on' });
          await expect(qaPage.locator('img[alt*="شركة نبراكس"]')).toBeVisible();
          await expect(qaPage.getByTestId('qa-document-type-selector')).toHaveValue(type);
          if (type === 'quotation' || type === 'purchase_invoice') await expect(qaPage.getByText('البنك الأهلي السعودي')).toBeVisible();
          if (type === 'quotation') await expect(qaPage.locator('img[alt="stamp"]')).toBeVisible();
          if (type === 'quotation' || type === 'sales_order' || type === 'purchase_order' || type === 'delivery_note') await expect(qaPage.locator('img[alt="التوقيع"]')).toBeVisible();
          if (type === 'delivery_note') {
            await expect(qaPage.getByText('الإجمالي شامل الضريبة')).toHaveCount(0);
            await expect(qaPage.getByText('ضريبة القيمة المضافة (15%)')).toHaveCount(0);
          }

          await openQa(qaPage, { type, template, direction: 'ltr', scenario: 'single', logo: 'off', qr: 'off', assets: 'off' });
          await expect(qaPage.locator('img[alt*="Nebrax QA"]')).toHaveCount(0);
          await expect(qaPage.locator('img[alt="stamp"]')).toHaveCount(0);
          await expect(qaPage.locator('img[alt="التوقيع"]')).toHaveCount(0);
          await expect(qaPage.getByText('National Commercial Bank')).toHaveCount(0);
          await expect(qaPage.getByText('QA-only QR payload')).toHaveCount(0);
        } finally {
          await qaPage.close();
        }
      }
    }
  });

  test('يبقي معاينة A4 ومحدد القالب مرئيين بلا تجاوز أفقي عند المقاسات المطلوبة', async ({ page }) => {
    const evidence: Array<Record<string, unknown>> = [];
    for (const viewport of viewports) {
      for (const [index, type] of commercialTypes.entries()) {
        for (const template of [templates[index % templates.length]]) {
          const qaPage = await page.context().newPage();
          try {
            await qaPage.setViewportSize({ width: viewport.width, height: viewport.height });
            await openQa(qaPage, { type, template, direction: 'rtl', scenario: 'twenty', logo: 'on', qr: 'on', assets: 'on' });
            const metrics = await captureMetrics(qaPage);
            expect(metrics.horizontalOverflow, JSON.stringify(metrics)).toBe(false);
            expect(metrics.selectorVisible).toBe(true);
            expect(metrics.selectorClipped, JSON.stringify(metrics)).toBe(false);
            expect(metrics.scalerWidth).toBeGreaterThan(0);
            evidence.push({ viewportName: viewport.name, type, template, ...metrics });
            await qaPage.screenshot({ path: `test-results/document-qa/${viewport.name}-${type}-${template}.png`, fullPage: true });
          } finally {
            await qaPage.close();
          }
        }
      }
    }
    await saveEvidence('responsive-preview', evidence);
    await test.info().attach('responsive-preview.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  });

  test('ينتج PDF عبر مسار التصدير الحالي وطباعة Chromium على A4 لسيناريو متعدد الصفحات', async ({ page }) => {
    for (const [index, type] of commercialTypes.entries()) {
      for (const template of [templates[index % templates.length]]) {
        const printPage = await page.context().newPage();
        try {
          await printPage.setViewportSize({ width: 1440, height: 960 });
          await openQa(printPage, { type, template, direction: 'rtl', scenario: 'multipage', logo: 'on', qr: 'on', assets: 'on' });
          await printPage.locator('#qa-print-root').evaluate((element) => element.setAttribute('data-print-target', ''));
          await printPage.emulateMedia({ media: 'print' });
          const printMetrics = await printPage.evaluate(() => {
            const root = document.getElementById('qa-print-root');
            if (!root) throw new Error('Missing QA print root');
            const rootStyle = getComputedStyle(root);
            return {
              rootVisibility: rootStyle.visibility,
              rootDisplay: rootStyle.display,
              rootWidth: root.getBoundingClientRect().width,
              rootHeight: root.getBoundingClientRect().height,
            };
          });
          await test.info().attach(`${type}-${template}-print-metrics.json`, { body: JSON.stringify(printMetrics, null, 2), contentType: 'application/json' });
          expect(printMetrics.rootVisibility, JSON.stringify(printMetrics)).toBe('visible');
          expect(printMetrics.rootHeight, JSON.stringify(printMetrics)).toBeGreaterThan(1_000);
          const printPdf = await printPage.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
          const printPath = path.join(evidenceDir, `${type}-${template}-multipage-browser-print.pdf`);
          await mkdir(evidenceDir, { recursive: true });
          await writeFile(printPath, printPdf);
          expect(printPdf.byteLength).toBeGreaterThan(10_000);
          await test.info().attach(`${type}-${template}-browser-print.pdf`, { body: printPdf, contentType: 'application/pdf' });
        } finally {
          await printPage.close();
        }

        const exportPage = await page.context().newPage();
        try {
          await exportPage.setViewportSize({ width: 1440, height: 960 });
          await openQa(exportPage, { type, template, direction: 'rtl', scenario: 'multipage', logo: 'on', qr: 'on', assets: 'on' });
          const downloadPromise = exportPage.waitForEvent('download');
          await exportPage.getByRole('button', { name: 'Download PDF' }).click();
          const download = await downloadPromise;
          const exportPath = path.join(evidenceDir, `${type}-${template}-multipage-export.pdf`);
          await download.saveAs(exportPath);
          expect((await stat(exportPath)).size).toBeGreaterThan(10_000);
          await test.info().attach(`${type}-${template}-export.pdf`, { path: exportPath, contentType: 'application/pdf' });
        } finally {
          await exportPage.close();
        }
      }
    }
  });
});
