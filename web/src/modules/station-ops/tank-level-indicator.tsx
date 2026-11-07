'use client';

import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Gauge } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { displayLocale } from '@/lib/formatting';
import { formatLitersNumberFromMl, formatStampInZone } from './format';
import type { BookLevelUnavailableReason } from './tank-book-level';
import { evaluateTankLevel, type TankLevelBand, type TankLevelInput } from './tank-level';

/**
 * مؤشر منسوب الخزان — عرض فقط. موصول ببطاقات الخزانات في «المنتجات والمضخات» عبر عقد `book_level` (TANK-LEVEL-P2).
 *
 * يُغذّى بمدخل جاهز من عقد خادم معتمَد، ولا يجلب ولا يحسب رصيداً ولا يحدّث نفسه. لا حركة ولا انتقالات:
 * شريط ثابت لا يوحي بتغيّر القراءة (فيتجاوز تلقائياً `prefers-reduced-motion`). اللون لا يحمل المعنى وحده:
 * كل حالة تُكتب نصاً مع الرقم («55% — جيد»).
 *
 * `minimumLevelMilliliters` (اختياري): حدّ الخزان المضبوط في الإعداد؛ حين يهبط الرصيد دونه يظهر **تنبيه مستقل** عن نطاقات 20/50
 * العرضية. تنبيه عرض فقط — لا يغيّر أي قاعدة في النظام. `null`/`0`/غائب = غير مضبوط فلا تنبيه.
 */
export type TankLevelIndicatorProps =
  | { state: 'loading' }
  | { state: 'error' }
  /** الخادم أعلن عدم توفر رصيد موثوق (أو لم يرسل/أرسل فاسداً): حالة صريحة بلا شريط. */
  | { state: 'unavailable'; reason: BookLevelUnavailableReason }
  | { state: 'ready'; input: TankLevelInput; tankName?: string; timeZone?: string | null; minimumLevelMilliliters?: number | null };

/** رموز التصميم الدلالية فقط (positive/warning/negative) — بلا ألوان صلبة؛ فتتبع الفاتح/الداكن تلقائياً. */
const BAND_STYLE: Record<TankLevelBand, { text: string; fill: string }> = {
  healthy: { text: 'text-positive', fill: 'bg-positive' },
  monitor: { text: 'text-warning', fill: 'bg-warning' },
  low: { text: 'text-negative', fill: 'bg-negative' },
};

