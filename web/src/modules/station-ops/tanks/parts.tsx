'use client';

import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Badge, type Tone } from '../admin/ui';
import { formatLitersFixedFromMl, formatStampInZone } from '../format';
import { ageParts, percentText } from './logic';
import type { AnyFailure } from '../receiving/parts';
import type { ActionFailure } from './actions-client';
import type { Freshness, LevelFlag, LatestReading, TankLevel } from './schemas';

/** FUEL-B6 — عناصر عرض مشتركة. الأرقام 0–9 دائماً، والحالة نصٌّ + شكل لا لوناً وحده. */

export const TANKS_BASE = '/fuel-stations/ops/tanks';

export function tankHref(id: string): string {
  return `${TANKS_BASE}/${id}`;
}

export function Liters({ ml }: { ml: number | null | undefined }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  if (ml === null || ml === undefined) return <span className="text-muted">—</span>;
  return <span><span className="num" dir="ltr">{formatLitersFixedFromMl(ml, locale)}</span> {t('tanks.card.unit')}</span>;
}

export function AgeText({ seconds }: { seconds: number | null }) {
  const t = useTranslations('stationOps');
  const parts = ageParts(seconds);
  if (parts === null) return <span className="text-muted">—</span>;
  if (parts.unit === 'minutes' && parts.value === 0) return <span>{t('tanks.card.ageNow')}</span>;
  const key = parts.unit === 'minutes' ? 'ageMinutes' : parts.unit === 'hours' ? 'ageHours' : 'ageDays';
  return <span className="num">{t(`tanks.card.${key}`, { value: String(parts.value) })}</span>;
}

export function FlagBadge({ flag }: { flag: LevelFlag }) {
  const t = useTranslations('stationOps');
  const tone: Tone = flag === 'above_capacity' ? 'negative' : 'warning';
  return <Badge tone={tone}>{t(`tanks.flag.${flag}`)}</Badge>;
}

export function FreshnessBadge({ freshness }: { freshness: Freshness }) {
  const t = useTranslations('stationOps');
  // `unrated` = لا إعداد معتمد لقِدم القراءة ⇒ لا حكم ولا شارة (يُعرض العمر فقط).
  if (freshness === 'unrated') return null;
  return <Badge tone={freshness === 'fresh' ? 'positive' : freshness === 'stale' ? 'warning' : 'neutral'}>{t(`tanks.freshness.${freshness}`)}</Badge>;
}

export function TypeText({ type }: { type: string }) {
  const t = useTranslations('stationOps');
  return <>{type === 'physical' || type === 'atg' ? t(`tanks.type.${type}`) : type}</>;
}

/** شريط الامتلاء: النسبة نصاً بجانبه (لا لوناً وحده) ويحمل اسماً وصفياً لقارئ الشاشة. */
export function FillBar({ basisPoints, review }: { basisPoints: number | null; review: boolean }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const percent = percentText(basisPoints, locale);
  const width = basisPoints === null ? 0 : Math.min(Math.max(basisPoints / 100, 0), 100);
  return (
    <div className="flex items-center gap-3">
      <div
        role="img"
        aria-label={`${t('tanks.card.fill')}: ${percent}%`}
        className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-primary-soft"
      >
        <div className={cn('h-full rounded-full', review ? 'bg-warning' : 'bg-primary')} style={{ width: `${width}%` }} />
      </div>
      <span className="num w-14 shrink-0 text-end text-lg font-bold text-text" dir="ltr" data-fill-percent="">{percent}{basisPoints === null ? '' : '%'}</span>
    </div>
  );
}

export function LatestLine({ reading, timeZone }: { reading: LatestReading; timeZone: string | null | undefined }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  return (
    <span className="block text-sm leading-6 text-muted">
      <TypeText type={reading.reading_type} /> · <span className="num">{formatStampInZone(reading.measured_at, locale, timeZone)}</span>
      {reading.recorder?.name ? <> · {t('tanks.history.by', { name: reading.recorder.name })}</> : null}
    </span>
  );
}

/** ملخص مستوى الخزان (يُستعمل في بطاقة القائمة وأعلى التفاصيل). */
export function LevelSummary({ row, timeZone }: { row: TankLevel; timeZone: string | null | undefined }) {
  const t = useTranslations('stationOps');
  const { level, latest, tank } = row;
  return (
    <div className="space-y-2.5">
      {latest ? (
        <>
          <FillBar basisPoints={level.fill_basis_points} review={level.needs_review} />
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-text">
            <span className="text-muted">{t('tanks.card.last')}:</span>
            <strong className="num text-base" dir="ltr"><Liters ml={latest.quantity_milliliters} /></strong>
            <span className="text-muted">·</span>
            <AgeText seconds={level.age_seconds} />
          </p>
          <LatestLine reading={latest} timeZone={timeZone} />
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <span>{t('tanks.card.capacity')}: <Liters ml={tank.capacity_milliliters} /></span>
            <span>{t('tanks.card.available')}: <Liters ml={level.available_milliliters} /></span>
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">{t('tanks.card.none')} · {t('tanks.card.capacity')}: <Liters ml={tank.capacity_milliliters} /></p>
      )}
      {level.flags.length > 0 || level.needs_review ? (
        <div className="flex flex-wrap gap-1.5" data-flags="">
          <Badge tone="warning">{t('tanks.needsReview')}</Badge>
          {level.flags.map((flag) => <FlagBadge key={flag} flag={flag} />)}
        </div>
      ) : null}
    </div>
  );
}

/** `ActionFailure` ⇒ شكل `FailureNotice` المشترك (الرسائل نفسها للرفض/غير المؤكد/لم يُرسل). */
export function asFailure(failure: ActionFailure): AnyFailure {
  if (failure.kind === 'rejected') return { kind: 'rejected', status: failure.status, code: failure.code, serverMessage: failure.serverMessage };
  return failure;
}
