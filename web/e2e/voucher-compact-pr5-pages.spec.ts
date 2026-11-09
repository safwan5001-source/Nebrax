import { devices, expect, test, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectPdf } from '../src/lib/__tests__/helpers/pdf-inspect';

/**
 * AWJ-DOC-V2-PR5 — السند المدمج `voucher-compact` على الصفحة الحقيقية `/payments/[id]` (قبض وصرف) في Chromium حقيقي،
 * بواجهة API مُعترَضة بالكامل (بلا خلفية). تثبت ما لا تثبته حاضنة `/document-qa`:
 *  • الحقول الإضافية من سجل الدفعة (طريقة محددة/تفاصيل/حساب/مُحصِّل/تصنيف) واسم الفرع من `/branches/{id}` تصل إلى المستند.
 *  • غياب أي حقل في الاستجابة (واجهة قديمة) أو فشل قراءة الفرع = لا سطر ولا اختلاق، والصفحة تعمل.
 *  • المراجعة المثبتة A5 أفقي: معاينة + `@page` + طباعة + PDF بمقاس الملف، وA6 أفقي لسند قصير.
 *  • لا QR ولا باركود في السند. وحماية المستندات التاريخية: المراجعة المثبتة بقالب آخر لا تتأثر.
 *
 * حدود صريحة: لا طابعة حقيقية (محاكاة `page.pdf`)، iPhone = محاكاة Chromium لا Safari، لا Web CI لـPlaywright.
 * التشغيل: `npx playwright test e2e/voucher-compact-pr5-pages.spec.ts --project=desktop`.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const evidenceDir = path.resolve(process.cwd(), 'test-results/voucher-compact-pr5');
const PT_PER_MM = 72 / 25.4;
const SIZE_TOLERANCE_MM = 0.8;
const LEGACY_PRINT = '@media print { @page { size: 210mm 297mm; } }';

const LOGO = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="180" height="64"%3E%3Crect width="180" height="64" fill="%231e40af"/%3E%3C/svg%3E';
const STAMP = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="120" height="120"%3E%3Ccircle cx="60" cy="60" r="50" fill="none" stroke="%231e40af" stroke-width="6"/%3E%3C/svg%3E';
const SIGNATURE = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="72"%3E%3Cpath d="M8 49 C35 14, 43 56, 70 29 S105 55, 133 28" fill="none" stroke="%23111827" stroke-width="3"/%3E%3C/svg%3E';

type Profile = Record<string, unknown>;
const A5L: Profile = { paper: 'a5', orientation: 'landscape' };
const A6L: Profile = { paper: 'a6', orientation: 'landscape' };
const A5P: Profile = { paper: 'a5' };

const marginCss = (w: number, h: number, m: number) => `@media print { @page { size: ${w}mm ${h}mm; margin: ${m}mm ${m}mm ${m}mm ${m}mm; } }`;

function revision({ id, template = 'voucher-compact', profile, layout }: { id: string; template?: string; profile?: Profile; layout?: unknown[] }) {
  return {
    id, version: 1, document_types: [],
    definition: {
      template_id: template, theme_id: 'blue', show_logo: true, footer_text: 'تذييل المستند',
      stamp: STAMP, signature: SIGNATURE,
      ...(layout ? { layout } : {}),
      ...(profile ? { output_profile: profile } : {}),
    },
  };
}

const money = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const squash = (value: string) => value.replace(/[\s٬،,]+/g, '');
const pageSizeMm = (info: ReturnType<typeof inspectPdf>, i = 0) => ({ w: info.mediaBoxes[i].widthPt / PT_PER_MM, h: info.mediaBoxes[i].heightPt / PT_PER_MM });

const EXTRAS = {
  payment_method_name: 'تحويل بنكي — مصرف الراجحي',
  payment_details: 'حوالة رقم 7782',
  collector_employee_name: 'خالد العتيبي',
  cash_account_code: '1120',
  cash_account_name: 'الحساب البنكي الرئيسي',
  // ملاحظة: `PaymentController::show()` لا يحمّل علاقة التصنيف اليوم، فلا يصل في استجابة التفاصيل الحقيقية حتى يُضاف التحميل (قرار خلفية
  // خارج هذه الشريحة). الحاضنة تحاكي استجابة تحمّله ليُثبَت أن القالب يعرضه متى وصل.
  classification: { id: 'c1', name: 'تسوية عملاء', scope: 'both' },
};

function allocations(count: number) {
  return Array.from({ length: count }, (_, i) => ({ label: `فاتورة INV-2026-${String(i + 1).padStart(4, '0')}`, amount: '24691357.80' }));
}
const totalOf = (count: number) => (24691357.8 * count).toFixed(2);

interface World {
  direction: 'received' | 'paid';
  frozen?: unknown;
  frozenPdf?: unknown;
  extras?: boolean;
  allocs?: number;
  branch?: 'ok' | 'fail' | 'none';
  status?: string;
}

function paymentPayload(world: World) {
  const count = world.allocs ?? 2;
  return {
    id: 'pay1', number: world.direction === 'received' ? 'RCV-2026-000123' : 'PAY-2026-000123', payment_date: '2026-08-26', direction: world.direction,
    method: 'bank', amount: totalOf(count), reference: 'REF-2026-0007', notes: 'سداد دفعة المشروع الإقليمي.', status: world.status ?? 'posted',
    branch_id: world.branch === 'none' ? null : 'b1', partner_id: 'p1', allocations: allocations(count),
    ...(world.extras === false ? {} : EXTRAS),
    print_template_revision: world.frozen ?? null, pdf_template_revision: world.frozenPdf ?? null, thermal_template_revision: null,
  };
}

async function openPage(browser: Browser, world: World, opts: { mobile?: boolean } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(opts.mobile ? { ...devices['iPhone 13'], acceptDownloads: true } : { viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addCookies([{ name: 'locale', value: 'ar', url: baseUrl }]);
  const page = await context.newPage();
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: 'owner', permissions: ['*'] };

  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    if (p === '/applications/nav-state') return json(route, { data: {} });
    if (p === '/me') return json(route, { user, company: { name: 'شركة نبراكس للتجارة', vat_number: '310122393500003', cr_number: '2050123456', logo: LOGO } });
    if (p === '/partners/p1') return json(route, { data: { id: 'p1', name: 'مؤسسة الخليج للتوريد', vat_number: '311111111100003', city: 'الخبر' } });
    if (p === '/print-templates/resolve') return json(route, { data: null });
    if (p === '/branches/b1') return world.branch === 'fail' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"x"}' }) : json(route, { data: { id: 'b1', name: 'فرع الدمام' } });
    if (p === '/payments/pay1') return json(route, { data: paymentPayload(world) });
    return json(route, { data: [] });
  });
  await page.addInitScript((userJson) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    (window as unknown as { __printStyle: string | null }).__printStyle = null;
    window.print = () => { (window as unknown as { __printStyle: string | null }).__printStyle = document.getElementById('nebrax-doc-print-page')?.textContent ?? null; };
  }, JSON.stringify(user));

  await page.goto(`${baseUrl}/payments/pay1`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#print-root')).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: 'nextjs-portal, #next-logo, [data-nextjs-dev-tools-button], [data-nextjs-toast] { display: none !important; }' });
  return { context, page };
}

async function clickAction(page: Page, name: RegExp) {
  await page.getByRole('button', { name }).first().click();
}

async function printedStyle(page: Page): Promise<string | null> {
  await clickAction(page, /^(Print|طباعة)$/);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printStyle: string | null }).__printStyle)).not.toBeNull();
  return page.evaluate(() => (window as unknown as { __printStyle: string | null }).__printStyle);
}

async function printPagePdf(page: Page) {
  // `printDocument` يوسم وجهة الطباعة (`data-print-target`) لحظة `window.print` ثم يزيلها؛ المحاكاة تعيد الوسم ليُطبع الجذر وحده
  // كما في الطباعة الحقيقية (وإلا ظهرت عناصر الصفحة المحيطة في `page.pdf`).
  await page.evaluate(() => document.getElementById('print-root')?.setAttribute('data-print-target', ''));
  await page.emulateMedia({ media: 'print' });
  const buffer = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => document.getElementById('print-root')?.removeAttribute('data-print-target'));
  return { buffer, info: inspectPdf(buffer) };
}

async function downloadPdf(page: Page) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), clickAction(page, /^(Download PDF|تنزيل PDF)$/)]);
  const buffer = await readFile((await download.path())!);
  return { buffer, info: inspectPdf(buffer) };
}

async function inkBox(buffer: Buffer, widthMm: number, heightMm: number, pageNumber = 1) {
  const dir = path.join(tmpdir(), `vc5p-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(path.join(dir, 'in.pdf'), buffer);
    execFileSync('pdftoppm', ['-gray', '-r', '40', '-f', String(pageNumber), '-l', String(pageNumber), path.join(dir, 'in.pdf'), path.join(dir, 'p')]);
    const file = (await readdir(dir)).find((n) => n.startsWith('p-') && n.endsWith('.pgm'))!;
    const data = await readFile(path.join(dir, file));
    let pos = 0;
    const token = () => { while (data[pos] === 0x20 || data[pos] === 0x0a || data[pos] === 0x0d) pos += 1; const s = pos; while (data[pos] > 0x20) pos += 1; return data.subarray(s, pos).toString('ascii'); };
    token(); const w = Number(token()); const h = Number(token()); token(); pos += 1;
    let minX = w; let minY = h; let maxX = -1; let maxY = -1;
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (data[pos + y * w + x] < 200) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    if (maxX < 0) return null;
    return { left: minX * widthMm / w, top: minY * heightMm / h, right: (maxX + 1) * widthMm / w, bottom: (maxY + 1) * heightMm / h };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const rootText = (page: Page) => page.locator('#print-root').innerText();
const sheet = (page: Page) => page.locator('[data-doc-sheet]:not([data-doc-sheet-hidden])');

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { await mkdir(evidenceDir, { recursive: true }); });

for (const direction of ['received', 'paid'] as const) {
  test.describe(`السند المدمج · ${direction}`, () => {
    test('A5 أفقي مثبَّت: الحقول الإضافية والفرع تصل، ولا QR، والمعاينة/@page/الطباعة/PDF بمقاس الملف', async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(180_000);
      const { context, page } = await openPage(browser, { direction, frozen: revision({ id: 'f', profile: A5L }) });
      try {
        await expect(page.locator('#print-root')).toHaveAttribute('data-doc-composition', 'voucher_compact');
        await expect(sheet(page)).toHaveAttribute('data-doc-sheet-paper', '210x148');
        const text = await rootText(page);
        for (const value of ['تحويل بنكي — مصرف الراجحي', 'حوالة رقم 7782', 'خالد العتيبي', '1120 — الحساب البنكي الرئيسي', 'تسوية عملاء', 'فرع الدمام', 'REF-2026-0007', 'سداد دفعة المشروع الإقليمي.']) {
          expect(text, `حقل مفقود: ${value}`).toContain(value);
        }
        expect(text).toContain(direction === 'received' ? 'استلمنا من' : 'صرفنا إلى');
        expect(await page.locator('#print-root svg, #print-root canvas').count(), 'لا QR/باركود').toBe(0);
        expect(await page.locator('#print-root [data-voucher-allocations] tr').count()).toBe(2);
        expect(squash(text)).toContain(squash(money(Number(totalOf(2)))));

        const style = await printedStyle(page);
        expect(style).toBe(marginCss(210, 148, 10));
        const printed = await printPagePdf(page);
        const size = pageSizeMm(printed.info);
        expect(Math.abs(size.w - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        expect(Math.abs(size.h - 148)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        // وجهة الطباعة المطلقة تلتصق بأعلى الصفحة (لا فراغ علوي من عناصر الصفحة المخفية بصرياً): يقاس ذلك قبل `page.pdf`.
        await page.evaluate(() => document.getElementById('print-root')?.setAttribute('data-print-target', ''));
        await page.emulateMedia({ media: 'print' });
        expect(await page.evaluate(() => Math.round(document.getElementById('print-root')!.getBoundingClientRect().top)), 'فراغ علوي في الطباعة').toBe(0);
        await page.emulateMedia({ media: 'screen' });
        expect(printed.info.pageCount, 'صفحة واحدة').toBe(1);
        const box = await inkBox(printed.buffer, 210, 148);
        expect(box).not.toBeNull();
        expect(box!.left).toBeGreaterThanOrEqual(10 - 1.6);
        expect(box!.top).toBeGreaterThanOrEqual(10 - 1.6);
        expect(box!.right).toBeLessThanOrEqual(210 - 10 + 1.6);
        expect(box!.bottom).toBeLessThanOrEqual(148 - 10 + 1.6);

        const exported = await downloadPdf(page);
        const exportSize = pageSizeMm(exported.info);
        expect(Math.abs(exportSize.w - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        expect(Math.abs(exportSize.h - 148)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        expect(exported.info.pageCount).toBe(1);
        await writeFile(path.join(evidenceDir, `page-${direction}-a5l.json`), JSON.stringify({ style, print: { pages: printed.info.pageCount, ...size }, export: { pages: exported.info.pageCount, ...exportSize } }, null, 2));
      } finally {
        await context.close();
      }
    });

    test('A6 أفقي لسند قصير (تخصيص واحد): صفحة واحدة بمقاس A6 في الطباعة وPDF', async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(180_000);
      const { context, page } = await openPage(browser, { direction, frozen: revision({ id: 'f', profile: A6L }), extras: false, allocs: 1, branch: 'none' });
      try {
        await expect(sheet(page)).toHaveAttribute('data-doc-sheet-paper', '148x105');
        await expect(page.locator('#print-root [data-voucher-compact]')).toHaveAttribute('data-voucher-density', 'tight');
        expect(await printedStyle(page)).toBe(marginCss(148, 105, 8));
        const printed = await printPagePdf(page);
        expect(printed.info.pageCount).toBe(1);
        expect(Math.abs(pageSizeMm(printed.info).w - 148)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        expect(Math.abs(pageSizeMm(printed.info).h - 105)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        const exported = await downloadPdf(page);
        expect(exported.info.pageCount).toBe(1);
        expect(Math.abs(pageSizeMm(exported.info).w - 148)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        expect(Math.abs(pageSizeMm(exported.info).h - 105)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
      } finally {
        await context.close();
      }
    });

    test('واجهة قديمة بلا حقول إضافية وفرع بلا قراءة: لا أسطر مختلقة والصفحة تعمل', async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(180_000);
      const { context, page } = await openPage(browser, { direction, frozen: revision({ id: 'f', profile: A5L }), extras: false, branch: 'fail' });
      try {
        const text = await rootText(page);
        for (const absent of ['فرع الدمام', 'الحساب', 'المُحصِّل', 'التصنيف', 'تفاصيل الدفع']) expect(text, `سطر مختلق: ${absent}`).not.toContain(absent);
        expect(text).toContain('REF-2026-0007');
        expect(await page.locator('#print-root [data-voucher-field]').count(), 'الطريقة والمرجع فقط').toBe(2);
      } finally {
        await context.close();
      }
    });

    test('سند بتخصيصات كثيرة (A5 أفقي): ينساب على صفحات بلا قصّ وكل المبالغ في الطباعة', async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(180_000);
      const { context, page } = await openPage(browser, { direction, frozen: revision({ id: 'f', profile: A5L }), allocs: 12 });
      try {
        expect(await printedStyle(page)).toBe(marginCss(210, 148, 10));
        const printed = await printPagePdf(page);
        expect(printed.info.pageCount).toBeGreaterThan(1);
        const text = squash(await rootText(page));
        for (const row of allocations(12)) expect(text).toContain(squash(money(Number(row.amount))));
        for (let i = 1; i <= printed.info.pageCount; i += 1) {
          const box = await inkBox(printed.buffer, 210, 148, i);
          expect(box, `ص${i}`).not.toBeNull();
          expect(box!.bottom).toBeLessThanOrEqual(148 - 10 + 1.6);
          expect(box!.right).toBeLessThanOrEqual(210 - 10 + 1.6);
        }
      } finally {
        await context.close();
      }
    });

    test('تخطيط مراجعة PDF المحفوظ يُحترم: توقيع/ختم/بيان/تفقيط مخفية في جذر PDF الملتقَط وظاهرة في الطباعة', async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(180_000);
      const layout = [
        { key: 'header', visible: true }, { key: 'parties', visible: true }, { key: 'voucher', visible: true },
        { key: 'amountWords', visible: false }, { key: 'notes', visible: false }, { key: 'signature', visible: false },
        { key: 'stamp', visible: false }, { key: 'footer', visible: true },
      ];
      const { context, page } = await openPage(browser, { direction, frozen: revision({ id: 'p', profile: A5L }), frozenPdf: revision({ id: 'd', profile: A5L, layout }) });
      try {
        const printRoot = await page.evaluate(() => ({
          seals: [...document.querySelectorAll('#print-root img')].filter((img) => !(img.getAttribute('src') ?? '').includes('width%3D%22180%22') && !(img.getAttribute('src') ?? '').includes('width="180"')).length,
          words: document.querySelectorAll('#print-root [data-voucher-words]').length,
          notes: document.querySelectorAll('#print-root [data-voucher-notes]').length,
        }));
        expect(printRoot.seals, 'الطباعة بتخطيط السند الثابت: ختم وتوقيع ظاهران').toBeGreaterThanOrEqual(2);
        expect(printRoot.words).toBe(1);
        expect(printRoot.notes).toBe(1);
        const pdfRoot = await page.evaluate(() => {
          const root = document.getElementById('pdf-print-root');
          return {
            seals: [...(root?.querySelectorAll('img') ?? [])].filter((img) => !(img.getAttribute('src') ?? '').includes('width%3D%22180%22') && !(img.getAttribute('src') ?? '').includes('width="180"')).length,
            words: root?.querySelectorAll('[data-voucher-words]').length ?? -1,
            notes: root?.querySelectorAll('[data-voucher-notes]').length ?? -1,
            compact: root?.querySelectorAll('[data-voucher-compact]').length ?? -1,
          };
        });
        expect(pdfRoot.compact).toBe(1);
        expect(pdfRoot.seals, 'ختم/توقيع مخفيان في مراجعة PDF').toBe(0);
        expect(pdfRoot.words, 'تفقيط مخفي').toBe(0);
        expect(pdfRoot.notes, 'بيان مخفي').toBe(0);
      } finally {
        await context.close();
      }
    });

    test('حماية التاريخي: مراجعة مثبتة بقالب آخر (classic-v2 A5) لا تتأثر بوجود القالب الجديد', async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(180_000);
      const { context, page } = await openPage(browser, { direction, frozen: revision({ id: 'f', template: 'tax-invoice-classic-v2', profile: A5L }) });
      try {
        await expect(page.locator('#print-root')).toHaveAttribute('data-doc-composition', 'classic_v2');
        expect(await page.locator('#print-root [data-voucher-compact]').count()).toBe(0);
      } finally {
        await context.close();
      }
    });
  });
}

test('بلا ملف إخراج: السند المدمج يطبع A4 كما كان (لا ورقة معاينة)', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
  test.setTimeout(180_000);
  const { context, page } = await openPage(browser, { direction: 'received', frozen: revision({ id: 'f' }) });
  try {
    await expect(page.locator('#print-root')).toHaveAttribute('data-doc-composition', 'voucher_compact');
    expect(await sheet(page).count()).toBe(0);
    expect(await printedStyle(page)).toBe(LEGACY_PRINT);
  } finally {
    await context.close();
  }
});

test('جوال: معاينة A5 أفقي بلا تمرير أفقي للصفحة', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
  test.setTimeout(180_000);
  const { context, page } = await openPage(browser, { direction: 'received', frozen: revision({ id: 'f', profile: A5P }) }, { mobile: true });
  try {
    await expect(sheet(page)).toHaveAttribute('data-doc-sheet-paper', '148x210');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await context.close();
  }
});
