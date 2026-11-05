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
  /** فوهات متبقية لخطوات القراءات؛ `null` حين لا مقام معروف. */
  remaining: number | null;
}

const PERMISSION: Record<Exclude<NextStepKind, 'complete'>, string> = {
  open_shift: 'fuel.shift.open',
  opening_readings: 'fuel.shift.open',
  closing_readings: 'fuel.shift.open',
  close_shift: 'fuel.shift.close',
  approve_shift: 'fuel.shift.approve',
};

/** `detail = null` ⇒ لا وردية مفتوحة. لمن لا صلاحية له ولا شيء ينتظره يعيد `null` (لا بطاقة فارغة). */
export function deriveNextStep(detail: ShiftDetail | null, summary: ReadingsSummary | null, can: (permission: string) => boolean): NextStep | null {
  if (detail === null) {
    return can(PERMISSION.open_shift) ? { kind: 'open_shift', mine: true, remaining: null } : null;
  }
  if (detail.status === 'approved') return { kind: 'complete', mine: false, remaining: null };
  if (detail.status === 'closed') return { kind: 'approve_shift', mine: can(PERMISSION.approve_shift), remaining: null };
  if (detail.status !== 'open' || summary === null) return null;

  const current = deriveProgress(detail, summary).find((step) => step.state === 'current');
  const total = summary.expected;
  switch (current?.key) {
    case 'opening_readings':
      return { kind: 'opening_readings', mine: can(PERMISSION.opening_readings), remaining: total === null || total === 0 ? null : Math.max(0, total - summary.withOpening) };
    case 'closing_readings':
      return { kind: 'closing_readings', mine: can(PERMISSION.closing_readings), remaining: total === null || total === 0 ? null : Math.max(0, total - summary.withClosing) };
    case 'closed':
      return { kind: 'close_shift', mine: can(PERMISSION.close_shift), remaining: null };
    default:
      return null;
  }
}
