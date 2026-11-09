// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CollectionView } from '../collection';
import { CATALOG, STATION, closedDetail, frozenCollection, translator } from './__fixtures__';
import type { CashSummary } from '../cash-summary';
import { buildShiftReport, isReportableShift, type ReportSection, type ShiftReportInput, type ShiftReportModel } from './model';

const base = (over: Partial<ShiftReportInput> = {}): ShiftReportInput => ({
  t: translator('en'), company: { name: 'Acme Fuel Co', vat_number: '300000000000003', cr_number: '1010101010' }, station: STATION,
  detail: closedDetail(), catalog: CATALOG, collection: frozenCollection(), viewer: { id: 'u1', name: 'Sami Operator' }, paper: 'a4', generatedAt: new Date('2026-11-03T14:00:00Z'), ...over,
});
const section = (model: ShiftReportModel, key: string): ReportSection | undefined => model.sections.find((entry) => entry.key === key);
const table = (model: ShiftReportModel, key: string) => section(model, key) as Extract<ReportSection, { kind: 'table' }>;
const kv = (model: ShiftReportModel, key: string) => section(model, key) as Extract<ReportSection, { kind: 'kv' }>;
const everyText = (model: ShiftReportModel) => JSON.stringify(model.sections);

describe('shift report model — data-source matrix', () => {
  it('only closed/approved shifts have a closing report', () => {
    expect(isReportableShift('closed')).toBe(true);
    expect(isReportableShift('approved')).toBe(true);
    for (const status of ['open', 'draft', 'locked', 'cancelled', '']) expect(isReportableShift(status)).toBe(false);
  });

  it('(1) detailed A4: shift identity, sales per product, readings per pump/nozzle, collection, reconciliation, cash and handover signatures', () => {
    const model = buildShiftReport(base());
    expect(model.variant).toBe('detailed');
    expect(model.status.key).toBe('closed');
    expect(model.company.name).toBe('Acme Fuel Co');
    const keys = model.sections.map((entry) => entry.key);
    for (const expected of ['shift', 'sales', 'readings', 'collection', 'reconciliation', 'cash', 'handover']) expect(keys).toContain(expected);
    const identity = Object.fromEntries(kv(model, 'shift').rows.map((row) => [row.label, row.value.text]));
    expect(identity['Shift number']).toBe('SH-100');
    expect(identity['Station']).toBe('Station A');
    expect(identity['Started']).toBe('2026-11-03 08:00'); // بتوقيت الرياض
    expect(identity['Ended']).toBe('2026-11-03 16:00');
    expect(identity['Duration']).toBe('8:00');
    expect(identity['Responsible employee']).toBe('Sami Operator'); // المغلِق هو المستخدم الحالي فقط؛ لا اسم مخمَّن
    const sales = table(model, 'sales');
    expect(sales.rows.map((row) => row[0].text)).toEqual(['Alpha', 'Beta']);
    expect(sales.rows[0].map((cell) => cell.text)).toEqual(['Alpha', '790.500', '2.00 SAR', '1,581.00 SAR']);
    expect(sales.totals?.[1].text).toBe('1,290.500'); // إجمالي لترات الخادم لا جمع الواجهة
    expect(sales.totals?.[3].text).toBe('2,831.00 SAR'); // إجمالي المبيعات من اللقطة المجمَّدة
    const sig = section(model, 'handover') as Extract<ReportSection, { kind: 'signatures' }>;
    expect(sig.cells).toHaveLength(3);
    expect(sig.cells[1].name).toBeNull(); // لا اسم/توقيع مخترع للمستلم
    expect(sig.cells[2].name).toBeNull();
  });

  it('(6) multiple pumps / nozzles / products: one reading row per nozzle with exact deltas; sums per product match the server', () => {
    const model = buildShiftReport(base());
    const readings = table(model, 'readings');
    expect(readings.rows).toHaveLength(3);
    const byNozzle = Object.fromEntries(readings.rows.map((row) => [row[1].text, row.map((cell) => cell.text)]));
    expect(byNozzle['1']).toEqual(['1', '1', 'Alpha', '125,430.000', '126,120.500', '690.500']);
    expect(byNozzle['2'][5]).toBe('500.000');
    expect(byNozzle['3'][0]).toBe('2'); // مضخة ثانية
    expect(byNozzle['3'][5]).toBe('100.000');
  });

  it('(7) large precise litres and amounts never round: millilitre precision and exact minor-unit money text', () => {
    const detail = closedDetail({
      operational_meter_milliliters: 9_999_999_999_999,
      meter_readings: [
        { id: 'a', nozzle_id: 'n1', reading_stage: 'opening', meter_milliliters: 0, measured_at: null },
        { id: 'b', nozzle_id: 'n1', reading_stage: 'closing', meter_milliliters: 9_999_999_999_999, measured_at: null },
      ],
    });
    const collection = frozenCollection({
      sales: { ...frozenCollection().sales, milliliters: 9_999_999_999_999, amount_minor: 99_999_999_999_999, products: [{ fuel_product_id: 'p1', name: 'Alpha', nozzle_count: 1, milliliters: 9_999_999_999_999, price_per_liter_minor: 12_345, price_source: 'x', amount_minor: 99_999_999_999_999, gaps: [] }] },
      reconciliation: { visible: true, final: true, reason: null, collected_total_minor: 99_999_999_999_999, sales_minor: 99_999_999_999_999, difference_minor: 0, direction: 'none' },
    });
    const model = buildShiftReport(base({ detail, collection }));
    const sales = table(model, 'sales');
    expect(sales.rows[0][1].text).toBe('9,999,999,999.999');
    expect(sales.rows[0][3].text).toBe('999,999,999,999.99 SAR');
    expect(sales.totals?.[1].text).toBe('9,999,999,999.999');
    expect(table(model, 'readings').rows[0][4].text).toBe('9,999,999,999.999');
  });
});

