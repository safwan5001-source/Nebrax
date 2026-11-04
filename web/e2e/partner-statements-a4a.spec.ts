import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * IMP-PS-A4a — قائمة مقارنات كشوف الأطراف ومعالج الاستيراد في متصفح حقيقي (سطح مكتب 1440 + جوال 390، عربي/إنجليزي، فاتح/داكن).
 * الخادم مُعترَض بالكامل ببيانات اصطناعية؛ لا خلفية ولا بيانات عميل. يتحقق من: الاتجاه RTL/LTR، عدم تجاوز العرض الأفقي، مسار الاستيراد الكامل
 * (رفع ← فحص ← معاينة ← استيراد ← رابط المقارنة)، التكرار، القدرة غير المفعّلة/الموقوفة، المقيَّد بفرع، ومنع أي نداء غير مصرَّح به.
 * اللقطات تُكتب فقط حين يُضبط `PS_A4A_SHOTS` (مجلد خارج المستودع).
 */
const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const shots = process.env.PS_A4A_SHOTS;

const PARTNER_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_A = '22222222-2222-4222-8222-222222222222';
const BRANCH_B = '33333333-3333-4333-8333-333333333333';
const RECON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const row = (over: Record<string, unknown> = {}) => ({
  id: RECON_ID, status: 'draft', role: 'customer', partner_id: PARTNER_ID, partner: { name: 'شركة النور للتجارة' }, branch_id: null, branch: null,
  period_from: '2026-01-01', period_to: '2026-03-31', currency: 'SAR', original_filename: 'nour-q1.csv', line_count: 12,
  total_debit_minor: 115000, total_credit_minor: 50000, created_by: 'u1', created_at: '2026-04-02T09:00:00+03:00',
  reviewed_at: null, closed_at: null, voided_at: null, superseded_by_id: null, ...over,
});
const rows = [
  row(),
  row({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'closed', role: 'supplier', partner: { name: 'مؤسسة الأفق' }, branch_id: BRANCH_A, branch: { name: 'فرع الدمام' }, line_count: 340, total_debit_minor: 98765432, total_credit_minor: 98000000 }),
  row({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'voided', partner: { name: 'الواحة للمقاولات' }, line_count: 7 }),
];

const inspection = {
  total_rows: 3,
  columns: [
    { index: 0, header: 'التاريخ', samples: ['2026-01-05', '2026-01-09'], suggested_field: 'line_date' },
    { index: 1, header: 'رقم المستند', samples: ['INV-1001', 'PAY-77'], suggested_field: 'reference' },
    { index: 2, header: 'مدين', samples: ['1150.00', ''], suggested_field: 'debit' },
    { index: 3, header: 'دائن', samples: ['', '500.00'], suggested_field: 'credit' },
  ],
  fields: [
    { key: 'line_date', label_ar: 'التاريخ', label_en: 'Date', type: 'date', required: true },
    { key: 'reference', label_ar: 'رقم المستند', label_en: 'Document number', type: 'text', required: false },
    { key: 'debit', label_ar: 'مدين', label_en: 'Debit', type: 'money', required: false },
    { key: 'credit', label_ar: 'دائن', label_en: 'Credit', type: 'money', required: false },
    { key: 'amount', label_ar: 'المبلغ', label_en: 'Amount', type: 'signed_money', required: false },
  ],
};

const previewBody = (over: Record<string, unknown> = {}) => ({
  partner_id: PARTNER_ID, partner_name: 'شركة النور للتجارة', role: 'customer', period_from: '2026-01-01', period_to: '2026-03-31', currency: 'SAR',
  policy: { version: 1, currency: 'SAR', date_tolerance_days: 3, amount_tolerance_minor: 0, amount_direction: null, include_reversed: true, branch_id: null },
  mapping: { 0: 'line_date', 1: 'reference', 2: 'debit', 3: 'credit' }, total_rows: 2, line_rows: 2, warning_rows: 0, error_rows: 0, valid_rows: 2, invalid_rows: 0,
  total_debit_minor: 115000, total_credit_minor: 50000,
  checks: { balance_rows: 0, balance_pairs_checked: 0, balance_mismatches: [], balance_mismatches_truncated: false },
  already_imported: false, existing_reconciliation_id: null,
  rows: [
    { row: 2, action: 'line', status: 'ok', valid: true, line_date: '2026-01-05', reference: 'INV-1001', our_reference: null, description: 'فاتورة مبيعات', debit_minor: 115000, credit_minor: 0, balance_minor: null, kind: null, messages: [], warnings: [] },
    { row: 3, action: 'line', status: 'ok', valid: true, line_date: '2026-01-09', reference: 'PAY-77', our_reference: null, description: 'سداد', debit_minor: 0, credit_minor: 50000, balance_minor: null, kind: null, messages: [], warnings: [] },
  ],
  rows_shown: 2, rows_truncated: false, errors: [], binding: { id: 'prev-1', hash: 'hash-1', expires_at: '2026-12-01T00:00:00Z' }, ...over,
});

