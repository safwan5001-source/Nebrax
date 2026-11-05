import type { ReadingsExtra } from './entry';
import { OPS_BASE } from './nav';
import { deriveProgress, type ReadingsSummary } from './readings';
import type { ShiftDetail } from './schemas';

/**
 * UI-1 (قرار المنتج 2026-11-05: APP-ONLY / SIMPLE UX) — «الخطوة التالية» بلغة الموظف، دوال نقية.
 *
 * تُشتق من حالة الوردية الفعلية في الخادم (open ← closed ← approved) وتقدّم قراءاتها فقط. هذه الشريحة **قراءة فقط**: الخطوة
 * التي يملك المستخدم صلاحيتها تُعرض «قريباً داخل التطبيق» (نص غير تفاعلي)، ولا يُنشأ لها زر ولا رابط إلى ERP. من لا يملك صلاحيتها
 * يرى «بانتظار …» فقط. لا تُخترع خطوة غير مدعومة خادمياً (لا «إرجاع»/«تسليم مرسَل»).
 */
export type NextStepKind = 'open_shift' | 'opening_readings' | 'closing_readings' | 'close_shift' | 'approve_shift' | 'complete';

export interface NextStep {
  kind: NextStepKind;
  /** المستخدم الحالي هو من تُسند إليه الخطوة (يملك صلاحيتها). */
  mine: boolean;
  /** قراءات متبقية (فوهات + خزانات مطلوبة) لخطوات القراءات؛ `null` حين لا مقام معروف. */
  remaining: number | null;
  /** UI-2: وجهة الإجراء **داخل التطبيق** للخطوة التي تُنفَّذ فعلاً (فتح/قراءات/تسليم)؛ `null` = لا إجراء (اعتماد المشرف، الاكتمال). */
  href: string | null;
}

const PERMISSION: Record<Exclude<NextStepKind, 'complete'>, string> = {
  open_shift: 'fuel.shift.open',
  opening_readings: 'fuel.shift.open',
  closing_readings: 'fuel.shift.open',
  close_shift: 'fuel.shift.close',
  approve_shift: 'fuel.shift.approve',
};

/** `detail = null` ⇒ لا وردية مفتوحة. لمن لا صلاحية له ولا شيء ينتظره يعيد `null` (لا بطاقة فارغة). */
export function deriveNextStep(
  detail: ShiftDetail | null,
  summary: ReadingsSummary | null,
  can: (permission: string) => boolean,
  extra?: ReadingsExtra | null,
): NextStep | null {
  if (detail === null) {
    return can(PERMISSION.open_shift) ? { kind: 'open_shift', mine: true, remaining: null, href: `${OPS_BASE}/shifts/open` } : null;
  }
  if (detail.status === 'approved') return { kind: 'complete', mine: false, remaining: null, href: null };
  if (detail.status === 'closed') return { kind: 'approve_shift', mine: can(PERMISSION.approve_shift), remaining: null, href: null };
  if (detail.status !== 'open' || summary === null) return null;

  const base = `${OPS_BASE}/shifts/${encodeURIComponent(detail.id)}`;
  const current = deriveProgress(detail, summary, extra).find((step) => step.state === 'current');
  const total = summary.expected;
  // مع `extra` (UI-2) تُحسب المتبقيات من العدادات والخزانات معاً؛ بدونه (UI-1) من الفوهات فقط كما كان.
  const left = (done: number, fromExtra: number | undefined) => (fromExtra !== undefined ? fromExtra : total === null || total === 0 ? null : Math.max(0, total - done));
  switch (current?.key) {
    case 'opening_readings':
      return { kind: 'opening_readings', mine: can(PERMISSION.opening_readings), remaining: left(summary.withOpening, extra?.openingRemaining), href: `${base}/readings/opening` };
    case 'closing_readings':
      return { kind: 'closing_readings', mine: can(PERMISSION.closing_readings), remaining: left(summary.withClosing, extra?.closingRemaining), href: `${base}/readings/closing` };
    case 'closed':
      return { kind: 'close_shift', mine: can(PERMISSION.close_shift) && can('fuel.shift.cash_count'), remaining: null, href: `${base}/handover` };
    default:
      return null;
  }
}