describe('shift report model — collection vs sales, honesty, permissions', () => {
  it('(5) collection differing from sales: the server-approved difference and direction are printed, never recomputed', () => {
    const shortage = frozenCollection({
      declaration: { ...frozenCollection().declaration!, collected_total_minor: 280_000, lines: [{ payment_method_id: 'm', name: 'Cash', settlement_type: 'cash', amount_minor: 280_000, still_allowed: true }] },
      reconciliation: { visible: true, final: true, reason: null, collected_total_minor: 280_000, sales_minor: 283_100, difference_minor: -3_100, direction: 'shortage' },
      review: { visible: true, state: 'pending', reason: null, note: null, reviewed_by: null, reviewed_at: null },
    });
    const model = buildShiftReport(base({ collection: shortage }));
    const recon = Object.fromEntries(kv(model, 'reconciliation').rows.map((row) => [row.label, row.value.text]));
    expect(recon['Sales due']).toBe('2,831.00 SAR');
    expect(recon['Total collected']).toBe('2,800.00 SAR');
    expect(recon['Difference']).toBe('31.00 SAR — Shortage');
    expect(recon['Supervisor review']).toBeDefined();
    const overage = frozenCollection({ reconciliation: { visible: true, final: true, reason: null, collected_total_minor: 290_000, sales_minor: 283_100, difference_minor: 6_900, direction: 'overage' } });
    expect(Object.fromEntries(kv(buildShiftReport(base({ collection: overage })), 'reconciliation').rows.map((row) => [row.label, row.value.text]))['Difference']).toBe('69.00 SAR — Overage');
  });

  it('non-final reconciliation is labelled provisional, and a missing difference is "unavailable" — never 0', () => {
    const provisional = frozenCollection({
      sales: { ...frozenCollection().sales, complete: false, amount_minor: null, gaps: ['price_unavailable'] },
      reconciliation: { visible: true, final: false, reason: 'sales_incomplete', collected_total_minor: 283_100, sales_minor: null, difference_minor: null, direction: null },
    });
    const model = buildShiftReport(base({ collection: provisional }));
    const recon = Object.fromEntries(kv(model, 'reconciliation').rows.map((row) => [row.label, row.value]));
    expect(recon['Sales due'].na).toBe(true);
    expect(recon['Difference'].na).toBe(true);
    expect(recon['Difference'].text).not.toMatch(/^0/);
    expect(recon['Result']).toBeDefined();
    expect(table(model, 'sales').totals?.[3].na).toBe(true); // إجمالي المبالغ غير مكتمل ⇒ غير متاح
  });

  it('(8) a viewer without sales permission gets NO prices, amounts, sales due or difference anywhere in the model', () => {
    const hidden = frozenCollection({
      review: { visible: false },
      sales: { ...frozenCollection().sales, visible: false, amount_minor: null, products: [{ fuel_product_id: 'p1', name: 'Alpha', nozzle_count: 2, milliliters: 790_500, gaps: [] }, { fuel_product_id: 'p2', name: 'Beta', nozzle_count: 1, milliliters: 500_000, gaps: [] }] },
      reconciliation: { visible: false },
    });
    const model = buildShiftReport(base({ collection: hidden }));
    expect(table(model, 'sales').columns.map((column) => column.key)).toEqual(['product', 'liters']);
    expect(table(model, 'sales').rows[0]).toHaveLength(2);
    expect(section(model, 'reconciliation')).toBeUndefined();
    expect(section(model, 'sales-hidden')).toBeDefined();
    const text = everyText(model);
    // المبلغ المُقرّ به هو إدخال الموظف نفسه؛ أما سعر اللتر ومبيعات المنتجات والمستحق والفرق فمحجوبة.
    expect(text).not.toContain('1,581.00');
    expect(text).not.toContain('1,250.00');
    expect(text).not.toContain('Price per litre');
    expect(text).not.toContain('Sales due');
    expect(text).not.toContain('Shortage');
  });

  it('(2-honesty) amounts come ONLY from the frozen snapshot: live/declared/missing snapshots print litres but declare amounts unavailable', () => {
    for (const collection of [null, frozenCollection({ state: 'declared' }), frozenCollection({ state: 'none', declaration: null })] as Array<CollectionView | null>) {
      const model = buildShiftReport(base({ collection }));
      expect(table(model, 'sales').columns.map((column) => column.key)).toEqual(['product', 'liters']);
      expect(section(model, 'collection')).toBeUndefined();
      expect(section(model, 'reconciliation')).toBeUndefined();
      expect(everyText(model)).not.toContain('2,831.00');
      expect(model.sections.some((entry) => entry.kind === 'note' && entry.tone === 'warning')).toBe(true);
      // اللترات من العدادات ما زالت تُطبع (مصدر الخادم للإجمالي).
      expect(table(model, 'sales').totals?.[1].text).toBe('1,290.500');
    }
    expect(buildShiftReport(base({ collection: null })).sections.find((entry) => entry.key === 'amounts-unavailable')).toBeDefined();
    expect(buildShiftReport(base({ collection: frozenCollection({ state: 'declared' }) })).sections.find((entry) => entry.key === 'amounts-not-frozen')).toBeDefined();
  });

  it('a shift closed without a collection declaration says so instead of inventing collection lines', () => {
    const model = buildShiftReport(base({ collection: frozenCollection({ declaration: null }) }));
    expect(section(model, 'collection')).toBeUndefined();
    expect(section(model, 'collection-none')).toBeDefined();
  });

  it('(4) incomplete readings are shown as incomplete (not 0) and flagged; the delta is not invented', () => {
    const detail = closedDetail({ meter_readings: [{ id: 'a', nozzle_id: 'n1', reading_stage: 'opening', meter_milliliters: 1_000, measured_at: null }] });
    const model = buildShiftReport(base({ detail }));
    const row = table(model, 'readings').rows.find((cells) => cells[1].text === '1')!;
    expect(row[3].text).toBe('1.000');
    expect(row[4].na).toBe(true);
    expect(row[5].na).toBe(true);
    expect(row[5].text).not.toMatch(/^0/);
    expect(model.sections.some((entry) => entry.key === 'readings-partial' || entry.key === 'mismatch')).toBe(true);
  });

  it('employee names: only the viewer is named; other staff are "unavailable" (ids only come from the server) and A4 notes it', () => {
    const other = buildShiftReport(base({ detail: closedDetail({ closed_by: 'someone-else' }) }));
    expect(Object.fromEntries(kv(other, 'shift').rows.map((row) => [row.label, row.value]))['Responsible employee'].na).toBe(true);
    expect(section(other, 'names-unavailable')).toBeDefined();
    const unknown = buildShiftReport(base({ detail: closedDetail({ closed_by: null }) }));
    expect(Object.fromEntries(kv(unknown, 'shift').rows.map((row) => [row.label, row.value]))['Responsible employee'].na).toBe(true);
  });

  it('cash block uses the server cash summary or stored figures and never a computed total', () => {
    const model = buildShiftReport(base());
    const cash = Object.fromEntries(kv(model, 'cash').rows.map((row) => [row.label, row.value.text]));
    expect(cash['Counted cash']).toBe('250.00 SAR');
    expect(cash['Expected cash']).toBe('250.00 SAR');
    const noCount = buildShiftReport(base({ detail: closedDetail({ counted_cash_minor: null, cash_variance_minor: null, expected_operational_cash_minor: null }) }));
    const rows = Object.fromEntries(kv(noCount, 'cash').rows.map((row) => [row.label, row.value]));
    expect(rows['Counted cash'].na).toBe(true);
    expect(rows['Cash variance'].na).toBe(true);
  });
});

