// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const FONT = readFileSync(join(process.cwd(), 'public/fonts/NotoSansArabic-Regular.ttf'));
vi.stubGlobal('fetch', vi.fn(async () => {
  const bytes = FONT.buffer.slice(FONT.byteOffset, FONT.byteOffset + FONT.byteLength);
  return { ok: true, arrayBuffer: async () => bytes } as unknown as Response;
}));

import type { CashSummary } from '../cash-summary';
import type { CollectionView } from '../collection';
import { CATALOG, STATION, closedDetail, frozenCollection, translator } from './__fixtures__';
import { buildShiftReport, type ShiftReportInput } from './model';
import { createShiftReportPdf } from './pdf';

/**
 * AWJ-DOC-V2-PR7 — حدود كشف المبالغ في تقرير الوردية مقابل صلاحيات الخادم الفعلية (D8).
 *
 * الخادم هو السلطة: `FuelShiftCollectionService` (`sales.visible` / `reconciliation.visible` / `review.visible` = `fuel.sale.view`) و
 * `FuelShiftCashExpectationService::shape()` (مكوّن نقد المبيعات محجوب ⇒ `expected_cash_minor=null` و`variance_minor=null` والجزئي بلا ذلك المكوّن)
 * و`FuelShiftResource` (المتوقع/الفرق القديمان null). هذا الاختبار يبني حمولات **بشكل ما يردّه الخادم** لمن لا يملك الصلاحية، بمبالغ «حارسة»
 * فريدة لا تظهر إلا في الحمولة المخوَّلة، ثم يثبت أنها لا تظهر في النموذج (المعاينة) ولا في نص الـPDF. لا تغيير في سياسة الصلاحيات.
 */