const jobBody = (over: Record<string, unknown> = {}) => ({
  id: 'job-1', domain: 'partner_statement', branch_id: null, preview_bound: true, status: 'ready', original_filename: 'nour.csv', extension: 'csv', byte_size: 100,
  content_sha256: 'x', media_archive: null, row_count: 2, column_count: 4, processed_rows: 0, apply_result: null, error_message: null, created_by: 'u1',
  cancelled_by: null, cancelled_at: null, purge_after: null, created_at: '2026-04-02T09:00:00Z', updated_at: '2026-04-02T09:00:00Z', ...over,
});

interface Options {
  locale?: 'ar' | 'en';
  theme?: 'light' | 'dark';
  permissions?: string[];
  branchIds?: string[];
  navVisible?: boolean;
  appStatus?: 'enabled' | 'suspended' | 'disabled';
  listStatus?: number;
  preview?: unknown;
  inspectStatus?: number;
  applyResult?: Record<string, unknown>;
}

async function open(page: Page, path: string, opts: Options = {}) {
  const locale = opts.locale ?? 'ar';
  await page.context().addCookies([{ name: 'locale', value: locale, url: baseUrl }]);
  const requests: string[] = [];
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const user = {
    id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: 'owner', permissions: opts.permissions ?? ['*'],
    branch_ids: opts.branchIds ?? [], warehouse_ids: [],
  };

  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^.*\/api/, '');
    requests.push(`${method} ${p}${url.search}`);

    if (p === '/applications/nav-state') return json(route, { data: opts.navVisible === false ? { 'accounting.partner_statements': false } : {} });
    if (p === '/applications') return json(route, { data: { 'accounting.partner_statements': { status: opts.appStatus ?? 'enabled' } } });
    if (p === '/me') return json(route, { user, company: { name: 'Acme' } });
    if (p === '/branches') return json(route, { data: [{ id: BRANCH_A, name: 'فرع الدمام', is_active: true }, { id: BRANCH_B, name: 'فرع جدة', is_active: true }] });
    if (p === '/partners') return json(route, { data: [{ id: PARTNER_ID, name: 'شركة النور للتجارة', code: 'C-1', type: 'customer' }] });
    if (p === '/partner-statement-reconciliations' && method === 'GET') {
      if (opts.listStatus && opts.listStatus !== 200) return json(route, { message: 'هذه القدرة غير مفعّلة لهذه المؤسسة.' }, opts.listStatus);
      return json(route, { data: rows, meta: { current_page: 1, last_page: 1, per_page: 25, total: rows.length } });
    }
    if (p === `/partner-statement-reconciliations/${RECON_ID}`) return json(route, { data: row() });
    if (p === '/partner-statements/import/inspect') {
      if (opts.inspectStatus && opts.inspectStatus !== 200) return json(route, { message: 'هذه القدرة معلّقة (قراءة فقط) — أعد تفعيلها.' }, opts.inspectStatus);
      return json(route, { data: inspection });
    }
    if (p === '/partner-statements/import/preview') return json(route, { data: opts.preview ?? previewBody() });
    if (p === '/import-mapping-presets') return json(route, { data: [] });
    if (p === '/import-jobs' && method === 'POST') return json(route, { data: jobBody() }, 201);
    if (p === '/import-jobs/job-1/apply' && method === 'POST') {
      return json(route, { data: jobBody({ status: 'completed', processed_rows: 2, apply_result: opts.applyResult ?? { reconciliation_id: RECON_ID, created: 1, skipped: 0, replayed: false, lines: 2, total_rows: 2 } }) });
    }
    return json(route, { data: [] });
  });

  // مؤشر أدوات Next في وضع التطوير يعترض نقرات الأزرار السفلية على الجوال؛ لا وجود له في الإنتاج.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal{display:none !important}';
      document.head.appendChild(style);
    });
  });
  await page.addInitScript(([userJson, theme]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [JSON.stringify(user), opts.theme ?? 'light'] as const);
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
  return requests;
}

