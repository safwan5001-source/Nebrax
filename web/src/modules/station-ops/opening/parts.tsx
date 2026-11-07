'use client';

import { useLocale, useTranslations } from 'next-intl';
import { CircleAlert, RefreshCw, TriangleAlert, WifiOff } from 'lucide-react';
import { formatMinorRiyal } from '@/lib/money';
import { formatLitersFixedFromMl } from '../format';
import type { OpeningBlocker } from './schemas';
import type { WriteFailure } from './opening-client';

/** عناصر عرض مشتركة للمعالج. الأرقام 0–9 دائماً (منسّقات أَوْج المركزية) والاتجاه لا يُقلب بالألوان وحدها. */

export const OPENING_BASE = '/fuel-stations/ops/opening-balance';

export function Liters({ ml }: { ml: number | null | undefined }) {
  const t = useTranslations('stationOpsOpening');
  const locale = useLocale();
  if (ml === null || ml === undefined) return <span className="text-muted">—</span>;
  return <span><span className="num" dir="ltr">{formatLitersFixedFromMl(ml, locale)}</span> {t('tanks.unit')}</span>;
}

export function Money({ minor }: { minor: number | null | undefined }) {
  if (minor === null || minor === undefined) return <span className="text-muted">—</span>;
  return <span className="num" dir="ltr">{formatMinorRiyal(minor)}</span>;
}

export type AnyFailure = WriteFailure | { kind: 'client'; messageKey: string };

/** ما يفيد فيه «تحقق من الحالة»: كل ما قد يكون حدث فعلاً. لا إعادة إرسال أعمى. */
export function canCheck(failure: AnyFailure): boolean {
  return failure.kind === 'unknown' || failure.kind === 'unverified' || (failure.kind === 'rejected' && (failure.code === 'conflict' || failure.code === 'idempotency_conflict'));
}

function failureKey(failure: AnyFailure): string {
  switch (failure.kind) {
    case 'rejected': return `fail.${failure.code}`;
    case 'unknown': return `fail.unknown_${failure.reason}`;
    case 'not_sent': return `fail.not_sent_${failure.reason}`;
    case 'unverified': return 'fail.unverified';
    default: return failure.messageKey;
  }
}

const KNOWN_BLOCKERS = new Set([
  'FUEL_OPENING_ACCOUNT_REQUIRED', 'FUEL_OPENING_INVENTORY_ACCOUNT_INVALID', 'FUEL_OPENING_POOL_NOT_EMPTY', 'FUEL_OPENING_POOL_HAS_HISTORY', 'FUEL_OPENING_COST_MISSING',
  'FUEL_OPENING_ZERO_COST_NOT_ALLOWED', 'FUEL_OPENING_EXCEEDS_CAPACITY', 'FUEL_OPENING_TANK_INACTIVE', 'FUEL_OPENING_TANK_INVALID', 'FUEL_OPENING_TANK_PRODUCT_CHANGED',
  'FUEL_OPENING_PRODUCT_UNAVAILABLE', 'FUEL_OPENING_PRODUCT_UNIT_INVALID', 'FUEL_OPENING_VALUE_INVALID', 'FUEL_OPENING_STATION_UNAVAILABLE', 'FUEL_OPENING_STATION_CHANGED',
  'FUEL_OPENING_WAREHOUSE_UNAVAILABLE', 'FUEL_OPENING_NO_LINES', 'FUEL_OPENING_ABOVE_SAFE_CAPACITY',
]);

/** الرمز المعروف يُعرض بنص الواجهة المترجم؛ غير المعروف بنص الخادم كما هو (لا يُخفى ولا يُخترع). */
export function BlockerList({ items, tone }: { items: OpeningBlocker[]; tone: 'negative' | 'warning' }) {
  const t = useTranslations('stationOpsOpening');
  if (items.length === 0) return null;
  const cls = tone === 'negative' ? 'bg-[color:var(--fo-negative-tint)] text-negative' : 'bg-[color:var(--fo-warning-tint)] text-warning';
  return (
    <ul role={tone === 'negative' ? 'alert' : undefined} data-blockers={tone} className={`space-y-1.5 rounded-[12px] p-3 text-sm leading-6 ${cls}`}>
      {items.map((item, index) => (
        <li key={`${item.code}-${item.tank_id ?? item.fuel_product_id ?? index}`} className="flex items-start gap-2">
          <TriangleAlert aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" strokeWidth={1.9} />
          <span>{KNOWN_BLOCKERS.has(item.code) ? t(`blocker.${item.code}`) : (item.message ?? item.code)}</span>
        </li>
      ))}
    </ul>
  );
}

export function FailureNotice({ failure, onCheck, checking = false }: { failure: AnyFailure; onCheck?: () => void; checking?: boolean }) {
  const t = useTranslations('stationOpsOpening');
  const warn = failure.kind === 'unknown' || failure.kind === 'unverified' || failure.kind === 'not_sent';
  const Icon = failure.kind === 'not_sent' ? WifiOff : warn ? TriangleAlert : CircleAlert;
  const tone = warn ? 'bg-[color:var(--fo-warning-tint)] text-warning' : 'bg-[color:var(--fo-negative-tint)] text-negative';
  const serverMessage = failure.kind === 'rejected' && failure.code === 'validation' ? failure.serverMessage : null;
  return (
    <div role="alert" data-failure={failure.kind} className={`flex items-start gap-3 rounded-[14px] border border-border p-3.5 text-sm leading-6 ${tone}`}>
      <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.9} />
      <div className="min-w-0 flex-1">
        <p>{t(failureKey(failure))}</p>
        {serverMessage ? <p className="mt-1 break-words text-xs opacity-90">{t('fail.serverSays', { message: serverMessage })}</p> : null}
        {failure.kind === 'rejected' && failure.blockers.length > 0 ? <div className="mt-2"><BlockerList items={failure.blockers} tone={failure.code === 'blocked' ? 'negative' : 'warning'} /></div> : null}
        {canCheck(failure) && onCheck ? (
          <button type="button" onClick={onCheck} disabled={checking} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg border border-current bg-surface px-3 text-sm font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60">
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} strokeWidth={1.8} />
            {checking ? t('fail.checking') : t('fail.check')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
