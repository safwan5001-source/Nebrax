import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

/**
 * PAY-H8-02 — مسح شاشات المدفوعات في متصفح حقيقي (الخادم مُعترَض بالكامل بحالة قابلة للتعديل؛ لا خلفية ولا مزوّد).
 *
 * المصفوفة: الحالات «الكاملة» تعمل على 390/768/1280/1440 × ar/en × فاتح/داكن (16 تركيبة)؛ بقية الحالات على 390 و1440 × ar/en
 * بسمة داكنة مع العربية وفاتحة مع الإنجليزية (فتتغطى السمتان عبر الحالات). لكل حالة: لغة النص واتجاه الصفحة والسمة، غياب التمرير الأفقي،
 * ملاءمة الحوارات/الألواح للشاشة وإغلاقها بـEscape، غياب أخطاء الصفحة/الـconsole، أسماء الحقول والأزرار (فحص وصولية أساسي بلا axe)،
 * وعزل الأرقام والمراجع LTR داخل RTL. اللقطات تُكتب فقط حين يُضبط `PAY_QA_SHOTS` (مجلد خارج المستودع).
 */

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PAY_QA_PORT ?? 3917}`;
const shots = process.env.PAY_QA_SHOTS;

type Locale = 'ar' | 'en';
type Theme = 'light' | 'dark';

const MESSAGES: Record<Locale, Record<string, unknown>> = {
  ar: JSON.parse(readFileSync(join(process.cwd(), 'src/messages/ar.json'), 'utf8')),
  en: JSON.parse(readFileSync(join(process.cwd(), 'src/messages/en.json'), 'utf8')),
};
/** نص رسالة بمسار «namespace.key.sub». */
const msg = (locale: Locale, ns: string, key: string): string => {
  const value = `${ns}.${key}`.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], MESSAGES[locale]);
  if (typeof value !== 'string') throw new Error(`missing message ${ns}.${key} (${locale})`);
  return value;
};

const VIEWPORTS = { 390: { width: 390, height: 844 }, 768: { width: 768, height: 1024 }, 1280: { width: 1280, height: 800 }, 1440: { width: 1440, height: 900 } } as const;
type Vw = keyof typeof VIEWPORTS;

// ───────────────────────── بيانات مُعترَضة (تطابق عقود الواجهة) ─────────────────────────

const meta = (total: number) => ({ total, page: 1, per_page: 25, last_page: 1 });
const gateway = (over: Record<string, unknown> = {}) => ({
  id: 'g1', provider: 'moyasar', name: 'ميسّر', name_en: 'Moyasar', environment: 'sandbox', status: 'active', is_usable: true, merchant_reference: 'MER-1', publishable_key: 'pk_test_x',
  has_secret_key: true, has_webhook_secret: true, has_extra_credentials: false, credential_version: 2, previous_secret_valid_until: null, verified_at: '2026-10-22T09:00:00Z',
  activated_at: '2026-10-22T09:05:00Z', deactivated_at: null, created_at: '2026-10-21T09:00:00Z', fee_tax_policy: 'reject', fee_tax_opinion_recorded: false, webhook_key: 'w'.repeat(40),
  provider_capabilities: { hosted_checkout: true, refunds: true, currencies: ['SAR'], min_amount_minor: 100, methods: ['mada', 'visa', 'mastercard', 'apple_pay'], methods_requiring_provider_setup: ['apple_pay'] }, ...over,
});
const onlineMethod = (over: Record<string, unknown> = {}) => ({
  key: 'mada', status: 'enabled', reason: null, enabled: true, customer_visible: true,
  connections: [{ gateway_id: 'g1', gateway_name: 'ميسّر', provider: 'moyasar', environment: 'sandbox', usable: true, requires_provider_setup: false, eligible: true }],
  effective_gateway: { id: 'g1', name: 'ميسّر' }, multiple_eligible_gateways: false, default_gateway_selectable: false, usage: { invoices: true, store: false }, ...over,
});
const attempt = (over: Record<string, unknown> = {}) => ({
  id: 'a1', request_id: 'r1', invoice: { id: 'inv1', number: 'INV-0001' }, gateway: { id: 'g1', name: 'ميسّر', provider: 'moyasar', environment: 'sandbox' },
  capture_status: 'captured', posting_status: 'posted', amount_minor: 115000, captured_minor: 115000, currency: 'SAR', review_reasons: [], unrecognized_refund: false,
  blocked_reason: null, accounting_date: '2026-10-23', captured_at: '2026-10-23T09:00:00Z', posted_at: '2026-10-23T09:00:05Z', created_at: '2026-10-23T08:59:00Z', ...over,
});
const refund = (over: Record<string, unknown> = {}) => ({
  id: 'rf1', number: 'PRF-2026-00001', status: 'requested', amount_minor: 40000, currency: 'SAR', partner_id: 'p1', partner_name: 'عميل تجريبي', payment_attempt_id: 'a1',
  requested_by: { id: 'u-owner', name: 'المالك' }, requested_at: '2026-10-23T09:00:00Z', approved_by: null, approved_at: null, reject_reason: null, cancel_reason: null,
  confirmed_at: null, provider_refunded_at: null, provider_refund_ref: null, failure_code: null, retry_count: 0, excess_minor: 0, posting_status: null,
  accounting_date: null, posted_at: null, journal_entry_id: null, blocked_reason: null, ...over,
});
const settlement = (over: Record<string, unknown> = {}) => ({
  id: 's1', payment_gateway_id: 'g1', gateway_name: 'ميسّر', provider_settlement_ref: 'SET-001', settlement_date: '2026-10-23', status: 'posted', currency: 'SAR',
  gross_amount: 115000, net_bank_amount: 111000, provider_fee_ex_tax: 4000, provider_fee_tax: 0, provider_deductions: 0, provider_credits: 0, refunds_total: 0,
  unreconciled_minor: null, journal_entry_id: 'j1234567-0000-4000-8000-000000000001', posted_at: '2026-10-23T09:00:00Z', ...over,
});
const adjustment = (over: Record<string, unknown> = {}) => ({
  id: 'ad1', payment_gateway_id: 'g1', kind: 'reserve_hold', amount_minor: 25000, currency: 'SAR', status: 'requested', reason: 'احتجاز بقرار المزوّد', evidence_ref: 'EV-100',
  provider_event_ref: null, requested_by: { id: 'u-owner', name: 'المالك' }, requested_at: '2026-10-23T09:00:00Z', approved_by: null, approved_at: null, rejected_by: null,
  reject_reason: null, cancelled_by: null, cancel_reason: null, settlement_id: null, ...over,
});
const preview = (over: Record<string, unknown> = {}) => ({
  gross: 115000, refunds_total: 0, net_bank_amount: 111000, provider_fee_ex_tax: 4000, provider_fee_tax: 0, provider_deductions: 0, provider_credits: 0,
  adjustments_deductions: 0, adjustments_credits: 0, difference: 0, reconciled: true, postable: true, saveable_as_unreconciled: false, replay: false, existing_status: null,
  blockers: [], ...over,
});
const recon = (over: Record<string, unknown> = {}) => ({
  currency: 'SAR', status: 'reconciled', mapping_state: 'mapped', ledger_balance: 95000, expected_balance: 95000, difference: 0,
  accounts: [{ account_id: 'ac1', code: '1170', name: 'مستحقات بوابات الدفع', is_active: true, sources: ['current', 'system_default'], balance: 95000 }],
  documents: { captures: 115000, settled_gross: 0, refunds: 20000, deducted_refunds: 0, capture_count: 1, refund_count: 1, unsettled_captures: 115000, unsettled_refunds: 20000 },
  checks: [
    { key: 'captures', document: 115000, ledger: 115000, difference: 0 }, { key: 'refunds', document: 20000, ledger: 20000, difference: 0 },
    { key: 'settlements', document: 0, ledger: 0, difference: 0 }, { key: 'other', document: 0, ledger: 0, difference: 0 },
  ],
  other_sources: [],
  per_gateway: [{ payment_gateway_id: 'g1', gateway_name: 'ميسّر', unsettled_captures: 115000, unsettled_refunds: 20000, expected_balance: 95000 }],
  not_checked: ['per_branch_ledger', 'as_of_date', 'provider_statement', 'adjustment_reserve_accounts'],
  ...over,
});
const reconDifference = () => recon({
  status: 'difference', ledger_balance: 102000, difference: 7000,
  checks: [
    { key: 'captures', document: 115000, ledger: 115000, difference: 0 }, { key: 'refunds', document: 20000, ledger: 20000, difference: 0 },
    { key: 'settlements', document: 0, ledger: 0, difference: 0 }, { key: 'other', document: 0, ledger: 7000, difference: 7000 },
  ],
  other_sources: [{ source_type: null, debit: 7000, credit: 0 }],
});
const diffs = () => ({
  currency: 'SAR',
  rows: [
    { id: 's2', payment_gateway_id: 'g1', gateway_name: 'ميسّر', provider_settlement_ref: 'DIFF-A', settlement_date: '2026-10-13', age_days: 10, currency: 'SAR', gross_amount: 115000, net_bank_amount: 110500, unreconciled_minor: -500 },
    { id: 's3', payment_gateway_id: 'g1', gateway_name: 'ميسّر', provider_settlement_ref: 'DIFF-B', settlement_date: '2026-10-23', age_days: 0, currency: 'SAR', gross_amount: 115000, net_bank_amount: 111300, unreconciled_minor: 300 },
  ],
  has_more: false,
  totals: { count: 2, net_minor: -200, positive_minor: 300, negative_minor: -500, oldest_settlement_date: '2026-10-13' },
});
const aging = () => ({
  currency: 'SAR', as_of: '2026-10-23', bucket_days: [7, 30, 60], scope: 'company',
  rows: [
    { branch_id: 'b1', branch_name: 'الرئيسي', captures: { count: 2, total: 230000, buckets: [115000, 115000, 0, 0] }, refunds: { count: 1, total: 15000, buckets: [0, 0, 15000, 0] }, net: { total: 215000, buckets: [115000, 115000, -15000, 0] } },
    { branch_id: 'b2', branch_name: 'فرع الشرق', captures: { count: 1, total: 115000, buckets: [0, 0, 0, 115000] }, refunds: { count: 0, total: 0, buckets: [0, 0, 0, 0] }, net: { total: 115000, buckets: [0, 0, 0, 115000] } },
    { branch_id: null, branch_name: null, captures: { count: 1, total: 57500, buckets: [0, 57500, 0, 0] }, refunds: { count: 0, total: 0, buckets: [0, 0, 0, 0] }, net: { total: 57500, buckets: [0, 57500, 0, 0] } },
  ],
  totals: {
    captures: { total: 402500, buckets: [115000, 172500, 0, 115000] }, refunds: { total: 15000, buckets: [0, 0, 15000, 0] }, net: { total: 387500, buckets: [115000, 172500, -15000, 115000] },
  },
});

interface World {
  previewMode: 'postable' | 'unreconciled';
  reconMode: 'reconciled' | 'difference' | 'forbidden';
  /** حالة وسيلة «فيزا» المخزَّنة (يغيّرها PUT /online-payment-methods/visa). */
  visaEnabled: boolean;
  methodsMode: 'normal' | 'failing';
  /** رمز رابط الدفع ⇒ استجابة. */
  requests: string[];
  unrouted: string[];
}
const newWorld = (over: Partial<World> = {}): World => ({ previewMode: 'postable', reconMode: 'reconciled', visaEnabled: false, methodsMode: 'normal', requests: [], unrouted: [], ...over });

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const PAY_LINKS: Record<string, { view: unknown; status: unknown } | 404> = {
  tok_open_apple: { view: { status: 'open', merchant: 'شركة نبراس الطموح', invoice_number: 'INV-0043', currency: 'SAR', amount_due_minor: 115000, allow_partial: false, expires_at: '2026-11-30T12:00:00Z', payment_methods: ['mada', 'visa', 'apple_pay'] }, status: { request_status: 'open', payment: 'none' } },
  tok_open: { view: { status: 'open', merchant: 'شركة نبراس الطموح', invoice_number: 'INV-0042', currency: 'SAR', amount_due_minor: 115000, allow_partial: false, expires_at: '2026-11-30T12:00:00Z', payment_methods: ['mada', 'visa'] }, status: { request_status: 'open', payment: 'none' } },
  tok_partial: { view: { status: 'open', merchant: 'شركة نبراس الطموح', invoice_number: 'INV-0043', currency: 'SAR', amount_due_minor: 230000, allow_partial: true, expires_at: null }, status: { request_status: 'open', payment: 'partially_paid' } },
  // الخادم لا يعيد التفاصيل إلا لرابط مفتوح؛ المسدَّد/المتعذَّر يعيد الحالة وحدها (PublicPaymentLinkController::show).
  tok_completed: { view: { status: 'completed' }, status: { request_status: 'completed', payment: 'paid' } },
  tok_unavailable: { view: { status: 'unavailable' }, status: { request_status: 'open', payment: 'none' } },
  tok_expired: { view: { status: 'expired' }, status: { request_status: 'expired', payment: 'none' } },
  tok_cancelled: { view: { status: 'cancelled' }, status: { request_status: 'cancelled', payment: 'none' } },
  tok_gone: 404,
};

async function setup(page: Page, w: World, opts: { locale: Locale; theme: Theme; vw: Vw; permissions?: string[] }) {
  await page.setViewportSize(VIEWPORTS[opts.vw]);
  await page.emulateMedia({ colorScheme: opts.theme });
  await page.context().addCookies([{ name: 'locale', value: opts.locale, url: baseUrl }]);

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api/, '');
    const q = url.searchParams;
    w.requests.push(`${method} ${path}${url.search}`);

    // public pay link
    const pay = /^\/pay\/v1\/([^/]+)(\/status)?$/.exec(path);
    if (pay) {
      const entry = PAY_LINKS[pay[1]];
      if (entry === undefined || entry === 404) return json(route, { error: { code: 'not_found' } }, 404);
      return json(route, { data: pay[2] ? entry.status : entry.view });
    }

    if (path === '/applications/nav-state') return json(route, { data: {} });
    if (path === '/me') return json(route, { user, company: { name: 'Acme' } });
    if (path === '/branches') return json(route, { data: [{ id: 'b1', code: '1', name: 'الرئيسي', is_main: true, is_active: true }, { id: 'b2', code: '2', name: 'فرع الشرق', is_main: false, is_active: true }] });
    if (path === '/cash-bank-accounts') return json(route, { data: [{ id: 'bk1', name: 'الراجحي', type: 'bank', is_active: true, is_main: true }, { id: 'c1', name: 'الصندوق', type: 'cash', is_active: true, is_main: true }] });

    if (path === '/online-payment-methods' && method === 'GET') {
      if (w.methodsMode === 'failing') return json(route, { error: { message: 'down' } }, 500);
      return json(route, { data: [
        onlineMethod({ key: 'mada' }),
        onlineMethod({ key: 'visa', status: w.visaEnabled ? 'enabled' : 'disabled', enabled: w.visaEnabled, customer_visible: w.visaEnabled }),
        onlineMethod({ key: 'mastercard', status: 'unsupported', enabled: false, customer_visible: false, connections: [], effective_gateway: null }),
        onlineMethod({ key: 'apple_pay', status: 'needs_setup', reason: 'provider_setup_required', enabled: false, customer_visible: false,
          connections: [{ gateway_id: 'g1', gateway_name: 'ميسّر', provider: 'moyasar', environment: 'sandbox', usable: true, requires_provider_setup: true, eligible: false }], effective_gateway: null }),
      ] });
    }
    if (path === '/online-payment-methods/visa' && method === 'PUT') {
      w.visaEnabled = (request.postDataJSON() as { enabled: boolean }).enabled;
      return json(route, { data: onlineMethod({ key: 'visa', status: w.visaEnabled ? 'enabled' : 'disabled', enabled: w.visaEnabled, customer_visible: w.visaEnabled }) });
    }
    if (path === '/payment-gateways' && method === 'GET') return json(route, { data: [gateway(), gateway({ id: 'g2', provider: 'custom', name: 'ربط يدوي', name_en: 'Manual', status: 'draft', is_usable: false, verified_at: null, activated_at: null, has_secret_key: false, provider_capabilities: null }), gateway({ id: 'g3', name: 'ميسّر (تجريبي غير مفعّل)', name_en: 'Moyasar (inactive)', status: 'draft', is_usable: false, verified_at: null, activated_at: null, has_secret_key: false })] });

    if (path === '/payment-attempts' && method === 'GET') {
      if (q.get('posting_status') === 'blocked_period') return json(route, { data: [attempt({ id: 'a2', invoice: { id: 'inv2', number: 'INV-0002' }, posting_status: 'blocked_period', blocked_reason: { kind: 'period' } })], meta: meta(q.get('per_page') === '1' ? 1 : 1) });
      return json(route, { data: [attempt(), attempt({ id: 'a2', invoice: { id: 'inv2', number: 'INV-0002' }, posting_status: 'blocked_period', blocked_reason: { kind: 'period' } }), attempt({ id: 'a3', invoice: { id: 'inv3', number: 'INV-0003' }, capture_status: 'pending_customer', posting_status: null, captured_minor: 0 })], meta: meta(3) });
    }
    if (/^\/payment-attempts\/[^/]+$/.test(path)) return json(route, { data: { ...attempt(), failure_code: null, refunded_minor: 0, unrecognized_refund_at: null, unrecognized_refund_minor: null, postings: [{ role: 'allocated', amount_minor: 115000, payment_id: 'pay1', payment_number: 'REC-2026-00001' }], timeline: [{ type: 'created', at: '2026-10-23T08:59:00Z' }, { type: 'captured', at: '2026-10-23T09:00:00Z' }, { type: 'posted', at: '2026-10-23T09:00:05Z' }] } });

    if (path === '/payment-refunds' && method === 'GET') return json(route, { data: [refund(), refund({ id: 'rf2', number: 'PRF-2026-00002', status: 'confirmed', posting_status: 'blocked_period', approved_by: { id: 'u-admin', name: 'المدير' }, confirmed_at: '2026-10-23T10:00:00Z' })], meta: meta(2) });
    if (/^\/payment-refunds\/[^/]+$/.test(path)) return json(route, { data: { ...refund(), allocations: [{ source_type: 'credit_note', source_id: 'cn1', source_number: 'CN-0001', amount_minor: 40000 }], invocations: [], timeline: [{ action: 'requested', from: null, to: 'requested', reason: null, actor: 'المالك', at: '2026-10-23T09:00:00Z' }] } });

    if (path === '/payment-gateway-settlements/preview') {
      return json(route, { data: w.previewMode === 'postable' ? preview() : preview({ difference: -500, reconciled: false, postable: false, saveable_as_unreconciled: true, blockers: [{ code: 'unreconciled_difference', message: 'diff' }] }) });
    }
    if (path === '/payment-gateway-settlements' && method === 'POST') return json(route, { data: { ...settlement(), items: [], lines: [] } });
    if (path === '/payment-gateway-settlements' && method === 'GET') {
      return json(route, { data: [settlement(), settlement({ id: 's2', provider_settlement_ref: 'SET-002', status: 'unreconciled', unreconciled_minor: -500, journal_entry_id: null, posted_at: null, net_bank_amount: 110500 })], meta: meta(2) });
    }
    if (/^\/payment-gateway-settlements\/[^/]+$/.test(path)) {
      return json(route, { data: { ...settlement({ refunds_total: 10000 }), items: [{ payment_id: 'pay1', provider_event_ref: 'evt_1', gross_amount: 115000 }], lines: [
        { line_type: 'refund', adjustment_id: null, evidence_ref: null, payment_refund_id: 'rf2', refund_number: 'PRF-2026-00002', amount_minor: 10000, provider_event_ref: null },
        { line_type: 'reserve_hold', adjustment_id: 'ad1', evidence_ref: 'EV-100', payment_refund_id: null, refund_number: null, amount_minor: 25000, provider_event_ref: null },
      ] } });
    }
    if (/^\/payment-gateways\/[^/]+\/unsettled-payments$/.test(path)) return json(route, { data: [{ payment_id: 'p1', number: 'PAY-1', date: '2026-10-20', amount: 115000, settled: 0, remaining: 115000, partner_id: null }], meta: { page: 1, per_page: 100, has_more: false } });
    if (/^\/payment-gateways\/[^/]+\/unsettled-refunds$/.test(path)) return json(route, { data: [{ refund_id: 'rf2', number: 'PRF-2026-00002', amount: 10000, deducted: 0, remaining: 10000, partner_id: null, currency: 'SAR', accounting_date: '2026-10-22' }], meta: { page: 1, per_page: 100, has_more: false } });
    if (/^\/payment-gateways\/[^/]+\/reserve-balance$/.test(path)) return json(route, { data: { held_minor: 40000, releasable_minor: 15000 } });

    if (path === '/payment-gateway-adjustments' && method === 'GET') {
      if (q.get('status') === 'approved') return json(route, { data: [adjustment({ id: 'ad2', status: 'approved', kind: 'adjustment_debit', amount_minor: 3000, evidence_ref: 'EV-200', approved_by: { id: 'u-admin', name: 'المدير' } })], meta: meta(1) });
      return json(route, { data: [adjustment(), adjustment({ id: 'ad2', status: 'approved', kind: 'adjustment_debit', amount_minor: 3000, evidence_ref: 'EV-200', approved_by: { id: 'u-admin', name: 'المدير' } })], meta: meta(2) });
    }
    if (/^\/payment-gateway-adjustments\/[^/]+$/.test(path)) return json(route, { data: { ...adjustment(), timeline: [{ action: 'requested', from_status: null, to_status: 'requested', actor: 'المالك', reason: 'احتجاز بقرار المزوّد', at: '2026-10-23T09:00:00Z' }] } });
    if (path === '/payment-gateway-adjustments' && method === 'POST') return json(route, { data: { ...adjustment(), timeline: [] } }, 201);

    if (path === '/payment-reports/clearing-reconciliation') {
      if (w.reconMode === 'forbidden') return json(route, { error: { code: 'branch_scope_forbidden', message: 'branch_scope_forbidden' } }, 403);
      return json(route, { data: w.reconMode === 'difference' ? reconDifference() : recon() });
    }
    if (path === '/payment-reports/settlement-differences') return json(route, { data: diffs() });
    if (path === '/payment-reports/clearing-aging') return json(route, { data: aging() });

    w.unrouted.push(`${method} ${path}`);
    return json(route, { data: [] });
  });

  const user = {
    id: 'me', name: 'Safwan', email: 'owner@acme.test', tenant_id: 't1', role: 'owner',
    permissions: opts.permissions ?? ['*'],
  };
  await page.addInitScript(([userJson, theme]) => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', userJson);
    localStorage.setItem('theme', theme);
  }, [JSON.stringify(user), opts.theme] as const);
}

// ───────────────────────── فحوص مشتركة ─────────────────────────

/** يجمع أخطاء الصفحة وأخطاء الـconsole (المعروفة والمبرَّرة فقط تُستثنى). */
function watchErrors(page: Page, tolerateHttpError = false): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // مورد خارجي غير متاح في الصندوق المعزول (خطوط/تحليلات) ليس عيباً في الواجهة.
    if (/Failed to load resource.*(fonts\.g|googleapis|gstatic|vercel)/i.test(text)) return;
    // تحذير next-intl (تطوير فقط) عن مفاتيح تحوي «.» في appBuilder/developer.events: عيب سابق خارج المدفوعات (مسجَّل في تقرير QA كـP3 مفتوح).
    if (/INVALID_KEY: Namespace keys can not contain/.test(text) && /appBuilder\.|developer\.events/.test(text)) return;
    // طلب مُعترَض يعيد 404/403 عمداً في حالة الاختبار (رابط دفع غير موجود، تقرير محجوب بنطاق الفرع).
    if (tolerateHttpError && /Failed to load resource: the server responded with a status of (403|404|500)/.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

async function baseChecks(page: Page, ctx: Ctx) {
  const html = page.locator('html');
  await expect(html).toHaveAttribute('dir', ctx.locale === 'ar' ? 'rtl' : 'ltr');
  await expect(html).toHaveAttribute('lang', ctx.locale);
  if (ctx.theme === 'dark') await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  else await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) {
    // اسم العناصر المتجاوزة في رسالة الفشل ليسهل تحديد المصدر (قشرة التطبيق أم الشاشة).
    const offenders = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      return Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .filter((el) => {
          if (el.closest('aside.fixed, [role=dialog]')) return false;   // أدراج/حوارات ثابتة خارج الشاشة لا تُنتج تمريراً
          for (let cur = el.parentElement; cur && cur !== document.body; cur = cur.parentElement) {
            if (/(auto|scroll|hidden)/.test(getComputedStyle(cur).overflowX) && cur.getBoundingClientRect().right <= vw + 1) return false;   // داخل حاوية تمرير أفقي مستقلة
          }
          const r = el.getBoundingClientRect();
          const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
          return r.width > 0 && (rtl ? r.left < -1 : r.right > vw + 1);
        })
        .slice(0, 8)
        .map((el) => `${el.tagName.toLowerCase()}.${(el.className?.toString() ?? '').slice(0, 70)} [${Math.round(el.getBoundingClientRect().left)}..${Math.round(el.getBoundingClientRect().right)}]`);
    });
    expect(offenders, `horizontal overflow ${overflow}px at ${ctx.vw}`).toEqual([]);
  }
  expect(overflow, 'no horizontal page scroll').toBeLessThanOrEqual(1);
}

/** فحص وصولية أساسي (axe غير متاح في المستودع): أسماء الحقول والأزرار والأيقونات والحوارات. */
async function a11yBasics(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const issues: string[] = [];
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const nameOf = (el: Element): string => {
      const aria = el.getAttribute('aria-label')?.trim();
      if (aria) return aria;
      const by = el.getAttribute('aria-labelledby');
      if (by) {
        const text = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
        if (text) return text;
      }
      const labels = (el as HTMLInputElement).labels;
      if (labels && labels.length > 0) return Array.from(labels).map((l) => l.textContent ?? '').join(' ').trim();
      return (el.textContent ?? '').trim() || el.getAttribute('title')?.trim() || '';
    };
    for (const el of Array.from(document.querySelectorAll('input:not([type=hidden]), select, textarea'))) {
      if (!visible(el)) continue;
      if (!nameOf(el)) issues.push(`unlabelled ${el.tagName.toLowerCase()}#${(el as HTMLElement).id || '?'}`);
    }
    for (const el of Array.from(document.querySelectorAll('button, [role=button], [role=tab], a[href]'))) {
      if (!visible(el)) continue;
      if (!nameOf(el)) issues.push(`nameless ${el.tagName.toLowerCase()} ${(el as HTMLElement).className.toString().slice(0, 40)}`);
    }
    for (const el of Array.from(document.querySelectorAll('[role=dialog]'))) {
      if (!visible(el)) continue;
      if (!el.getAttribute('aria-label')?.trim() && !el.getAttribute('aria-labelledby')) issues.push('dialog without accessible name');
      if (el.getAttribute('aria-modal') !== 'true') issues.push('dialog without aria-modal');
    }
    for (const el of Array.from(document.querySelectorAll('img'))) {
      if (visible(el) && !el.hasAttribute('alt')) issues.push('img without alt');
    }
    return issues;
  });
}

