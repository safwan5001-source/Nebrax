'use client';

import { useLocale, useTranslations } from 'next-intl';
import { CircleAlert, RefreshCw, TriangleAlert, WifiOff } from 'lucide-react';
import { formatMinorRiyal } from '@/lib/money';
import { formatDateTime } from '@/lib/formatting';
import { formatLitersFixedFromMl } from '../format';
import type { WriteFailure } from './receiving-client';
import type { Delivery } from './schemas';
import { Badge } from '../admin/ui';

/** FUEL-B5 — عناصر عرض مشتركة. الأرقام 0–9 دائماً (منسّقات أَوْج المركزية)، والتكلفة لا تُعرض إلا إن وصلت من الخادم. */

export const RECEIVING_BASE = '/fuel-stations/ops/receiving';

export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('stationOps');
  const known = status === 'draft' || status === 'approved';
  return <Badge tone={status === 'approved' ? 'positive' : status === 'draft' ? 'warning' : 'neutral'}>{known ? t(`receiving.status.${status}`) : status}</Badge>;
}

/** فرق موقَّع بالمللتر ⇒ نص بالاتجاه (زيادة/نقص/لا فرق) والكمية باللتر؛ الاتجاه نصٌّ لا لوناً وحده. */
export function VarianceText({ ml }: { ml: number | null }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  if (ml === null) return <span className="text-muted">—</span>;
  if (ml === 0) return <span>{t('receiving.variance.none')}</span>;
  const label = ml > 0 ? t('receiving.variance.over') : t('receiving.variance.short');
  return <span className={ml > 0 ? 'text-warning' : 'text-negative'}>{label} <span className="num" dir="ltr">{formatLitersFixedFromMl(Math.abs(ml), locale)}</span> {t('receiving.unit')}</span>;
}

export function Liters({ ml }: { ml: number | null | undefined }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  if (ml === null || ml === undefined) return <span className="text-muted">—</span>;
  return <span><span className="num" dir="ltr">{formatLitersFixedFromMl(ml, locale)}</span> {t('receiving.unit')}</span>;
}

export function Cost({ minor }: { minor: number | undefined }) {
  if (minor === undefined) return null;
  return <span className="num" dir="ltr">{formatMinorRiyal(minor)}</span>;
}

export function when(value: string | null | undefined, locale: string): string {
  return value ? formatDateTime(value, locale) : '—';
}

export function deliveryTitle(row: Pick<Delivery, 'delivery_note_number' | 'id'>, fallback: string): string {
  return row.delivery_note_number && row.delivery_note_number.trim() !== '' ? row.delivery_note_number : fallback;
}

// ───────────────────────── إشعار نتيجة الكتابة ─────────────────────────

export type AnyFailure = WriteFailure | { kind: 'reading_conflict' };

/** ما يفيد فيه «تحقق من الحالة»: كل ما قد يكون حدث فعلاً أو تغيّر عنده الوضع (لا إعادة إرسال أعمى). */
export function canCheck(failure: AnyFailure): boolean {
  if (failure.kind === 'unknown' || failure.kind === 'unverified') return true;
  if (failure.kind === 'rejected') return ['already_approved', 'conflict', 'idempotency_mismatch', 'duplicate'].includes(failure.code);
  return false;
}

export function FailureNotice({ failure, onCheck, checking = false }: { failure: AnyFailure; onCheck?: () => void; checking?: boolean }) {
  const t = useTranslations('stationOps');
  const warn = failure.kind === 'unknown' || failure.kind === 'unverified' || failure.kind === 'not_sent';
  const Icon = failure.kind === 'not_sent' ? WifiOff : warn ? TriangleAlert : CircleAlert;
  const key =
    failure.kind === 'rejected' ? `receiving.fail.${failure.code}`
      : failure.kind === 'unknown' ? `receiving.fail.unknown_${failure.reason}`
        : failure.kind === 'not_sent' ? `receiving.fail.not_sent_${failure.reason}`
          : failure.kind === 'unverified' ? 'receiving.fail.unverified'
            : 'receiving.fail.reading_conflict';
  const serverMessage = failure.kind === 'rejected' && failure.code === 'validation' ? failure.serverMessage : null;
  const tone = warn ? 'bg-[color:var(--fo-warning-tint)] text-warning' : 'bg-[color:var(--fo-negative-tint)] text-negative';
  return (
    <div role="alert" data-failure={failure.kind} className={`flex items-start gap-3 rounded-[14px] border border-border p-3.5 text-sm leading-6 ${tone}`}>
      <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.9} />
      <div className="min-w-0 flex-1">
        <p>{t(key)}</p>
        {serverMessage ? <p className="mt-1 break-words text-xs opacity-90">{t('receiving.fail.serverSays', { message: serverMessage })}</p> : null}
        {canCheck(failure) && onCheck ? (
          <button type="button" onClick={onCheck} disabled={checking} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg border border-current bg-surface px-3 text-sm font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60">
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} strokeWidth={1.8} />
            {checking ? t('receiving.fail.checking') : t('receiving.fail.check')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
