import { devices, expect, test, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectPdf } from '../src/lib/__tests__/helpers/pdf-inspect';

/**
 * AWJ-DOC-V2-PR4 — الصفحات الحقيقية لفاتورة المشتريات (`/purchases/[id]`) والسند الرسمي (`/payments/[id]`، قبض وصرف)
 * في Chromium حقيقي، بواجهة API مُعترَضة بالكامل (بلا خلفية). تثبت ما لا تثبته حاضنة `/document-qa`:
 *  • قراءة `output_profile` من **المراجعة المثبتة** (وأنها تتقدّم على أي تعيين حي مغاير) وبالمسودة من التعيين الحي.
 *  • الطباعة الفعلية: `@page` المحقون + `page.pdf` على الصفحة الحقيقية نفسها (الحبر داخل الهوامش).
 *  • تنزيل PDF: السند بملف مطبَّق = التقاط الجذر بمقاس الملف؛ بلا ملف = المحرك المتجهي A4 كما كان (نص قابل للاستخراج).
 *  • مراجعة PDF المستقلة (`pdf_template_revision` ≠ الطباعة) تُلتقَط من جذرها المخفي ولا تظهر ورقتها على الشاشة.
 *  • المبالغ والضرائب لا تتغير بتطبيق الملف (نفس رموز الأرقام في الجذر مع الملف وبدونه).
 *
 * حدود صريحة: لا طابعة حقيقية (محاكاة `page.pdf`)، iPhone = محاكاة Chromium لا Safari، لا Web CI لـPlaywright.
 * التشغيل: `npx playwright test e2e/output-profile-pr4-pages.spec.ts --project=desktop`.
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const evidenceDir = path.resolve(process.cwd(), 'test-results/output-profile-pr4');
const PT_PER_MM = 72 / 25.4;
const SIZE_TOLERANCE_MM = 0.8;
const LEGACY_PRINT = '@media print { @page { size: 210mm 297mm; } }';

const STAMP = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="120" height="120"%3E%3Ccircle cx="60" cy="60" r="50" fill="none" stroke="%231e40af" stroke-width="6"/%3E%3C/svg%3E';
const SIGNATURE = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="72"%3E%3Cpath d="M8 49 C35 14, 43 56, 70 29 S105 55, 133 28" fill="none" stroke="%23111827" stroke-width="3"/%3E%3C/svg%3E';

type Profile = Record<string, unknown>;
const A5L: Profile = { paper: 'a5', orientation: 'landscape' };
const A4L: Profile = { paper: 'a4', orientation: 'landscape' };
const A6L: Profile = { paper: 'a6', orientation: 'landscape' };
const A5P: Profile = { paper: 'a5' };

const marginCss = (w: number, h: number, m: number) => `@media print { @page { size: ${w}mm ${h}mm; margin: ${m}mm ${m}mm ${m}mm ${m}mm; } }`;

interface RevisionOptions { id: string; template?: string; profile?: Profile; layout?: unknown[] }
function revision({ id, template = 'tax-invoice-classic-v2', profile, layout }: RevisionOptions) {
  return {
    id, version: 1, document_types: [],
    definition: {
      template_id: template, theme_id: 'blue', show_logo: true, footer_text: 'تذييل المستند', bank_text: 'البنك الأهلي — IBAN SA0000000000000000000000',
      stamp: STAMP, signature: SIGNATURE,
      ...(layout ? { layout } : {}),
      ...(profile ? { output_profile: profile } : {}),
    },
  };
}

const money = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const squash = (value: string) => value.replace(/[\s٬،,]+/g, '');
const pageSizeMm = (info: ReturnType<typeof inspectPdf>, i = 0) => ({ w: info.mediaBoxes[i].widthPt / PT_PER_MM, h: info.mediaBoxes[i].heightPt / PT_PER_MM });

/** مبالغ كبيرة (≈ 24.7 مليون ريال لكل تخصيص). */
const ALLOCATIONS = Array.from({ length: 6 }, (_, i) => ({ label: `فاتورة INV-2026-${String(i + 1).padStart(4, '0')}`, amount: '24691357.80' }));
const PAYMENT_TOTAL = '148148146.80';