describe('shift report model — server cash summary rows', () => {
  const summary = (over: Partial<CashSummary> = {}): CashSummary => ({
    state: 'frozen', basis: 'declared_collection',
    components: { opening_float_minor: 20_000, official_cash_receipts: { available: false, amount_minor: null, count: 0, reason: 'not_declared' }, cash_in_minor: 500, cash_out_minor: 10_000, treasury_handover_minor: 10_000, expenses_minor: 300 },
    expected_cash_minor: 25_000, expected_cash_partial_minor: 25_000, expected_complete: true, incompleteness: [],
    counted_cash_minor: 25_000, variance_minor: 0, variance_final: true,
    network_receipts: { available: false, amount_minor: null, reason: 'basis_not_enabled', information_only: true },
    unattributed_cash_receipts: { count: 0, amount_minor: 0 },
    post_close_adjustments: { available: true, items: [], net_effect_minor: 0 },
    ...over,
  } as CashSummary);

  it.each([['en'], ['ar']] as const)('every row of a real cash_summary has a translated label (no raw key path) in %s, A4 and A5', (locale) => {
    for (const paper of ['a4', 'a5'] as const) {
      // المترجم يرمي عند أي مفتاح ناقص، فنجاح البناء = كل الصفوف لها تسمية.
      const model = buildShiftReport(base({ t: translator(locale), paper, detail: closedDetail({ cash_summary: summary() }) }));
      const labels = kv(model, 'cash').rows.map((row) => row.label);
      expect(labels.some((label) => label.includes('doc.cash'))).toBe(false);
      expect(labels).toContain(translator(locale)('doc.cash.openingFloat'));
    }
  });

  it('the opening-float row prints the server amount', () => {
    const model = buildShiftReport(base({ detail: closedDetail({ cash_summary: summary() }) }));
    const cash = Object.fromEntries(kv(model, 'cash').rows.map((row) => [row.label, row.value.text]));
    expect(cash['Opening float']).toBe('200.00 SAR');
  });
});