/** النص في خلية/بطاقة مرئية — يتخطى `<option>` في فلتر الطرف الذي يحمل الاسم نفسه. */
const visibleText = (page: Page, text: string | RegExp) => page.getByText(text).locator('visible=true').first();

const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};
const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
};
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;

async function runToPreview(page: Page, locale: 'ar' | 'en') {
  const t = locale === 'ar'
    ? { next: 'التالي', preview: 'معاينة الكشف', role: 'دور الطرف', partner: 'الطرف', customer: 'عميل' }
    : { next: 'Next', preview: 'Preview statement', role: 'Partner role', partner: 'Partner', customer: 'Customer' };
  await page.setInputFiles('#ps-file', { name: 'nour.csv', mimeType: 'text/csv', buffer: Buffer.from('date,ref,debit,credit\n2026-01-05,INV-1001,1150.00,\n2026-01-09,PAY-77,,500.00\n') });
  await expect(page.getByRole('button', { name: t.next })).toBeEnabled();
  await page.getByRole('button', { name: t.next }).click();
  await page.getByLabel(t.role, { exact: true }).selectOption('customer');
  await expect(page.getByRole('option', { name: /شركة النور للتجارة/ }).first()).toBeAttached();
  await page.getByLabel(t.partner, { exact: true }).selectOption(PARTNER_ID);
  await page.locator('#ps-period-from').fill('2026-01-01');
  await page.locator('#ps-period-to').fill('2026-03-31');
  await page.getByRole('button', { name: t.next }).click();
  await page.getByRole('button', { name: t.preview }).click();
}