function paymentPayload(direction: 'received' | 'paid', revisions: { print?: unknown; pdf?: unknown }) {
  return {
    id: 'pay1', number: direction === 'received' ? 'RCV-2026-000123' : 'PAY-2026-000123', payment_date: '2026-08-26', direction,
    method: 'bank', amount: PAYMENT_TOTAL, reference: 'REF-2026-0007', notes: 'سداد دفعة المشروع الإقليمي.', status: 'posted', branch_id: null, partner_id: 'p1',
    allocations: ALLOCATIONS,
    print_template_revision: revisions.print ?? null, pdf_template_revision: revisions.pdf ?? null, thermal_template_revision: null,
  };
}

const PURCHASE_LINES = Array.from({ length: 8 }, (_, i) => ({
  id: `l${i + 1}`, description: `صنف مشتريات ${i + 1}`, quantity: i + 1, unit_price: '1250.00', line_discount: '0.00', line_tax: String((i + 1) * 187.5), line_total: String((i + 1) * 1437.5),
}));
const PURCHASE_TOTAL = PURCHASE_LINES.reduce((sum, l) => sum + Number(l.line_total), 0);

function purchasePayload(posted: boolean, revisions: { print?: unknown; pdf?: unknown }) {
  const subtotal = PURCHASE_LINES.reduce((sum, l) => sum + Number(l.unit_price) * l.quantity, 0);
  return {
    id: 'pu1', number: 'PUR-2026-0040', branch_id: null, partner_id: 'p1', payment_type: 'credit', status: posted ? 'posted' : 'draft', document_linked: false,
    payment_status: 'unpaid', purchase_date: '2026-08-26', supplier_invoice_no: 'SUP-7781', subtotal: subtotal.toFixed(2), tax_amount: (PURCHASE_TOTAL - subtotal).toFixed(2),
    total: PURCHASE_TOTAL.toFixed(2), discount: '0.00', shipping: '0.00', adjustment: '0.00', paid_amount: '0.00', remaining: PURCHASE_TOTAL.toFixed(2),
    due_date: '2026-09-25', received_status: 'received', received_date: '2026-08-27', lines: PURCHASE_LINES,
    print_template_revision: revisions.print ?? null, pdf_template_revision: revisions.pdf ?? null, thermal_template_revision: null,
    language_effective: 'ar', attachments: [],
  };
}

interface World { kind: 'payment_received' | 'payment_paid' | 'purchase'; frozen?: { print?: unknown; pdf?: unknown }; live?: unknown; draft?: boolean }

async function openPage(browser: Browser, world: World, opts: { locale?: 'ar' | 'en'; mobile?: boolean } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const locale = opts.locale ?? 'en';
  const context = await browser.newContext(opts.mobile ? { ...devices['iPhone 13'], acceptDownloads: true } : { viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const page = await context.newPage();
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const user = { id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: 'owner', permissions: ['*'] };

  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^.*\/api/, '');
    if (p === '/applications/nav-state') return json(route, { data: {} });
    if (p === '/me') return json(route, { user, company: { name: 'شركة نبراكس للتجارة', vat_number: '310122393500003', cr_number: '2050123456' } });
    if (p === '/partners/p1') return json(route, { data: { id: 'p1', name: 'مؤسسة الخليج للتوريد', vat_number: '311111111100003', city: 'الخبر' } });
    if (p === '/print-templates/resolve') return json(route, { data: world.live ?? null });
    if (p === '/payments/pay1') return json(route, { data: paymentPayload(world.kind === 'payment_paid' ? 'paid' : 'received', world.frozen ?? {}) });
    if (p === '/purchases/pu1') return json(route, { data: purchasePayload(!world.draft, world.frozen ?? {}) });
    if (p === '/purchases/pu1/accounting') return json(route, { data: { purchase_entry: null } });
    return json(route, { data: [] });
  });
  await page.addInitScript((userJson) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    (window as unknown as { __printStyle: string | null }).__printStyle = null;
    window.print = () => { (window as unknown as { __printStyle: string | null }).__printStyle = document.getElementById('nebrax-doc-print-page')?.textContent ?? null; };
  }, JSON.stringify(user));

  const url = world.kind === 'purchase' ? `${baseUrl}/purchases/pu1` : `${baseUrl}/payments/pay1`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#print-root')).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: 'nextjs-portal, #next-logo, [data-nextjs-dev-tools-button], [data-nextjs-toast] { display: none !important; }' });
  return { context, page };
}