/** كل شعار ظاهر فعلاً حُمِّل (ملف SVG سليم) ولم يسقط إلى النص. */
async function expectLogosLoaded(scope: Locator, expectedSrcs: string[]): Promise<void> {
  const logos = scope.locator('img:visible');
  await expect(logos).toHaveCount(expectedSrcs.length);
  for (let i = 0; i < expectedSrcs.length; i += 1) {
    const img = logos.nth(i);
    await expect(img).toHaveAttribute('src', new RegExp(`^/payment-brands/${expectedSrcs[i]}(-dark)?\\.svg$`));
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
}

/** كل رقم/مرجع داخل `<bdi dir="ltr">` يُعرض LTR فعلاً (لا يتأثر باتجاه RTL المحيط). */
async function ltrIslands(page: Page, scope: Locator | Page = page): Promise<number> {
  const handles = await scope.locator('bdi[dir="ltr"]').locator('visible=true').elementHandles();
  for (const h of handles.slice(0, 40)) {
    const css = await h.evaluate((el) => { const s = getComputedStyle(el as Element); return { direction: s.direction, unicodeBidi: s.unicodeBidi }; });
    expect(css.direction).toBe('ltr');
    expect(css.unicodeBidi).toMatch(/isolate/);
  }
  return handles.length;
}

/** عنصر (حوار/لوح) يظهر كاملاً داخل الشاشة أفقياً، وإن طال رأسياً فله تمرير داخلي. */
async function fitsViewport(el: Locator) {
  const result = await el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    let scrollable = false;
    for (let cur: HTMLElement | null = node as HTMLElement; cur; cur = cur.parentElement) {
      const s = getComputedStyle(cur);
      if (/(auto|scroll)/.test(s.overflowY) && cur.scrollHeight > cur.clientHeight) { scrollable = true; break; }
      if (cur === document.body) break;
    }
    if (!scrollable) {
      for (const child of Array.from((node as Element).querySelectorAll<HTMLElement>('*'))) {
        const s = getComputedStyle(child);
        if (/(auto|scroll)/.test(s.overflowY) && child.scrollHeight > child.clientHeight) { scrollable = true; break; }
      }
    }
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw, vh, scrollable };
  });
  expect(result.left, 'dialog left edge').toBeGreaterThanOrEqual(-1);
  expect(result.right, 'dialog right edge').toBeLessThanOrEqual(result.vw + 1);
  expect(result.top, 'dialog top edge').toBeGreaterThanOrEqual(-1);
  if (result.bottom > result.vh + 1) expect(result.scrollable, 'tall dialog must scroll internally').toBe(true);
}