const SENTINELS = {
  declaredCash: 7_654_321, // نقد مبيعات (مُقَرّ به): يخص fuel.sale.view
  salesAmount: 8_888_801, // إجمالي مبيعات
  price: 7_777, // سعر اللتر
  productAmount: 5_555_501, // مبلغ منتج
  difference: 4_444_401, // فرق المطابقة
  expectedTotal: 9_999_901, // المتوقع الكامل (يشمل نقد المبيعات)
  cashVariance: 3_333_301, // فرق الدرج
  network: 2_222_201, // شبكة
};
const fmt = (minor: number) => `${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const SECRET_TEXTS = Object.values(SENTINELS).map(fmt);

/** ملخص نقد كما يردّه `shape()` لمن لا يملك fuel.sale.view (أساس الإقرار، وردية مجمَّدة). */
const redactedSummary = (): CashSummary => ({
  state: 'frozen', basis: 'declared_collection',
  components: {
    opening_float_minor: 20_000,
    official_cash_receipts: { available: false, amount_minor: null, count: null, reason: 'basis_not_enabled' },
    declared_cash: { available: false, amount_minor: null, reason: 'permission' },
    cash_in_minor: 500, cash_out_minor: 10_000, treasury_handover_minor: 10_000, expenses_minor: 300,
  },
  expected_cash_minor: null, expected_cash_partial_minor: 20_000 + 500 - 10_000 - 300, expected_complete: false, incompleteness: ['permission_sales_view'],
  counted_cash_minor: 25_000, variance_minor: null, variance_final: false,
  network_receipts: { available: false, amount_minor: null, reason: 'permission', information_only: true },
  unattributed_cash_receipts: null,
  post_close_adjustments: { available: false, items: [], net_effect_minor: null },
});

/** اللقطة المجمَّدة كما يردّها الخادم لمن لا يملك fuel.sale.view: لا سعر/مبلغ/مطابقة/مراجعة، ويبقى إقرار الموظف نفسه. */
const redactedCollection = (): CollectionView => frozenCollection({
  review: { visible: false },
  sales: {
    visible: false, complete: true, milliliters: 1_290_500, milliliters_complete: true, amount_minor: null, tax_mode: null, evaluated_at: null,
    products: [{ fuel_product_id: 'p1', name: 'Alpha', nozzle_count: 2, milliliters: 790_500, gaps: [] }, { fuel_product_id: 'p2', name: 'Beta', nozzle_count: 1, milliliters: 500_000, gaps: [] }] as CollectionView['sales']['products'],
    nozzles: [], gaps: [],
  },
  reconciliation: { visible: false },
  drawer: { frozen: true, opening_float_minor: 20_000, counted_cash_minor: 25_000, treasury_handover_minor: 0, cash_in_minor: 0, cash_out_minor: 0, expenses_minor: 0, implied_sales_cash: { visible: false } },
});

/** نفس الوردية لمخوَّل بالمبيعات: تحمل الحراس كلها (للمقارنة: ثبّت أن الحارس يظهر حين يُسمح به، فلا يكون الاختبار فارغاً). */
const privilegedCollection = (): CollectionView => frozenCollection({
  declaration: { ...frozenCollection().declaration!, collected_total_minor: SENTINELS.declaredCash, cash_declared_minor: SENTINELS.declaredCash, lines: [{ payment_method_id: 'm', name: 'Cash', settlement_type: 'cash', amount_minor: SENTINELS.declaredCash, still_allowed: true }] },
  sales: {
    ...frozenCollection().sales, amount_minor: SENTINELS.salesAmount,
    products: [{ fuel_product_id: 'p1', name: 'Alpha', nozzle_count: 2, milliliters: 790_500, price_per_liter_minor: SENTINELS.price, price_source: 'x', amount_minor: SENTINELS.productAmount, gaps: [] }, { fuel_product_id: 'p2', name: 'Beta', nozzle_count: 1, milliliters: 500_000, price_per_liter_minor: SENTINELS.price, price_source: 'x', amount_minor: SENTINELS.productAmount, gaps: [] }],
  },
  reconciliation: { visible: true, final: true, reason: null, collected_total_minor: SENTINELS.declaredCash, sales_minor: SENTINELS.salesAmount, difference_minor: SENTINELS.difference, direction: 'overage' },
});
const privilegedSummary = (): CashSummary => ({
  ...redactedSummary(),
  components: { ...redactedSummary().components, declared_cash: { available: true, amount_minor: SENTINELS.declaredCash, reason: null } },
  expected_cash_minor: SENTINELS.expectedTotal, expected_cash_partial_minor: SENTINELS.expectedTotal, expected_complete: true, incompleteness: [],
  variance_minor: SENTINELS.cashVariance, variance_final: true,
  network_receipts: { available: true, amount_minor: SENTINELS.network, reason: null, information_only: true },
});

const base = (over: Partial<ShiftReportInput> = {}): ShiftReportInput => ({
  t: translator('en'), company: { name: 'Acme', vat_number: '300000000000003', cr_number: '1010101010' }, station: STATION,
  detail: closedDetail({ cash_summary: redactedSummary() }), catalog: CATALOG, collection: redactedCollection(), viewer: { id: 'u1', name: 'Sami Operator' }, paper: 'a4', generatedAt: new Date('2026-11-03T14:00:00Z'), ...over,
});
const dump = (input: ShiftReportInput) => JSON.stringify(buildShiftReport(input).sections);
const SECRET_LABELS = ['Price per litre', 'Sales due', 'Overage', 'Shortage', 'Supervisor review'];

describe('amount disclosure vs the server permission contract (fuel.sale.view)', () => {
  it('control: the same report WITH sales permission does carry the guarded amounts (so the test below is not vacuous)', () => {
    const text = dump(base({ detail: closedDetail({ cash_summary: privilegedSummary() }), collection: privilegedCollection() }));
    for (const secret of [SENTINELS.salesAmount, SENTINELS.productAmount, SENTINELS.difference, SENTINELS.expectedTotal, SENTINELS.cashVariance, SENTINELS.declaredCash].map(fmt)) expect(text, secret).toContain(secret);
  });

  it.each([['a4'], ['a5']] as const)('(%s) server-redacted payload (cash_summary + collection) ⇒ NO guarded amount or label anywhere in the report model', (paper) => {
    for (const locale of ['en', 'ar'] as const) {
      const text = dump(base({ paper, t: translator(locale) }));
      for (const secret of SECRET_TEXTS) expect(text, `${secret} leaked (${paper}/${locale})`).not.toContain(secret);
    }
    const english = dump(base({ paper }));
    for (const label of SECRET_LABELS) expect(english, label).not.toContain(label);
  });

  it('the partial expected cash printed for a no-permission viewer is exactly the server partial (no hidden component can be recovered by the report)', () => {
    const model = buildShiftReport(base());
    const cash = model.sections.find((entry) => entry.key === 'cash') as Extract<(typeof model.sections)[number], { kind: 'kv' }>;
    const rows = Object.fromEntries(cash.rows.map((row) => [row.label, row.value]));
    expect(rows['Expected (partial)'].text).toBe('102.00 SAR'); // 20000+500−10000−300 = 10200
    expect(rows['Cash variance'].na).toBe(true); // الفرق محجوب ⇒ «غير متاح» لا رقم
    expect(rows['Declared cash'].na).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(fmt(SENTINELS.declaredCash));
  });

  it('legacy columns redacted by FuelShiftResource (expected/variance = null) print as unavailable, never 0', () => {
    const detail = closedDetail({ expected_operational_cash_minor: null, cash_variance_minor: null, counted_cash_minor: 25_000 });
    const model = buildShiftReport(base({ detail }));
    const cash = model.sections.find((entry) => entry.key === 'cash') as Extract<(typeof model.sections)[number], { kind: 'kv' }>;
    const rows = Object.fromEntries(cash.rows.map((row) => [row.label, row.value]));
    expect(rows['Expected cash'].na).toBe(true);
    expect(rows['Cash variance'].na).toBe(true);
    expect(rows['Expected cash'].text).not.toMatch(/^0/);
  });

  it('fail-closed on an inconsistent payload: sales.visible=false never prints reconciliation/review even if those flags claim visible', () => {
    const inconsistent = frozenCollection({
      ...privilegedCollection(),
      sales: { ...redactedCollection().sales },
      review: { visible: true, state: 'pending', reason: null, note: null, reviewed_by: null, reviewed_at: null },
    });
    const text = dump(base({ collection: inconsistent }));
    expect(text).not.toContain(fmt(SENTINELS.difference));
    expect(text).not.toContain(fmt(SENTINELS.salesAmount));
    expect(text).not.toContain('Pending review');
    expect(text).not.toContain('Sales due');
  });

  it('the employee’s own declaration (visible to fuel.shift.view by the server contract) is still printed — policy unchanged', () => {
    const model = buildShiftReport(base());
    expect(model.sections.find((entry) => entry.key === 'collection')).toBeDefined();
  });

  const hasPdftotext = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  it.skipIf(!hasPdftotext)('the generated PDF of a no-permission viewer has none of the guarded amounts or labels in its text layer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'perm-pdf-'));
    try {
      for (const paper of ['a4', 'a5'] as const) {
        const blob = await createShiftReportPdf(buildShiftReport(base({ paper })), 'en');
        writeFileSync(join(dir, 'r.pdf'), Buffer.from(await blob.arrayBuffer()));
        const text = execFileSync('pdftotext', ['-layout', join(dir, 'r.pdf'), '-'], { encoding: 'utf8' });
        for (const secret of SECRET_TEXTS) expect(text, `${secret} in ${paper} PDF`).not.toContain(secret);
        for (const label of SECRET_LABELS) expect(text, label).not.toContain(label);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
