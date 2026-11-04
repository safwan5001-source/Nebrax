'use client';

import type * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { ChevronRight, CircleCheck, CircleDot, Lock } from 'lucide-react';
import { formatDateTime } from '@/lib/formatting';
import { formatInZone, formatLitersNumberFromText } from './format';
import { OPS_BASE } from './nav';
import { Quantity } from './quantity';
import type { Shift } from './schemas';

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-[color:var(--fo-positive-tint)] text-positive',
  closed: 'bg-[color:var(--fo-warning-tint)] text-warning',
  approved: 'bg-[color:var(--fo-positive-tint)] text-positive',
};

/** الحالات الفعلية في أَوْج: مفتوحة ← مغلقة ← معتمدة. حالة مجهولة تُعرض كما وردت دون اختلاق ترجمة. */
export function ShiftStatusBadge({ status }: { status: string }) {
  const t = useTranslations('stationOps');
  const known = status === 'open' || status === 'closed' || status === 'approved';
  const Icon = status === 'approved' ? CircleCheck : status === 'closed' ? Lock : CircleDot;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[status] ?? 'border border-border text-muted'}`}>
      <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
      {known ? t(`shiftStatus.${status}`) : status}
    </span>
  );
}

export function ShiftCard({ shift, timeZone }: { shift: Shift; timeZone?: string | null }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  return (
    <article className="rounded-[14px] border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="num text-base font-semibold text-text">{shift.number}</p>
          <p className="mt-0.5 text-sm text-muted">
            {t('shift.openedAt')}: <span className="tabular-nums">{formatDateTime(shift.opened_at, locale, { timeZone: timeZone ?? undefined })}</span>
          </p>
        </div>
        <ShiftStatusBadge status={shift.status} />
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-muted">{t('shift.operationalLitersShort')}</dt>
          {/* الوردية المفتوحة: الخادم لا يحسب الإجمالي إلا عند الإغلاق (يبقى 0 حتى ذلك الحين) — ذلك ليس صفراً فعلياً، فلا نعرضه. */}
          {shift.status === 'open' ? (
            <dd className="text-end text-muted">{t('shiftDetail.list.notComputed')}</dd>
          ) : (
            <dd className="text-base font-semibold text-text"><Quantity value={formatLitersNumberFromText(shift.operational_liters, locale)} unit={t('unit.liter')} /></dd>
          )}
        </div>
        {shift.closed_at ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-muted">{t('shift.closedAt')}</dt>
            <dd className="tabular-nums text-text">{formatDateTime(shift.closed_at, locale, { timeZone: timeZone ?? undefined })}</dd>
          </div>
        ) : null}
        {shift.approved_at ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-muted">{t('shift.approvedAt')}</dt>
            <dd className="tabular-nums text-text">{formatDateTime(shift.approved_at, locale, { timeZone: timeZone ?? undefined })}</dd>
          </div>
        ) : null}
      </dl>
      <Link
        href={`${OPS_BASE}/shifts/${encodeURIComponent(shift.id)}`}
        className="-mx-1 mt-3 flex min-h-11 items-center justify-between gap-2 rounded-lg border-t border-border px-1 pt-3 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {t('shiftDetail.list.viewDetails')}
        <ChevronRight aria-hidden="true" className="h-4 w-4 rtl:rotate-180" strokeWidth={1.8} />
      </Link>
    </article>
  );
}

/** بطاقة «الفترة الحالية»: ترتفع فوق الحافة السفلية للـmasthead (مواصفة #1990 §1). الوقت بمنطقة المحطة. */
export function CurrentShiftBanner({ shift, timeZone, children }: { shift: Shift | null; timeZone?: string | null; children?: React.ReactNode }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  return (
    <section aria-labelledby="fo-shift-h" className="relative z-10 -mt-5">
      <div className="rounded-[17px] border border-border bg-surface p-4 [box-shadow:var(--fo-shadow)]">
        <div className="flex items-center justify-between gap-3">
          <h2 id="fo-shift-h" className="text-xs font-semibold text-muted">{t('home.currentShift')}</h2>
          {shift ? <ShiftStatusBadge status={shift.status} /> : null}
        </div>
        {shift ? (
          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="num text-[19px] font-bold leading-7 text-text">{shift.number}</p>
              <p className="text-xs text-muted">
                {t('shift.startedAt')} <span className="tabular-nums">{formatInZone(shift.opened_at, locale, timeZone, 'time')}</span>
              </p>
            </div>
            <p className="shrink-0 text-xs text-muted tabular-nums">{formatInZone(shift.opened_at, locale, timeZone, 'date')}</p>
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}

/** الرقم الرئيسي (28–32px) وخليّتان — الكمية منفصلة عن التحصيل، والغياب «—» لا صفراً. */
export function FinancialSummary({ caption, value, unit, note, cells }: { caption: string; value: string | null; unit?: string; note?: string; cells: Array<{ label: string; value: string }> }) {
  return (
    <div className="rounded-[17px] border border-border bg-surface p-5">
      <p className="text-xs text-muted">{caption}</p>
      <p className="mt-1 text-[32px] font-bold leading-10 tracking-tight text-text">
        <span className="num">{value ?? '—'}</span>
        {value !== null && unit ? <span className="ms-1.5 text-[15px] font-medium text-muted">{unit}</span> : null}
      </p>
      {note ? <p className="mt-1 text-xs leading-5 text-muted">{note}</p> : null}
      <div className="my-4 h-px bg-border" />
      <dl className="grid grid-cols-2 gap-4">
        {cells.map((cell, index) => (
          <div key={cell.label} className={index > 0 ? 'border-s border-border ps-4' : ''}>
            <dt className="text-[11px] text-muted">{cell.label}</dt>
            <dd className="num mt-0.5 text-xl font-bold text-text">{cell.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** بطاقة مؤشر صغيرة؛ `value = null` ⇒ «غير متاح» صريحة (لا صفر مخترع). */
export function MetricCard({ label, value, note, icon }: { label: string; value: string | null; note?: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-[14px] border border-border bg-surface p-3.5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted"><span>{label}</span>{icon}</div>
      <p className="num mt-2 text-xl font-bold text-text">{value ?? '—'}</p>
      {note ? <p className="mt-0.5 text-[11px] text-muted">{note}</p> : null}
    </div>
  );
}
