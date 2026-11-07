import { z } from 'zod';

/**
 * #2021 — ملخص النقد المتوقع/المعدود/الفرق للوردية (D1/D2/D5).
 *
 * الخادم **مصدر الحقيقة الوحيد** (`cash_summary` في `GET /fuel-stations/shifts/{id}` من `FuelShiftCashExpectationService`):
 * هذه الطبقة لا تحسب نقداً متوقعاً ولا فرقاً ولا تجمع مبيعات — تعرض ما يرسله الخادم وتحدّد فقط **كيف يُعنوَن**:
 *  - المتوقع إجمالي فقط إن اكتملت مكوّناته (`expected_complete`)، وإلا «غير مكتمل» بالرقم الجزئي مُعنوَناً.
 *  - الفرق «زيادة/عجز/مطابق» فقط حين `variance_final`؛ وإلا «فرق غير نهائي — يراجعه المشرف» بلا اتجاه.
 *  - مكوّن غير متاح = «غير متاح» بسببه، لا صفر ولا رقم مخترع. الشبكة للعلم ولا تدخل النقد.
 */
const int = z.number().int();
const reason = z.string().nullable();

const available = z.object({ available: z.boolean(), amount_minor: int.nullable(), reason });

export const cashSummarySchema = z.object({
  state: z.enum(['live', 'frozen', 'legacy_frozen']),
  basis: z.enum(['movements_only', 'receiving_shift_receipts', 'declared_collection']),
  components: z.object({
    opening_float_minor: int,
    official_cash_receipts: available.extend({ count: int.nullable() }),
    /** النقد المُقَرّ به في إقرار التحصيل (P1-2). غيابه = خادم أقدم ⇒ أساس الحركات/الإيصالات. */
    declared_cash: available.optional(),
    cash_in_minor: int,
    cash_out_minor: int,
    treasury_handover_minor: int,
    expenses_minor: int,
  }),
  expected_cash_minor: int.nullable(),
  expected_cash_partial_minor: int,
  expected_complete: z.boolean(),
  incompleteness: z.array(z.string()),
  counted_cash_minor: int.nullable(),
  variance_minor: int.nullable(),
  variance_final: z.boolean(),
  network_receipts: available.extend({ information_only: z.boolean() }),
  unattributed_cash_receipts: z.object({ count: int, amount_minor: int }).nullable(),
  post_close_adjustments: z.object({
    available: z.boolean(),
    items: z.array(z.object({ payment_id: z.string().nullable(), amount_minor: int, occurred_at: z.string().nullable() })),
    net_effect_minor: int.nullable(),
  }),
});

export type CashSummary = z.infer<typeof cashSummarySchema>;

export type CashRowKey = 'opening' | 'sales' | 'declaredSales' | 'cashIn' | 'handover' | 'otherOut' | 'expenses';
export type UnavailableReason = 'permission' | 'basis_not_enabled' | 'not_recorded_legacy' | 'not_declared' | 'unknown';

export interface CashRowView {
  key: CashRowKey;
  /** +1 يضيف للمتوقع، −1 يخصم منه (للعرض فقط). */
  sign: 1 | -1;
  /** `null` ⇒ غير متاح (لا يُعرض صفراً). */
  amountMinor: number | null;
  unavailable: UnavailableReason | null;
}

export type VarianceView =
  | { kind: 'final'; direction: 'overage' | 'shortage' | 'none'; amountMinor: number }
  | { kind: 'provisional'; amountMinor: number };

export interface CashSummaryView {
  frozen: boolean;
  rows: CashRowView[];
  expected: { kind: 'total' | 'partial'; amountMinor: number };
  countedMinor: number | null;
  variance: VarianceView | null;
  /** معدود موجود لكن الفرق محجوب عن العارض (لا صلاحية مبيعات) ⇒ «غير متاح» لا «لم يُعدّ». */
  varianceHidden: boolean;
  network: { amountMinor: number | null; unavailable: UnavailableReason | null };
  gaps: string[];
  unattributed: { count: number; amountMinor: number } | null;
  adjustments: { count: number; netEffectMinor: number } | null;
}

function normalizeReason(value: string | null): UnavailableReason {
  return value === 'permission' || value === 'basis_not_enabled' || value === 'not_recorded_legacy' || value === 'not_declared' ? value : 'unknown';
}

/** يحوّل ما يرسله الخادم إلى عرض صادق. دالة نقية: لا حسابات مالية جديدة (الطرح الوحيد: الصادر الآخر = الصادر − التسليم للعرض). */
export function buildCashSummaryView(summary: CashSummary): CashSummaryView {
  const c = summary.components;
  // الأساس المُقَرّ به: مصدر نقد المبيعات الوحيد هو الإقرار (لا يُجمع مع الإيصالات)، فيُعنوَن صفّه «مُقَرّ به» لا «محصّل».
  const declaredBasis = summary.basis === 'declared_collection' && c.declared_cash !== undefined;
  const sales = declaredBasis && c.declared_cash ? c.declared_cash : c.official_cash_receipts;
  const otherOut = Math.max(0, c.cash_out_minor - c.treasury_handover_minor);

  const rows: CashRowView[] = [
    { key: 'opening', sign: 1, amountMinor: c.opening_float_minor, unavailable: null },
    { key: declaredBasis ? 'declaredSales' : 'sales', sign: 1, amountMinor: sales.available ? sales.amount_minor : null, unavailable: sales.available ? null : normalizeReason(sales.reason) },
    { key: 'cashIn', sign: 1, amountMinor: c.cash_in_minor, unavailable: null },
    { key: 'handover', sign: -1, amountMinor: c.treasury_handover_minor, unavailable: null },
    { key: 'otherOut', sign: -1, amountMinor: otherOut, unavailable: null },
    { key: 'expenses', sign: -1, amountMinor: c.expenses_minor, unavailable: null },
  ];

  const expected = summary.expected_complete && summary.expected_cash_minor !== null
    ? { kind: 'total' as const, amountMinor: summary.expected_cash_minor }
    : { kind: 'partial' as const, amountMinor: summary.expected_cash_partial_minor };

  let variance: VarianceView | null = null;
  if (summary.variance_minor !== null && summary.counted_cash_minor !== null) {
    variance = summary.variance_final
      ? { kind: 'final', direction: summary.variance_minor === 0 ? 'none' : summary.variance_minor > 0 ? 'overage' : 'shortage', amountMinor: Math.abs(summary.variance_minor) }
      : { kind: 'provisional', amountMinor: Math.abs(summary.variance_minor) };
  }

  const net = summary.network_receipts;
  const adjustments = summary.post_close_adjustments;

  return {
    frozen: summary.state !== 'live',
    rows,
    expected,
    countedMinor: summary.counted_cash_minor,
    variance,
    varianceHidden: summary.counted_cash_minor !== null && summary.variance_minor === null,
    network: { amountMinor: net.available ? net.amount_minor : null, unavailable: net.available ? null : normalizeReason(net.reason) },
    gaps: summary.incompleteness,
    unattributed: summary.unattributed_cash_receipts && summary.unattributed_cash_receipts.count > 0
      ? { count: summary.unattributed_cash_receipts.count, amountMinor: summary.unattributed_cash_receipts.amount_minor }
      : null,
    adjustments: adjustments.available && adjustments.items.length > 0 && adjustments.net_effect_minor !== null
      ? { count: adjustments.items.length, netEffectMinor: adjustments.net_effect_minor }
      : null,
  };
}