/** جداول لا تُقصّ على الجوال: إما تتسع للشاشة أو داخل حاوية تمرير أفقي. */
async function tablesUsable(page: Page) {
  const bad = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const table of Array.from(document.querySelectorAll('table'))) {
      const r = table.getBoundingClientRect();
      if (r.width === 0 || getComputedStyle(table).display === 'none') continue;
      if (r.width <= vw + 1 && r.right <= vw + 1 && r.left >= -1) continue;
      let ok = false;
      for (let cur: HTMLElement | null = table.parentElement; cur; cur = cur.parentElement) {
        const s = getComputedStyle(cur);
        if (/(auto|scroll)/.test(s.overflowX) && cur.clientWidth <= vw + 1) { ok = true; break; }
      }
      if (!ok) out.push(`table wider than viewport (${Math.round(r.width)}px) without a scroll container`);
    }
    return out;
  });
  expect(bad).toEqual([]);
}

async function keyboardReachesButton(page: Page) {
  let reached = false;
  for (let i = 0; i < 25 && !reached; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !/^(BUTTON|A|SELECT|INPUT)$/.test(el.tagName) && el.getAttribute('role') !== 'tab') return null;
      const s = getComputedStyle(el);
      return { tag: el.tagName, indicator: (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none' };
    });
    if (info && (info.tag === 'BUTTON' || info.tag === 'A')) {
      reached = true;
      expect(info.indicator, 'focused control shows a visible focus indicator').toBe(true);
    }
  }
  expect(reached, 'keyboard Tab reaches a button/link').toBe(true);
}

