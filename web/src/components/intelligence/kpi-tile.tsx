import { Money } from '@/components/ui/money';
import { cn } from '@/lib/utils';

export type KpiTone = 'neutral' | 'positive' | 'negative';

const TONE: Record<KpiTone, string> = { neutral: 'text-text', positive: 'text-positive', negative: 'text-negative' };

/** إشارة القيمة كما أرسلها الخادم (هللات): دلالة عرض فقط — لا حساب. */
export function toneOf(minor: number): KpiTone {
  return minor < 0 ? 'negative' : 'positive';
}

/** بلاط رقم رئيسي: تسمية صغيرة + مبلغ بخط الأرقام. الأحمر/الأخضر للدلالة المالية فقط. */
export function KpiTile({
  label,
  value,
  tone = 'neutral',
  emphasis = false,
  dot,
  className,
}: {
  label: string;
  /** `decimal` كما أرسله الخادم. */
  value: string;
  tone?: KpiTone;
  emphasis?: boolean;
  /** صنف لون لنقطة تمييز (شرائح الأعمار). */
  dot?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded border border-border bg-surface px-3 py-2.5',
        emphasis && 'border-s-[3px] border-s-primary',
        className,
      )}
    >
      <p className="flex items-center gap-1.5 text-xs text-muted">
        {dot ? <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', dot)} /> : null}
        <span className="min-w-0 truncate">{label}</span>
      </p>
      <Money value={value} className={cn('mt-1 block font-semibold', emphasis ? 'text-xl' : 'text-base', TONE[tone])} />
    </div>
  );
}