for (const locale of ['ar', 'en'] as const) {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  test.describe(`قائمة الكشوف — ${locale}`, () => {
    test(`تعرض الصفوف من الخادم بالاتجاه ${dir} بلا تجاوز أفقي`, async ({ page }) => {
      const requests = await open(page, '/partner-statements', { locale });
      await expect(visibleText(page, 'شركة النور للتجارة')).toBeVisible();
      await expect(visibleText(page, 'مؤسسة الأفق')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(dir);
      await noHorizontalOverflow(page);
      // المبالغ بأرقام لاتينية وكسران
      const text = await page.locator('main').innerText();
      expect(text).toContain('1,150.00');
      expect(text).not.toMatch(/[٠-٩]/);
      // الطلب الأول للقائمة يحمل الفرز والترقيم الافتراضيين من الخادم
      expect(requests.some((r) => r.startsWith('GET /partner-statement-reconciliations?') && r.includes('sort=-created_at') && r.includes('per_page=25'))).toBe(true);
      await shot(page, `list-${locale}-${isMobile(page) ? 'mobile' : 'desktop'}-light`);
    });

    test('الفرز من رأس العمود خادمي (سطح المكتب)', async ({ page }) => {
      test.skip(isMobile(page), 'رؤوس الأعمدة مخفية على الجوال؛ منتقي الفرز يغطيه');
      const requests = await open(page, '/partner-statements', { locale });
      await expect(visibleText(page, 'شركة النور للتجارة')).toBeVisible();
      await page.getByRole('columnheader').nth(1).getByRole('button').click();
      await expect.poll(() => requests.some((r) => r.startsWith('GET /partner-statement-reconciliations?') && r.includes('sort=period_from'))).toBe(true);
    });

    test('الوضع الداكن', async ({ page }) => {
      await open(page, '/partner-statements', { locale, theme: 'dark' });
      await expect(visibleText(page, 'شركة النور للتجارة')).toBeVisible();
      await noHorizontalOverflow(page);
      await shot(page, `list-${locale}-${isMobile(page) ? 'mobile' : 'desktop'}-dark`);
    });
  });
}

test.describe('حالات الوصول', () => {
  test('قدرة موقوفة: قراءة فقط بلا زر استيراد', async ({ page }) => {
    await open(page, '/partner-statements', { appStatus: 'suspended' });
    await expect(page.getByText('هذه القدرة موقوفة مؤقتاً', { exact: false })).toBeVisible();
    await expect(visibleText(page, 'شركة النور للتجارة')).toBeVisible();
    await expect(page.getByRole('link', { name: 'استيراد كشف' })).toHaveCount(0);
    await shot(page, `list-suspended-${isMobile(page) ? 'mobile' : 'desktop'}`);
  });

  test('قدرة غير مفعّلة: شاشة إرشاد بلا نداء قائمة', async ({ page }) => {
    const requests = await open(page, '/partner-statements', { navVisible: false });
    await expect(page.getByText('مطابقة كشوف الأطراف غير مفعّلة')).toBeVisible();
    expect(requests.some((r) => r.startsWith('GET /partner-statement-reconciliations'))).toBe(false);
    await shot(page, `list-disabled-${isMobile(page) ? 'mobile' : 'desktop'}`);
  });

  test('رفض 403 فعلي من الخادم (معطّلة) يحوّل الشاشة إلى حالة المنع', async ({ page }) => {
    await open(page, '/partner-statements', { listStatus: 403 });
    await expect(page.getByText('مطابقة كشوف الأطراف غير مفعّلة')).toBeVisible();
  });

  test('بلا صلاحية العرض: لا طلب للقائمة أبداً', async ({ page }) => {
    const requests = await open(page, '/partner-statements', { permissions: ['invoices.view'] });
    await expect(page.getByText('لا تملك صلاحية عرض كشوف الأطراف')).toBeVisible();
    expect(requests.some((r) => r.includes('/partner-statement-reconciliations'))).toBe(false);
  });

  test('عرض فقط: لا زر استيراد، والمعالج يمنعه بلا أي نداء كتابة', async ({ page }) => {
    const requests = await open(page, '/partner-statements', { permissions: ['partner_statements.view'] });
    await expect(visibleText(page, 'شركة النور للتجارة')).toBeVisible();
    await expect(page.getByRole('link', { name: 'استيراد كشف' })).toHaveCount(0);

    await page.goto(`${baseUrl}/partner-statements/import`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('لا تملك صلاحية استيراد كشوف الأطراف')).toBeVisible();
    await expect(page.locator('#ps-file')).toHaveCount(0);
    expect(requests.some((r) => r.startsWith('POST '))).toBe(false);
    expect(requests.some((r) => r.includes('/partner-statements/import/'))).toBe(false);
  });
});

for (const locale of ['ar', 'en'] as const) {
  test.describe(`معالج الاستيراد — ${locale}`, () => {
    test('المسار الكامل: رفع ← فحص ← معاينة ← تأكيد ← استيراد ← رابط المقارنة', async ({ page }) => {
      const requests = await open(page, '/partner-statements/import', { locale });
      const dir = locale === 'ar' ? 'rtl' : 'ltr';
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(dir);
      await noHorizontalOverflow(page);
      await shot(page, `wizard-${locale}-file-${isMobile(page) ? 'mobile' : 'desktop'}`);

      await runToPreview(page, locale);
      await expect(visibleText(page, 'INV-1001')).toBeVisible();
      await noHorizontalOverflow(page);
      expect(await page.locator('main').innerText()).toContain('1,150.00');
      await shot(page, `wizard-${locale}-preview-${isMobile(page) ? 'mobile' : 'desktop'}`);

      await page.getByRole('button', { name: locale === 'ar' ? 'التالي' : 'Next' }).click();
      const importButton = page.getByRole('button', { name: locale === 'ar' ? 'استيراد الكشف' : 'Import statement' });
      await expect(importButton).toBeDisabled();
      await shot(page, `wizard-${locale}-confirm-${isMobile(page) ? 'mobile' : 'desktop'}`);
      await page.getByRole('checkbox').check();
      await expect(importButton).toBeEnabled();
      await importButton.click();

      const open_ = page.getByRole('link', { name: locale === 'ar' ? 'عرض الكشف في القائمة' : 'View the statement in the list' });
      await expect(open_).toBeVisible();
      await expect(open_).toHaveAttribute('href', `/partner-statements?highlight=${RECON_ID}`);
      await shot(page, `wizard-${locale}-result-${isMobile(page) ? 'mobile' : 'desktop'}`);

      // المعاينة قبل الإنشاء، والتنفيذ بعده (لا استيراد متزامن)
      const order = requests.filter((r) => /^(POST) \/(partner-statements\/import\/(inspect|preview)|import-jobs)/.test(r));
      expect(order.map((r) => r.split('?')[0])).toEqual([
        'POST /partner-statements/import/inspect',
        'POST /partner-statements/import/preview',
        'POST /import-jobs',
        'POST /import-jobs/job-1/apply',
      ]);

      await open_.click();
      await expect(page.getByTestId('imported-banner')).toBeVisible();
      await expect(page.getByTestId('imported-banner')).toContainText('شركة النور للتجارة');
    });
  });
}

test.describe('مسارات خاصة بالمعالج', () => {
  test('كشف مستورد سابقاً: تنبيه برابط المقارنة القائمة ولا استيراد ثانٍ', async ({ page }) => {
    const requests = await open(page, '/partner-statements/import', { preview: previewBody({ already_imported: true, existing_reconciliation_id: RECON_ID }) });
    await runToPreview(page, 'ar');
    await expect(page.getByText('هذا الكشف استُورد سابقاً', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: 'عرض المقارنة القائمة' })).toHaveAttribute('href', `/partner-statements?highlight=${RECON_ID}`);
    await expect(page.getByRole('button', { name: 'التالي' })).toBeDisabled();
    expect(requests.some((r) => r.startsWith('POST /import-jobs'))).toBe(false);
    await shot(page, `wizard-duplicate-${isMobile(page) ? 'mobile' : 'desktop'}`);
  });

  test('إعادة تشغيل (replayed): رسالة صريحة بدل نجاح مضلّل', async ({ page }) => {
    await open(page, '/partner-statements/import', { applyResult: { reconciliation_id: RECON_ID, created: 0, skipped: 1, replayed: true, lines: 2, total_rows: 2 } });
    await runToPreview(page, 'ar');
    await page.getByRole('button', { name: 'التالي' }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'استيراد الكشف' }).click();
    await expect(page.getByText('هذا الملف مستورد سابقاً', { exact: false })).toBeVisible();
    await shot(page, `wizard-replayed-${isMobile(page) ? 'mobile' : 'desktop'}`);
  });

  test('أخطاء في الصفوف تمنع المتابعة', async ({ page }) => {
    await open(page, '/partner-statements/import', { preview: previewBody({ error_rows: 1, valid_rows: 1, errors: [{ row: 3, messages: ['التاريخ غير صالح؛ استخدم YYYY-MM-DD أو DD/MM/YYYY.'] }] }) });
    await runToPreview(page, 'ar');
    await expect(page.getByText('أخطاء تمنع الاستيراد', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'التالي' })).toBeDisabled();
    await shot(page, `wizard-errors-${isMobile(page) ? 'mobile' : 'desktop'}`);
  });

  test('قدرة موقوفة تُكتشف عند الفحص: رسالة مترجمة بلا نص الخادم الخام', async ({ page }) => {
    await open(page, '/partner-statements/import', { inspectStatus: 403, permissions: ['partner_statements.view', 'partner_statements.reconcile'] });
    await page.setInputFiles('#ps-file', { name: 'nour.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') });
    await expect(page.getByText('الاستيراد متوقف مؤقتاً')).toBeVisible();
  });

  test('مقيَّد بفرع: لا خيار «المؤسسة كلها» ولا فروع غيره', async ({ page }) => {
    await open(page, '/partner-statements/import', { permissions: ['partner_statements.view', 'partner_statements.reconcile', 'partners.view'], branchIds: [BRANCH_A] });
    await page.setInputFiles('#ps-file', { name: 'nour.csv', mimeType: 'text/csv', buffer: Buffer.from('date,ref,debit,credit\n2026-01-05,INV-1001,1150.00,\n') });
    await page.getByRole('button', { name: 'التالي' }).click();
    const branch = page.locator('#ps-branch');
    await expect(branch.locator('option')).toHaveCount(2);
    await expect(branch.locator('option', { hasText: 'المؤسسة كلها' })).toHaveCount(0);
    await expect(branch.locator('option', { hasText: 'فرع جدة' })).toHaveCount(0);
    await shot(page, `wizard-branch-restricted-${isMobile(page) ? 'mobile' : 'desktop'}`);
  });

  test('لوحة المفاتيح: بعد اختيار الملف ينتقل Tab إلى زر «التالي» المفعّل', async ({ page }) => {
    await open(page, '/partner-statements/import');
    await page.setInputFiles('#ps-file', { name: 'nour.csv', mimeType: 'text/csv', buffer: Buffer.from('date,ref,debit,credit\n2026-01-05,INV-1001,1150.00,\n') });
    const next = page.getByRole('button', { name: 'التالي' });
    await expect(next).toBeEnabled();
    await page.locator('#ps-file').focus();
    await page.keyboard.press('Tab');
    await expect(next).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#ps-role')).toBeVisible();
  });
});