const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};

// ───────────────────────── السيناريوهات ─────────────────────────

interface Ctx {
  locale: Locale;
  theme: Theme;
  vw: Vw;
  w: World;
  t: (ns: string, key: string) => string;
}

interface Scenario {
  id: string;
  /** المصفوفة الكاملة 4×2×2 بدل 390/1440 × ar/en. */
  full?: boolean;
  world?: Partial<World>;
  /** صلاحيات المستخدم المُعترَض (الافتراضي كل شيء). */
  permissions?: string[];
  run: (page: Page, ctx: Ctx) => Promise<void>;
}

const gotoOnline = async (page: Page, ctx: Ctx, section?: 'refunds' | 'settlements' | 'adjustments' | 'reports') => {
  await page.goto(`${baseUrl}/payments/online`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: ctx.t('paymentsOnline', 'title') })).toBeVisible();
  if (section) {
    const label = {
      refunds: ctx.t('paymentRefunds', 'section_refunds'),
      settlements: ctx.t('paymentSettlements', 'section_settlements'),
      adjustments: ctx.t('paymentSettlements', 'section_adjustments'),
      reports: ctx.t('paymentReports', 'section_reports'),
    }[section];
    await page.getByRole('tab', { name: label }).click();
  }
};

/** زر الدفع يحمل المبلغ («Pay {amount}»): نطابق بادئته المترجمة. */
const payButtonName = (c: Ctx) => new RegExp(`^${c.t('payLink', 'pay_button_amount').split('{amount}')[0].trim()}`);