/** نقرة إجراء بالاسم: زر مباشر (سند / مساحة v3) أو عنصر قائمة «إجراءات فاتورة الشراء». */
async function clickAction(page: Page, name: RegExp) {
  const direct = page.getByRole('button', { name }).first();
  if (await direct.isVisible().catch(() => false)) { await direct.click(); return; }
  await page.getByRole('button', { name: /Purchase invoice actions|إجراءات فاتورة الشراء/ }).click();
  await page.getByRole('menuitem', { name }).first().click();
}

async function printedStyle(page: Page): Promise<string | null> {
  await clickAction(page, /^(Print|طباعة)$/);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printStyle: string | null }).__printStyle)).not.toBeNull();
  return page.evaluate(() => (window as unknown as { __printStyle: string | null }).__printStyle);
}

async function printPagePdf(page: Page) {
  await page.emulateMedia({ media: 'print' });
  const buffer = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  return { buffer, info: inspectPdf(buffer) };
}

async function downloadPdf(page: Page) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), clickAction(page, /^(Download PDF|تنزيل PDF)$/)]);
  const buffer = await readFile((await download.path())!);
  return { buffer, info: inspectPdf(buffer) };
}

async function pdfText(buffer: Buffer) {
  const dir = path.join(tmpdir(), `op4p-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  try {
    const file = path.join(dir, 'p.pdf');
    await writeFile(file, buffer);
    return execFileSync('pdftotext', [file, '-']).toString();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function inkBox(buffer: Buffer, widthMm: number, heightMm: number, pageNumber = 1) {
  const dir = path.join(tmpdir(), `op4i-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

const amountTokens = (text: string) => [...text.matchAll(/\d[\d,]*\.\d{2}/g)].map((m) => m[0]).sort();
const rootText = (page: Page) => page.locator('#print-root').innerText();
const sheet = (page: Page) => page.locator('[data-doc-sheet]:not([data-doc-sheet-hidden])');

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { await mkdir(evidenceDir, { recursive: true }); });

// ───────────────────────── السند الرسمي /payments/[id] — قبض وصرف ─────────────────────────
for (const kind of ['payment_received', 'payment_paid'] as const) {
  test.describe(`السند الرسمي · ${kind}`, () => {
    test('المراجعة المثبتة A5 أفقي تتقدّم على تعيين حي مغاير: معاينة + @page + طباعة + PDF بمقاس الملف', async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(180_000);
      const live = { print_template_revision_id: 'live', revision: revision({ id: 'live', profile: A4L }) };
      const { context, page } = await openPage(browser, { kind, frozen: { print: revision({ id: 'frozen-print', profile: A5L }) }, live });
      try {
        await expect(sheet(page)).toHaveAttribute('data-doc-sheet-paper', '210x148');
        const style = await printedStyle(page);
        expect(style, 'لا تتأثر المراجعة المثبتة بالتعيين الحي').toBe(marginCss(210, 148, 10));

        const printed = await printPagePdf(page);
        const size = pageSizeMm(printed.info);
        expect(Math.abs(size.w - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        expect(Math.abs(size.h - 148)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        for (let i = 1; i <= printed.info.pageCount; i += 1) {
          const box = await inkBox(printed.buffer, 210, 148, i);
          expect(box, `طباعة ص${i}`).not.toBeNull();
          expect(box!.left).toBeGreaterThanOrEqual(10 - 1.6);
          expect(box!.top).toBeGreaterThanOrEqual(10 - 1.6);
          expect(box!.right).toBeLessThanOrEqual(210 - 10 + 1.6);
          expect(box!.bottom).toBeLessThanOrEqual(148 - 10 + 1.6);
        }

        // تنزيل PDF بملف مطبَّق = التقاط الجذر بمقاس الملف (لا المحرك المتجهي A4).
        const exported = await downloadPdf(page);
        const exportSize = pageSizeMm(exported.info);
        expect(Math.abs(exportSize.w - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        expect(Math.abs(exportSize.h - 148)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);

        // المبالغ الكبيرة كاملة والختم/التوقيع ظاهران في الجذر.
        const text = squash(await rootText(page));
        for (const row of ALLOCATIONS) expect(text).toContain(squash(money(Number(row.amount))));
        expect(text).toContain(squash(money(Number(PAYMENT_TOTAL))));
        expect(await page.locator('#print-root img').count(), 'ختم وتوقيع').toBeGreaterThanOrEqual(2);
        await writeFile(path.join(evidenceDir, `page-${kind}-a5l.json`), JSON.stringify({ style, print: { pages: printed.info.pageCount, ...size }, export: { pages: exported.info.pageCount, ...exportSize } }, null, 2));
      } finally {
        await context.close();
      }
    });

    test('بلا output_profile: الطباعة A4 كما كانت وPDF المتجهي A4 بنص قابل للاستخراج', async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(180_000);
      const { context, page } = await openPage(browser, { kind, frozen: { print: revision({ id: 'frozen-print' }) } });
      try {
        expect(await sheet(page).count(), 'لا ورقة معاينة بلا ملف').toBe(0);
        expect(await printedStyle(page)).toBe(LEGACY_PRINT);
        const exported = await downloadPdf(page);
        const size = pageSizeMm(exported.info);
        expect(Math.abs(size.w - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        expect(Math.abs(size.h - 297)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        const text = squash(await pdfText(exported.buffer));
        // المحرك المتجهي نصّي: المبلغ الإجمالي والمرجع يُستخرجان (المحرك نفسه لم يُستبدل).
        expect(text).toContain(squash(money(Number(PAYMENT_TOTAL))));
        expect(text).toContain('REF-2026-0007');
      } finally {
        await context.close();
      }
    });

    test('مراجعة PDF المستقلة (A5 أفقي) ≠ مراجعة الطباعة (A4 أفقي): PDF من جذرها المخفي وورقتها لا تظهر', async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(180_000);
      const { context, page } = await openPage(browser, {
        kind,
        frozen: { print: revision({ id: 'p', template: 'tax-invoice-classic', profile: A4L }), pdf: revision({ id: 'd', template: 'tax-invoice-classic-v2', profile: A5L }) },
      });
      try {
        expect(await printedStyle(page)).toBe(marginCss(297, 210, 14));
        // جذر PDF المستقل موجود لكن غلاف ورقته مخفي، فلا ورقة ثانية مرئية.
        expect(await page.locator('#pdf-print-root').count()).toBe(1);
        await expect(page.locator('[data-doc-sheet][data-doc-sheet-hidden="true"]')).toHaveCount(1);
        await expect(sheet(page)).toHaveCount(1);
        const exported = await downloadPdf(page);
        const size = pageSizeMm(exported.info);
        expect(Math.abs(size.w - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        expect(Math.abs(size.h - 148)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
      } finally {
        await context.close();
      }
    });

    test('جذر PDF الملتقَط يحترم تخطيط مراجعة PDF: بنك ظاهر وتوقيع/ختم مخفيان (لا التخطيط الثابت للطباعة)', async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(180_000);
      const layout = [
        { key: 'header', visible: true }, { key: 'parties', visible: true }, { key: 'voucher', visible: true }, { key: 'amountWords', visible: true },
        { key: 'bank', visible: true }, { key: 'signature', visible: false }, { key: 'stamp', visible: false }, { key: 'footer', visible: true },
      ];
      const { context, page } = await openPage(browser, { kind, frozen: { print: revision({ id: 'p', profile: A5L }), pdf: revision({ id: 'd', profile: A5L, layout }) } });
      try {
        // جذر الطباعة بتخطيط السند الثابت: ختم وتوقيع ظاهران، بلا بنك.
        expect(await page.locator('#print-root img').count(), 'ختم وتوقيع في الطباعة').toBeGreaterThanOrEqual(2);
        // جذر PDF (مخفي على الشاشة) بتخطيط مراجعة PDF: بنك نعم، صور لا.
        const pdfRoot = await page.evaluate(() => {
          const root = document.getElementById('pdf-print-root');
          return { text: root?.textContent ?? '', images: root?.querySelectorAll('img').length ?? -1 };
        });
        expect(pdfRoot.text).toContain('IBAN SA0000000000000000000000');
        expect(pdfRoot.images, 'توقيع/ختم مخفيان في مراجعة PDF').toBe(0);
        const exported = await downloadPdf(page);
        const size = pageSizeMm(exported.info);
        expect(Math.abs(size.w - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        expect(Math.abs(size.h - 148)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
      } finally {
        await context.close();
      }
    });

    test('سند بمراجعة PDF مثبتة فقط (بلا مراجعة طباعة): PDF من لقطته لا من التعيين الحي', async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(180_000);
      // تعيين حي للطباعة بملف A4 أفقي، بينما اللقطة المثبتة للـPDF A5 أفقي: يجب أن يتبع PDF اللقطة.
      const live = { print_template_revision_id: 'live', revision: revision({ id: 'live', profile: A4L }) };
      const { context, page } = await openPage(browser, { kind, frozen: { pdf: revision({ id: 'd', profile: A5L }) }, live });
      try {
        const exported = await downloadPdf(page);
        const size = pageSizeMm(exported.info);
        expect(Math.abs(size.w - 210), `PDF اتبع التعيين الحي (${size.w}×${size.h})`).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        expect(Math.abs(size.h - 148)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
      } finally {
        await context.close();
      }
    });

    test('ملف غير مدعوم من القالب (A6 عمودي على classic) يُعامل كغائب', async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(120_000);
      const { context, page } = await openPage(browser, { kind, frozen: { print: revision({ id: 'f', template: 'tax-invoice-classic', profile: { paper: 'a6' } }) } });
      try {
        expect(await sheet(page).count()).toBe(0);
        expect(await printedStyle(page)).toBe(LEGACY_PRINT);
      } finally {
        await context.close();
      }
    });

    test('المبالغ لا تتغير بتطبيق الملف (نفس رموز الأرقام مع الملف وبدونه)', async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(180_000);
      const tokens: string[][] = [];
      for (const profile of [undefined, A5L, A4L]) {
        const { context, page } = await openPage(browser, { kind, frozen: { print: revision({ id: 'f', template: 'tax-invoice-classic-v2', profile }) } });
        try { tokens.push(amountTokens(await rootText(page))); } finally { await context.close(); }
      }
      expect(tokens[0].length).toBeGreaterThan(5);
      expect(tokens[1]).toEqual(tokens[0]);
      expect(tokens[2]).toEqual(tokens[0]);
    });
  });
}

test.describe('السند الرسمي · الحي والاتجاهان والجوال', () => {
  test('المسودة (بلا مراجعة مثبتة) تقرأ الملف من التعيين الحي: A6 أفقي', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
    test.setTimeout(120_000);
    const live = { print_template_revision_id: 'live', revision: revision({ id: 'live', profile: A6L }) };
    const { context, page } = await openPage(browser, { kind: 'payment_received', live });
    try {
      await expect(sheet(page)).toHaveAttribute('data-doc-sheet-paper', '148x105');
      expect(await printedStyle(page)).toBe(marginCss(148, 105, 8));
    } finally {
      await context.close();
    }
  });

  for (const locale of ['ar', 'en'] as const) {
    test(`A6 أفقي (classic-v2) · ${locale}: مبالغ كبيرة كاملة وبلا تمرير أفقي`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
      test.setTimeout(180_000);
      const { context, page } = await openPage(browser, { kind: 'payment_paid', frozen: { print: revision({ id: 'f', profile: A6L }) } }, { locale });
      try {
        const text = squash(await rootText(page));
        for (const row of ALLOCATIONS) expect(text).toContain(squash(money(Number(row.amount))));
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
        expect(await printedStyle(page)).toBe(marginCss(148, 105, 8));
        const printed = await printPagePdf(page);
        const size = pageSizeMm(printed.info);
        expect(Math.abs(size.w - 148)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
        expect(Math.abs(size.h - 105)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
      } finally {
        await context.close();
      }
    });
  }

  test('iPhone 13 (محاكاة Chromium): سند A5 عمودي بلا تمرير أفقي في الصفحة', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'يُدار داخل الاختبار');
    test.setTimeout(180_000);
    const { context, page } = await openPage(browser, { kind: 'payment_received', frozen: { print: revision({ id: 'f', profile: A5P }) } }, { mobile: true });
    try {
      await expect(sheet(page)).toHaveAttribute('data-doc-sheet-paper', '148x210');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'تمرير أفقي في صفحة الجوال').toBeLessThanOrEqual(1);
      await page.screenshot({ path: path.join(evidenceDir, 'iphone-payment-a5.png') });
    } finally {
      await context.close();
    }
  });
});

// ───────────────────────── فاتورة المشتريات /purchases/[id] ─────────────────────────
test.describe('فاتورة المشتريات', () => {
  test('المراجعة المثبتة A5 أفقي تتقدّم على التعيين الحي: معاينة + @page + طباعة + PDF بمقاس الملف', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
    test.setTimeout(180_000);
    const live = { print_template_revision_id: 'live', revision: revision({ id: 'live', profile: A4L }) };
    const { context, page } = await openPage(browser, { kind: 'purchase', frozen: { print: revision({ id: 'frozen-print', profile: A5L }) }, live });
    try {
      await expect(sheet(page)).toHaveAttribute('data-doc-sheet-paper', '210x148');
      expect(await printedStyle(page)).toBe(marginCss(210, 148, 10));
      const printed = await printPagePdf(page);
      const size = pageSizeMm(printed.info);
      expect(Math.abs(size.w - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
      expect(Math.abs(size.h - 148)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
      for (let i = 1; i <= printed.info.pageCount; i += 1) {
        const box = await inkBox(printed.buffer, 210, 148, i);
        expect(box, `طباعة ص${i}`).not.toBeNull();
        expect(box!.left).toBeGreaterThanOrEqual(10 - 1.6);
        expect(box!.right).toBeLessThanOrEqual(210 - 10 + 1.6);
        expect(box!.bottom).toBeLessThanOrEqual(148 - 10 + 1.6);
      }
      const exported = await downloadPdf(page);
      const exportSize = pageSizeMm(exported.info);
      expect(Math.abs(exportSize.w - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
      expect(Math.abs(exportSize.h - 148)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
      const text = squash(await rootText(page));
      for (const line of PURCHASE_LINES) expect(text).toContain(squash(money(Number(line.line_total))));
      expect(text).toContain(squash(money(PURCHASE_TOTAL)));
      await writeFile(path.join(evidenceDir, 'page-purchase-a5l.json'), JSON.stringify({ print: { pages: printed.info.pageCount, ...size }, export: { pages: exported.info.pageCount, ...exportSize } }, null, 2));
    } finally {
      await context.close();
    }
  });

  test('بلا output_profile: A4 كما كان (@page القديم وPDF 210×297)', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
    test.setTimeout(180_000);
    const { context, page } = await openPage(browser, { kind: 'purchase', frozen: { print: revision({ id: 'frozen-print' }) } });
    try {
      expect(await sheet(page).count()).toBe(0);
      expect(await printedStyle(page)).toBe(LEGACY_PRINT);
      const size = pageSizeMm((await downloadPdf(page)).info);
      expect(Math.abs(size.w - 210)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
      expect(Math.abs(size.h - 297)).toBeLessThanOrEqual(SIZE_TOLERANCE_MM);
    } finally {
      await context.close();
    }
  });

  test('المسودة تقرأ التعيين الحي (A6 أفقي) والمبالغ لا تتغير بين A4 وA6', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
    test.setTimeout(180_000);
    const tokens: string[][] = [];
    for (const profile of [undefined, A6L]) {
      const live = { print_template_revision_id: 'live', revision: revision({ id: 'live', profile }) };
      const { context, page } = await openPage(browser, { kind: 'purchase', draft: true, live });
      try {
        if (profile) {
          await expect(sheet(page)).toHaveAttribute('data-doc-sheet-paper', '148x105');
          expect(await printedStyle(page)).toBe(marginCss(148, 105, 8));
        }
        tokens.push(amountTokens(await rootText(page)));
      } finally {
        await context.close();
      }
    }
    expect(tokens[0].length).toBeGreaterThan(8);
    expect(tokens[1]).toEqual(tokens[0]);
  });

  test('ملف غير مدعوم (A6 عمودي على classic) يُعامل كغائب', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'سطح المكتب يكفي');
    test.setTimeout(120_000);
    const { context, page } = await openPage(browser, { kind: 'purchase', frozen: { print: revision({ id: 'f', template: 'tax-invoice-classic', profile: { paper: 'a6' } }) } });
    try {
      expect(await sheet(page).count()).toBe(0);
      expect(await printedStyle(page)).toBe(LEGACY_PRINT);
    } finally {
      await context.close();
    }
  });
});
