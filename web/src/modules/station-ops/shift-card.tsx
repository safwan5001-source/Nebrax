'use client';

import { useLocale, useTranslations } from 'next-intl';
import { CircleCheck, CircleDot, Lock } from 'lucide-react';
import { formatDateTime } from '@/lib/formatting';
import { formatLitersNumberFromText } from './format';
import { Quantity } from './quantity';
import type { Shift } from './schemas';

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-primary-soft text-primary',
  closed: 'bg-warning/15 text-warning',
  approved: 'bg-positive/15 text-positive',
};

/** الحالات الفعلية في أَوْج: مفتوحة ← مغلقة ← معتمدة. حالة مجهولة تُعرض كما وردت دون اختلاق ترجمة. */
export function ShiftStatusBadge({ status }: { status: string }) {
  const t = useTranslations('stationOps');
  const known = status === 'open' || status === 'closed' || status === 'approved';
  const Icon = status === 'approved' ? CircleCheck : status === 'closed' ? Lock : CircleDot;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${STATUS_STYLE[status] ?? 'border border-border text-muted'}`}>
      <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
      {known ? t(`shiftStatus.${status}`) : status}
    </span>
  );
}

export function ShiftCard({ shift }: { shift: Shift }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  return (
    <article className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="num text-base font-semibold text-text">{shift.number}</p>
          <p className="mt-0.5 text-sm text-muted">
            {t('shift.openedAt')}: <span className="tabular-nums">{formatDateTime(shift.opened_at, locale)}</span>
          </p>
        </div>
        <ShiftStatusBadge status={shift.status} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted">{t('shift.operationalLiters')}</dt>
          <dd className="mt-0.5 text-base font-semibold text-text"><Quantity value={formatLitersNumberFromText(shift.operational_liters, locale)} unit={t('unit.liter')} /></dd>
        </div>
        {shift.closed_at ? (
          <div>
            <dt className="text-muted">{t('shift.closedAt')}</dt>
            <dd className="mt-0.5 tabular-nums text-text">{formatDateTime(shift.closed_at, locale)}</dd>
          </div>
        ) : null}
        {shift.approved_at ? (
          <div>
            <dt className="text-muted">{t('shift.approvedAt')}</dt>
            <dd className="mt-0.5 tabular-nums text-text">{formatDateTime(shift.approved_at, locale)}</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}