export function TankLevelIndicator(props: TankLevelIndicatorProps) {
  const t = useTranslations('stationOps');
  const unit = t('unit.liter');
  const locale = useLocale();

  if (props.state === 'loading') {
    return (
      <div role="status" aria-busy="true" data-tank-level="loading" className="space-y-2">
        <span className="sr-only">{t('tankLevel.loading')}</span>
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-2 w-full rounded-full" />
      </div>
    );
  }
  if (props.state === 'error') {
    return (
      <p role="alert" data-tank-level="error" className="flex items-center gap-2 text-sm text-negative">
        <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.8} />
        {t('tankLevel.error')}
      </p>
    );
  }

  if (props.state === 'unavailable') {
    return (
      <div data-tank-level="unavailable" data-reason={props.reason} className="flex items-start gap-2 text-sm">
        <Gauge aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted" strokeWidth={1.8} />
        <div className="min-w-0">
          <p className="font-medium text-text">{t('tankLevel.unavailable.title')}</p>
          <p className="mt-0.5 text-muted">{t(`tankLevel.unavailable.api.${props.reason}`)}</p>
        </div>
      </div>
    );
  }

  const result = evaluateTankLevel(props.input);
  const label = props.tankName ? `${t('tankLevel.meterLabel')} — ${props.tankName}` : t('tankLevel.meterLabel');

  if (result.kind === 'unavailable') {
    return (
      <div data-tank-level="unavailable" data-reason={result.reason} className="flex items-start gap-2 text-sm">
        <Gauge aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted" strokeWidth={1.8} />
        <div className="min-w-0">
          <p className="font-medium text-text">{t('tankLevel.unavailable.title')}</p>
          {/* غياب البيانات هو الحالة المعتادة اليوم ⇒ لا تفصيل؛ التفصيل فقط حين تصل قيمة غير صالحة/متعارضة. */}
          {result.reason !== 'missing_level' ? <p className="mt-0.5 text-muted">{t(`tankLevel.unavailable.reason.${result.reason}`)}</p> : null}
        </div>
      </div>
    );
  }

  const amount = t('tankLevel.amount', {
    level: formatLitersNumberFromMl(result.levelMilliliters, locale),
    capacity: formatLitersNumberFromMl(result.capacityMilliliters, locale),
    unit,
  });
  const stamp = result.measuredAt ? formatStampInZone(result.measuredAt, locale, props.timeZone) : '—';
  // المصدر «الرصيد الدفتري» يحمله العنوان أعلى البطاقة فلا يتكرر سطراً؛ بقية المصادر (إن صرّح بها الخادم) تبقى سطر أصل.
  const isBook = result.source === 'book';
  const title = isBook ? <p className="text-xs font-medium text-muted">{t('tankLevel.bookBalance')}</p> : null;
  const provenance = [result.source && !isBook ? t(`tankLevel.source.${result.source}`) : null, stamp !== '—' ? t('tankLevel.updatedAt', { time: stamp }) : null].filter(
    (part): part is string => part !== null,
  );

  if (result.kind === 'over_capacity') {
    // شذوذ: لا شريط ولا نسبة (لا قصّ إلى 100%)؛ القيم الخام تُعرض لمن يتحقق.
    return (
      <div data-tank-level="over_capacity" className="space-y-1 rounded-lg border border-negative bg-[color:var(--fo-negative-tint)] p-3 text-sm">
        {title}
        <p className="flex items-center gap-2 font-semibold text-negative">
          <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          {t('tankLevel.overCapacity.title')}
        </p>
        <p className="text-text">{t('tankLevel.overCapacity.body')}</p>
        <p className="text-text">{amount}</p>
        {provenance.length > 0 ? <p className="text-xs text-muted">{provenance.join(' · ')}</p> : null}
      </div>
    );
  }

  const percentText = t('tankLevel.percentValue', { value: new Intl.NumberFormat(displayLocale(locale), { maximumFractionDigits: 2 }).format(result.displayPercent) });
  const status = t(`tankLevel.band.${result.band}`);
  const headline = t('tankLevel.percentStatus', { percent: percentText, status });
  const style = BAND_STYLE[result.band];
  // تنبيه الحد الأدنى المضبوط: مستقل عن النطاقات العرضية، صارم (<)، ولا يظهر للحد غير المضبوط (null/0).
  const minimum = props.minimumLevelMilliliters;
  const belowMinimum = typeof minimum === 'number' && Number.isFinite(minimum) && minimum > 0 && result.levelMilliliters < minimum;
  const minimumAlert = belowMinimum ? t('tankLevel.belowMinimum', { minimum: formatLitersNumberFromMl(minimum, locale), unit }) : null;
  const valueText = [headline, amount, ...provenance, ...(minimumAlert ? [minimumAlert] : [])].join('. ');

  return (
    <div data-tank-level="ok" data-band={result.band} className="space-y-1.5">
      {title}
      <p className={`text-sm font-semibold ${style.text}`}>{headline}</p>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={result.displayPercent}
        aria-valuetext={valueText}
        className="h-2 w-full overflow-hidden rounded-full border border-border bg-background"
      >
        {/* عرض الملء = النسبة الدقيقة (0..100 مضمونة هنا)؛ بلا حركة: الشريط لقطة لا مؤشر حي. */}
        <div data-fill className={`h-full ${style.fill}`} style={{ width: `${result.percent}%` }} />
      </div>
      <p className="text-sm text-text">{amount}</p>
      {provenance.length > 0 ? <p className="text-xs text-muted">{provenance.join(' · ')}</p> : null}
      {minimumAlert ? (
        <p data-minimum-alert className="flex items-start gap-1.5 rounded-md bg-[color:var(--fo-negative-tint)] px-2 py-1.5 text-xs font-medium text-negative">
          <AlertTriangle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          {minimumAlert}
        </p>
      ) : null}
    </div>
  );
}