const closeByEscape = async (page: Page, dialog: Locator) => {
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
};

/** نص ظاهر أول مطابقة (الجدول على سطح المكتب أو البطاقة على الجوال). */
const shown = (page: Page, text: string | RegExp) => page.getByText(text).locator('visible=true').first();

const SCENARIOS: Scenario[] = [
  {
    id: 'gateways-list', full: true,
    run: async (page, c) => {
      await page.goto(`${baseUrl}/finance-settings/payments?tab=gateways`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: c.t('paymentSettings', 'title') }).first()).toBeVisible();
      await expect(shown(page, c.locale === 'ar' ? 'ميسّر' : 'Moyasar')).toBeVisible();
      await expect(shown(page, c.t('paymentGateways', 'fields.feeTaxReject'))).toBeVisible();   // سياسة ضريبة الرسوم: مرفوضة افتراضياً
      // شعار المزوّد يظهر في بطاقة الاتصال (ميسّر) بنسخته المناسبة للثيم؛ الاتصال اليدوي بلا علامة مسجَّلة ⇒ بلا شعار
      await expectLogosLoaded(page.getByTestId('pg-item-g1'), ['moyasar']);
      await expect(page.getByTestId('pg-item-g1').locator('img:visible')).toHaveAttribute('src', c.theme === 'dark' ? '/payment-brands/moyasar-dark.svg' : '/payment-brands/moyasar.svg');
      await expectLogosLoaded(page.getByTestId('pg-item-g3'), ['moyasar']);   // اتصال غير مفعَّل: الشعار يظهر وحالته الصحيحة تبقى
      await expect(page.getByTestId('pg-item-g2').locator('img')).toHaveCount(0);
      expect(await ltrIslands(page)).toBeGreaterThanOrEqual(0);
      await tablesUsable(page);
      await keyboardReachesButton(page);
    },
  },
  {
    id: 'payment-methods-tab', full: true,
    run: async (page, c) => {
      await page.goto(`${baseUrl}/finance-settings/payments`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: c.t('paymentSettings', 'title') }).first()).toBeVisible();
      await expect(page.getByRole('tab', { name: c.t('paymentSettings', 'tabMethods') })).toHaveAttribute('aria-selected', 'true');
      const list = page.getByTestId('pm-list');
      await expect(list).toBeVisible();
      // الحالات الأربع كما حسبها الخادم، مع الشعار المسجَّل لكل وسيلة (محمَّل فعلاً) ولا قائمة اختيار بوابة وهمية
      await expect(page.getByTestId('pm-status-mada')).toHaveText(c.t('onlinePaymentMethods', 'status.enabled'));
      await expect(page.getByTestId('pm-status-visa')).toHaveText(c.t('onlinePaymentMethods', 'status.disabled'));
      await expect(page.getByTestId('pm-status-apple_pay')).toHaveText(c.t('onlinePaymentMethods', 'status.needs_setup'));
      await expect(page.getByTestId('pm-status-mastercard')).toHaveText(c.t('onlinePaymentMethods', 'status.unsupported'));
      for (const [key, file] of [['mada', 'mada'], ['visa', 'visa'], ['mastercard', 'mastercard'], ['apple_pay', 'apple-pay']]) {
        await expectLogosLoaded(page.getByTestId(`pm-item-${key}`), [file]);
      }
      await expect(list.getByRole('combobox')).toHaveCount(0);
      await expect(page.getByTestId('pm-item-apple_pay').getByRole('switch')).toBeDisabled();
      await expect(page.getByTestId('pm-item-mastercard').getByRole('switch')).toBeDisabled();
      await expect(page.getByTestId('pm-store-mada')).toHaveText(c.t('onlinePaymentMethods', 'usageStoreUnavailable'));
      await expect(page.getByTestId('pm-scope-note')).toBeVisible();
      await tablesUsable(page);
      await keyboardReachesButton(page);
    },
  },
  {
    id: 'payment-methods-toggle',
    run: async (page, c) => {
      await page.goto(`${baseUrl}/finance-settings/payments`, { waitUntil: 'domcontentloaded' });
      const visa = page.getByTestId('pm-item-visa').getByRole('switch');
      await expect(visa).toHaveAttribute('aria-checked', 'false');
      await visa.click();
      await expect(page.getByTestId('pm-status-visa')).toHaveText(c.t('onlinePaymentMethods', 'status.enabled'));
      await expect(visa).toHaveAttribute('aria-checked', 'true');
      expect(c.w.requests).toContain('PUT /online-payment-methods/visa');
      await visa.click();
      await expect(page.getByTestId('pm-status-visa')).toHaveText(c.t('onlinePaymentMethods', 'status.disabled'));
    },
  },
  {
    id: 'payment-methods-load-failure', world: { methodsMode: 'failing' },
    run: async (page, c) => {
      await page.goto(`${baseUrl}/finance-settings/payments`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('[role=alert]:not(#__next-route-announcer__)')).toContainText(c.t('onlinePaymentMethods', 'loadFailed'));
      await expect(page.getByRole('button', { name: c.t('onlinePaymentMethods', 'retry') })).toBeVisible();
    },
  },
  {
    id: 'payment-methods-viewer', permissions: ['payments.view'],
    run: async (page, c) => {
      await page.goto(`${baseUrl}/finance-settings/payments`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('pm-list')).toBeVisible();
      for (const key of ['mada', 'visa', 'mastercard', 'apple_pay']) {
        await expect(page.getByTestId(`pm-item-${key}`).getByRole('switch')).toBeDisabled();
      }
      await expect(page.getByTestId('pm-reason-visa')).toHaveText(c.t('onlinePaymentMethods', 'blocked.no_permission'));
      // الشعارات المسجَّلة تظهر لكل وسيلة مهما كانت حالتها، وحالتها الصحيحة تبقى ظاهرة بجانبها
      for (const [key, file] of [['mada', 'mada'], ['visa', 'visa'], ['mastercard', 'mastercard'], ['apple_pay', 'apple-pay']]) {
        await expectLogosLoaded(page.getByTestId(`pm-item-${key}`), [file]);
      }
      await expect(page.getByTestId('pm-status-apple_pay')).toHaveText(c.t('onlinePaymentMethods', 'status.needs_setup'));
      await expect(page.getByTestId('pm-status-mastercard')).toHaveText(c.t('onlinePaymentMethods', 'status.unsupported'));
    },
  },
  {
    id: 'gateway-detail-sheet', full: true,
    run: async (page, c) => {
      await page.goto(`${baseUrl}/finance-settings/payments?tab=gateways`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('pg-details-g1').click();
      const sheet = page.getByTestId('pg-detail');
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole('heading', { level: 3 })).toHaveCount(6);
      await expect(sheet.getByTestId('pg-webhook-url')).toContainText('payment-webhooks/moyasar/');
      await expect(sheet.getByTestId('pg-detail-methods').locator('li')).toHaveCount(4);
      await expect(sheet.getByText(c.t('paymentGateways', 'detail.money.policyUnavailable'))).toBeVisible();
      expect(await ltrIslands(page, sheet)).toBeGreaterThan(0);
      await fitsViewport(sheet);
      await shot(page, `gateway-detail-sheet-open-${c.locale}-${c.vw}-${c.theme}`);
      await closeByEscape(page, sheet);
    },
  },
  {
    id: 'gateway-detail-no-adapter',
    run: async (page, c) => {
      await page.goto(`${baseUrl}/finance-settings/payments?tab=gateways`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('pg-details-g2').click();
      const sheet = page.getByTestId('pg-detail');
      await expect(sheet.getByText(c.t('paymentGateways', 'detail.methods.noAdapter'))).toBeVisible();
      await expect(sheet.getByTestId('pg-detail-methods')).toHaveCount(0);
      await fitsViewport(sheet);
    },
  },
  {
    id: 'tab-switch-and-url',
    run: async (page, c) => {
      await page.goto(`${baseUrl}/finance-settings/payments`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('tab', { name: c.t('paymentSettings', 'tabGateways') }).click();
      await expect(page.getByTestId('pg-list')).toBeVisible();
      await expect(page).toHaveURL(/tab=gateways/);
      await page.getByRole('tab', { name: c.t('paymentSettings', 'tabGateways') }).press(c.locale === 'ar' ? 'ArrowRight' : 'ArrowLeft');
      await expect(page.getByTestId('pm-list')).toBeVisible();
    },
  },
  {
    id: 'gateways-wizard',
    run: async (page, c) => {
      await page.goto(`${baseUrl}/finance-settings/payments?tab=gateways`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: c.t('paymentGateways', 'add') }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(c.t('paymentGateways', 'form.addTitle')).first()).toBeVisible();
      await fitsViewport(dialog);
      await closeByEscape(page, dialog);
    },
  },
  {
    id: 'online-payments-and-blocked', full: true,
    run: async (page, c) => {
      await gotoOnline(page, c);
      await expect(shown(page, 'INV-0001')).toBeVisible();
      await tablesUsable(page);
      await page.getByRole('tab', { name: new RegExp(c.t('paymentsOnline', 'tab_blocked')) }).click();
      await expect(shown(page, c.t('paymentsOnline', 'blocked_hint'))).toBeVisible();
      await expect(shown(page, 'INV-0002')).toBeVisible();
      expect(await ltrIslands(page)).toBeGreaterThan(0);
      await keyboardReachesButton(page);
    },
  },
  {
    id: 'online-payment-detail',
    run: async (page, c) => {
      await gotoOnline(page, c);
      await page.getByRole('button', { name: c.t('paymentsOnline', 'action_details') }).locator('visible=true').first().click();
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByText(c.t('paymentsOnline', 'detail_title')).first()).toBeVisible();
      await fitsViewport(sheet);
      await closeByEscape(page, sheet);
    },
  },
  {
    id: 'refunds-list-and-detail',
    run: async (page, c) => {
      await gotoOnline(page, c, 'refunds');
      await expect(shown(page, 'PRF-2026-00001')).toBeVisible();
      await expect(shown(page, c.t('paymentRefunds', 'status_requested'))).toBeVisible();
      await tablesUsable(page);
      await page.getByRole('button', { name: c.t('paymentRefunds', 'action_details') }).locator('visible=true').first().click();
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByText(c.t('paymentRefunds', 'detail_title')).first()).toBeVisible();
      await expect(sheet.getByText('CN-0001').first()).toBeVisible();
      await fitsViewport(sheet);
      await ltrIslands(page, sheet);
      await closeByEscape(page, sheet);
    },
  },
  {
    id: 'settlements-list', full: true,
    run: async (page, c) => {
      await gotoOnline(page, c, 'settlements');
      await expect(shown(page, 'SET-001')).toBeVisible();
      await expect(shown(page, 'SET-002')).toBeVisible();
      await expect(shown(page, c.t('paymentSettlements', 'status_posted'))).toBeVisible();
      await expect(shown(page, c.t('paymentSettlements', 'status_unreconciled'))).toBeVisible();
      expect(await ltrIslands(page)).toBeGreaterThan(0);
      await tablesUsable(page);
      await keyboardReachesButton(page);
    },
  },
  {
    id: 'settlement-detail',
    run: async (page, c) => {
      await gotoOnline(page, c, 'settlements');
      await page.getByRole('button', { name: c.t('paymentSettlements', 'action_details') }).locator('visible=true').first().click();
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByText(c.t('paymentSettlements', 'detail_title')).first()).toBeVisible();
      await expect(sheet.getByText(c.t('paymentSettlements', 'lines_title')).first()).toBeVisible();
      await expect(sheet.getByText('PRF-2026-00002').first()).toBeVisible();
      await fitsViewport(sheet);
      expect(await ltrIslands(page, sheet)).toBeGreaterThan(0);
      await closeByEscape(page, sheet);
    },
  },
  ...(['postable', 'unreconciled'] as const).map((mode): Scenario => ({
    id: `settlement-record-${mode}`,
    world: { previewMode: mode },
    run: async (page, c) => {
      await gotoOnline(page, c, 'settlements');
      await page.getByRole('button', { name: c.t('paymentSettlements', 'record_open') }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText(c.t('paymentSettlements', 'record_title')).first()).toBeVisible();
      await dialog.locator('#rs-gateway').selectOption('g1');
      await dialog.locator('#rs-ref').fill('PROV-2026-10-23');
      await dialog.locator('#rs-date').fill('2026-10-23');
      await dialog.locator('#rs-net').fill('1110.00');
      await dialog.locator('#rs-fee').fill('40.00');
      await dialog.getByRole('checkbox', { name: 'PAY-1' }).check();
      await expect(dialog.getByText(c.t('paymentSettlements', 'fee_tax_closed'))).toBeVisible();   // ضريبة الرسوم مغلقة افتراضياً
      const primary = dialog.getByRole('button', { name: c.t('paymentSettlements', mode === 'postable' ? 'submit_post' : 'submit_unreconciled') });
      await expect(primary).toBeEnabled();
      await expect(dialog.getByTestId('rs-preview')).toBeVisible();
      if (mode === 'unreconciled') await expect(dialog.getByText(c.t('paymentSettlements', 'unreconciled_explain'))).toBeVisible();
      else await expect(dialog.getByRole('button', { name: c.t('paymentSettlements', 'submit_unreconciled') })).toHaveCount(0);
      await fitsViewport(dialog);
      expect(await a11yBasics(page)).toEqual([]);
      await shot(page, `record-${mode}-${c.locale}-${c.vw}-${c.theme}`);
      await closeByEscape(page, dialog);
    },
  })),
  {
    id: 'adjustments-list-reserve-request',
    run: async (page, c) => {
      await gotoOnline(page, c, 'adjustments');
      await expect(shown(page, 'EV-100')).toBeVisible();
      await expect(shown(page, c.t('paymentAdjustments', 'action_approve'))).toBeVisible();   // طالب المالك ≠ المستخدم الحالي ⇒ يمكنه الاعتماد
      await tablesUsable(page);
      await page.locator('#pa-gateway').selectOption('g1');
      const reserve = page.getByTestId('pa-reserve');
      await expect(reserve).toBeVisible();
      await expect(reserve.getByText(c.t('paymentAdjustments', 'reserve_held'))).toBeVisible();
      await page.getByRole('button', { name: c.t('paymentAdjustments', 'request_open') }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText(c.t('paymentAdjustments', 'request_title')).first()).toBeVisible();
      await fitsViewport(dialog);
      expect(await a11yBasics(page)).toEqual([]);
      await closeByEscape(page, dialog);
    },
  },
  {
    id: 'reports-reconciled',
    run: async (page, c) => {
      await gotoOnline(page, c, 'reports');
      await expect(shown(page, c.t('paymentReports', 'recon_status_reconciled'))).toBeVisible();
      await expect(shown(page, c.t('paymentReports', 'recon_checks_title'))).toBeVisible();
      await expect(shown(page, c.t('paymentReports', 'not_checked_title'))).toBeVisible();
      expect(await ltrIslands(page)).toBeGreaterThan(0);
      await tablesUsable(page);
    },
  },
  {
    id: 'reports-difference', full: true, world: { reconMode: 'difference' },
    run: async (page, c) => {
      await gotoOnline(page, c, 'reports');
      await expect(shown(page, c.t('paymentReports', 'recon_status_difference'))).toBeVisible();
      await expect(shown(page, c.t('paymentReports', 'recon_other_note'))).toBeVisible();   // قيد يدوي ظاهر لا مخفي
      await tablesUsable(page);
      expect(await ltrIslands(page)).toBeGreaterThan(0);
      await keyboardReachesButton(page);
      await shot(page, `recon-difference-${c.locale}-${c.vw}-${c.theme}`);
    },
  },
  {
    id: 'reports-branch-scope-forbidden', world: { reconMode: 'forbidden' },
    run: async (page, c) => {
      await gotoOnline(page, c, 'reports');
      await expect(shown(page, c.t('paymentReports', 'branch_scope_title'))).toBeVisible();   // حالة فارغة شارحة لا خطأ عام
      await expect(page.getByText(c.t('paymentReports', 'load_failed'))).toHaveCount(0);
    },
  },
  {
    id: 'reports-differences',
    run: async (page, c) => {
      await gotoOnline(page, c, 'reports');
      await page.getByRole('tab', { name: c.t('paymentReports', 'tab_differences') }).click();
      await expect(shown(page, 'DIFF-A')).toBeVisible();
      await expect(shown(page, 'DIFF-B')).toBeVisible();
      await expect(shown(page, c.t('paymentReports', 'diff_count'))).toBeVisible();
      expect(await ltrIslands(page)).toBeGreaterThan(0);
      await tablesUsable(page);
    },
  },
  {
    id: 'reports-aging', full: true,
    run: async (page, c) => {
      await gotoOnline(page, c, 'reports');
      await page.getByRole('tab', { name: c.t('paymentReports', 'tab_aging') }).click();
      await expect(shown(page, c.t('paymentReports', 'aging_net'))).toBeVisible();
      await expect(page.getByTestId('aging-totals')).toBeVisible();
      await expect(shown(page, c.t('paymentReports', 'branch_unassigned'))).toBeVisible();
      await expect(shown(page, c.locale === 'ar' ? 'فرع الشرق' : 'فرع الشرق')).toBeVisible();
      await tablesUsable(page);
      expect(await ltrIslands(page)).toBeGreaterThan(0);
      await shot(page, `aging-${c.locale}-${c.vw}-${c.theme}`);
    },
  },
  {
    id: 'paylink-open', full: true,
    run: async (page, c) => {
      await page.goto(`${baseUrl}/pay/tok_open`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'شركة نبراس الطموح' })).toBeVisible();
      await expect(page.getByTestId('pay-amount-due')).toBeVisible();
      // وسائل الدفع المقبولة: ما أعلنه الخادم فقط (مدى وفيزا)، نصاً بلا شعار غير رسمي
      const accepted = page.getByTestId('payment-brand-row');
      await expect(accepted.locator('li')).toHaveCount(2);
      await expectLogosLoaded(accepted, ['mada', 'visa']);
      await expect(page.getByRole('button', { name: payButtonName(c) }).first()).toBeVisible();
      expect(await ltrIslands(page)).toBeGreaterThanOrEqual(0);
      expect(await a11yBasics(page)).toEqual([]);
      await keyboardReachesButton(page);
      await shot(page, `paylink-open-${c.locale}-${c.vw}-${c.theme}`);
    },
  },
  {
    id: 'paylink-apple-pay-device', full: true,
    run: async (page, c) => {
      await page.addInitScript(() => { (window as unknown as { ApplePaySession: unknown }).ApplePaySession = { canMakePayments: () => true }; });
      await page.goto(`${baseUrl}/pay/tok_open_apple`, { waitUntil: 'domcontentloaded' });
      const accepted = page.getByTestId('payment-brand-row');
      await expect(accepted.locator('li')).toHaveCount(3);
      await expectLogosLoaded(accepted, ['mada', 'visa', 'apple-pay']);
      expect(await a11yBasics(page)).toEqual([]);
      await shot(page, `paylink-apple-pay-${c.locale}-${c.vw}-${c.theme}`);
    },
  },
  {
    id: 'paylink-apple-pay-unsupported-device',
    run: async (page) => {
      await page.goto(`${baseUrl}/pay/tok_open_apple`, { waitUntil: 'domcontentloaded' });
      const accepted = page.getByTestId('payment-brand-row');
      await expect(accepted.locator('li')).toHaveCount(2);
      await expectLogosLoaded(accepted, ['mada', 'visa']);
      await expect(accepted.locator('img[src="/payment-brands/apple-pay.svg"]')).toHaveCount(0);
    },
  },
  {
    id: 'paylink-partial',
    run: async (page, c) => {
      await page.goto(`${baseUrl}/pay/tok_partial`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText(c.t('payLink', 'state_partial_title')).first()).toBeVisible();
      const amount = page.locator('#pay-amount');
      await expect(amount).toBeVisible();
      await expect(page.getByLabel(c.t('payLink', 'partial_label'))).toBeVisible();
      await amount.fill('999999');
      await expect(page.getByText(c.t('payLink', 'partial_exceeds')).first()).toBeVisible();
      expect(await a11yBasics(page)).toEqual([]);
    },
  },
  ...(['expired', 'cancelled', 'completed', 'unavailable'] as const).map((state): Scenario => ({
    id: `paylink-${state}`,
    run: async (page, c) => {
      await page.goto(`${baseUrl}/pay/tok_${state}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText(c.t('payLink', `state_${state}_title`)).first()).toBeVisible();
      await expect(page.getByRole('button', { name: payButtonName(c) })).toHaveCount(0);
    },
  })),
  {
    id: 'paylink-not-found',
    run: async (page, c) => {
      await page.goto(`${baseUrl}/pay/tok_gone`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText(c.t('payLink', 'not_found_title')).first()).toBeVisible();
    },
  },
];

// ───────────────────────── المصفوفة ─────────────────────────

const ALL_VW: Vw[] = [390, 768, 1280, 1440];
const LOCALES: Locale[] = ['ar', 'en'];
const THEMES: Theme[] = ['light', 'dark'];

test.describe('PAY-H8-02 payments screens', () => {
  for (const scenario of SCENARIOS) {
    const combos: { vw: Vw; locale: Locale; theme: Theme }[] = scenario.full
      ? ALL_VW.flatMap((vw) => LOCALES.flatMap((locale) => THEMES.map((theme) => ({ vw, locale, theme }))))
      : ([390, 1440] as Vw[]).flatMap((vw) => LOCALES.map((locale) => ({ vw, locale, theme: (locale === 'ar' ? 'dark' : 'light') as Theme })));

    for (const { vw, locale, theme } of combos) {
      test(`${scenario.id} · ${vw} · ${locale} · ${theme}`, async ({ page }) => {
        const w = newWorld(scenario.world);
        const errors = watchErrors(page, ['paylink-not-found', 'reports-branch-scope-forbidden', 'payment-methods-load-failure'].includes(scenario.id));
        const ctx: Ctx = { locale, theme, vw, w, t: (ns, key) => msg(locale, ns, key) };
        await setup(page, w, { locale, theme, vw, permissions: scenario.permissions });
        await scenario.run(page, ctx);
        await baseChecks(page, ctx);
        await shot(page, `${scenario.id}-${locale}-${vw}-${theme}`);
        expect(errors, 'no page/console errors').toEqual([]);
        expect(w.unrouted.filter((p) => !/^GET \/(notifications|dashboard|onboarding|company-browser-icon)/.test(p)), 'every API call used by the screen is mocked').toEqual([]);
      });
    }
  }
});