describe('shift report model — A5 brief and language', () => {
  it('A5 is brief: no pump/nozzle readings table, fewer identity rows, a note that the table was shortened', () => {
    const model = buildShiftReport(base({ paper: 'a5' }));
    expect(model.variant).toBe('brief');
    expect(section(model, 'readings')).toBeUndefined();
    expect(section(model, 'table-cut')).toBeDefined();
    expect(kv(model, 'shift').title).toBeNull();
    expect(kv(model, 'shift').columns).toBe(4);
    expect(model.fileName).toMatch(/^shift-report-SH-100-a5-2026-11-03\.pdf$/);
    expect(buildShiftReport(base()).fileName).toMatch(/^shift-report-SH-100-a4-2026-11-03\.pdf$/);
  });

  it('(10) Arabic and English both build with every label translated and Latin digits only for numbers', () => {
    for (const paper of ['a4', 'a5'] as const) {
      for (const locale of ['ar', 'en'] as const) {
        const model = buildShiftReport(base({ t: translator(locale), paper }));
        const text = everyText(model);
        expect(text).not.toMatch(/[٠-٩۰-۹]/); // أرقام 0–9 دائماً
        expect(model.title.length).toBeGreaterThan(3);
        expect(model.status.label.length).toBeGreaterThan(1);
        expect(text).toContain('790.500');
      }
    }
    expect(buildShiftReport(base({ t: translator('ar') })).title).toBe('تقرير إغلاق وتسليم الوردية');
  });

  it('an invalid station timezone falls back safely instead of throwing', () => {
    expect(() => buildShiftReport(base({ station: { ...STATION, timezone: 'Not/AZone' } }))).not.toThrow();
  });
});
