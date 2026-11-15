'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { formatMinorRiyal } from '@/lib/money';
import { blockerKey, isHidden, isKnownReason, shortId, type AttemptSummary, type InventoryStatus, type Readiness } from './logic';

type Translate = ReturnType<typeof useTranslations>;

/** نص سبب الرفض/الفشل: المعروف مترجم، وغير المعروف يُعرض برمزه الخام (لا يُخفى ولا يُخمَّن). */
export function reasonLabel(t: Translate, code: string): string {
  return isKnownReason(code) ? t(`reason.${code}`) : t('reason.unknown', { code });
}

/** نص المانع: المعروف مترجم، وغير المعروف برمزه الخام. */
export function blockerLabel(t: Translate, code: string): string {
  const key = blockerKey(code);
  return key !== null ? t(`blocker.${key}`) : t('blocker.unknown', { code });
}

const INVENTORY_TONE: Record<InventoryStatus, 'warning' | 'positive' | 'muted'> = { pending_integration: 'warning', posted: 'positive', reversed: 'muted' };

/** حالة السند مخزنياً — منفصلة بصرياً ودلالياً عن نتيجة آخر محاولة (`AttemptChip`). */
export function InventoryStatusBadge({ status }: { status: InventoryStatus }) {
  const t = useTranslations('fuelTankerFills');
  return <Badge tone={INVENTORY_TONE[status]} data-inventory-status={status}>{t(`inventoryStatus.${status}`)}</Badge>;
}

export function VoidedBadge() {
  const t = useTranslations('fuelTankerFills');
  return <Badge tone="negative" data-voided="">{t('voided')}</Badge>;
}

const READINESS_TONE: Record<Readiness, 'positive' | 'warning' | 'negative' | 'muted'> = { ready: 'positive', needs_review: 'warning', blocked: 'negative', not_applicable: 'muted' };

export function ReadinessBadge({ value }: { value: Readiness }) {
  const t = useTranslations('fuelTankerFills');
  return <Badge tone={READINESS_TONE[value]} data-readiness={value}>{t(`readiness.${value}`)}</Badge>;
}

const OUTCOME_TONE = { succeeded: 'positive', rejected: 'warning', failed: 'negative' } as const;

/**
 * «آخر محاولة»: العملية ونتيجتها وسببها — **منفصلة عن حالة السند**: سند بانتظار الترحيل قد تكون آخر محاولة له مرفوضة، وهذا لا يغيّر حالته.
 * الشارة بإطار (لا تعبئة) كي لا تُقرأ كحالة للسند.
 */
export function AttemptChip({ attempt }: { attempt: AttemptSummary | null }) {
  const t = useTranslations('fuelTankerFills');
  if (attempt === null) return null;
  const tone = OUTCOME_TONE[attempt.outcome];
  const colour = tone === 'positive' ? 'border-positive/40 text-positive' : tone === 'warning' ? 'border-warning/50 text-warning' : 'border-negative/50 text-negative';
  return (
    <span
      data-attempt-chip=""
      data-outcome={attempt.outcome}
      data-operation={attempt.operation}
      className={`inline-flex max-w-full flex-wrap items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium ${colour}`}
    >
      <span className="text-muted">{t('attempt.label')}:</span>
      <span>{t(`operation.${attempt.operation}`)}</span>
      <span aria-hidden="true">·</span>
      <span>{t(`attempt.outcome.${attempt.outcome}`)}</span>
      {attempt.reason_code ? <span className="break-words text-muted" data-attempt-reason="">({reasonLabel(t, attempt.reason_code)})</span> : null}
    </span>
  );
}

export function BlockerBadges({ codes, label }: { codes: string[]; label?: string }) {
  const t = useTranslations('fuelTankerFills');
  if (codes.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={label ?? t('blockers')} data-blockers="">
      {codes.map((code) => <li key={code}><Badge tone="negative" wrap>{blockerLabel(t, code)}</Badge></li>)}
    </ul>
  );
}

/** قيمة حسّاسة محجوبة عن المستخدم (لا تُعرض صفراً ولا تُخمَّن). */
export function HiddenValue() {
  const t = useTranslations('fuelTankerFills');
  return <span className="text-muted" data-hidden="" title={t('hiddenHint')}>{t('hidden')}</span>;
}

/** مبلغ بالهللات ⇒ ريال للعرض فقط؛ غياب القيمة (`null`/`undefined`) ⇒ «مخفي». */
export function MinorAmount({ minor }: { minor: number | null | undefined }) {
  if (isHidden(minor)) return <HiddenValue />;
  return <span className="num" dir="ltr" data-amount="">{formatMinorRiyal(minor as number)}</span>;
}

/** معرّف تقني (حساب/حركة) بصيغة LTR مختصرة؛ الغياب ⇒ «مخفي». */
export function TechnicalId({ value }: { value: string | null | undefined }) {
  if (isHidden(value)) return <HiddenValue />;
  return <bdi className="num text-xs" dir="ltr" title={value as string}>{shortId(value as string)}</bdi>;
}
