'use client';

import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { formatRiyal } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * البطاقات المالية الثلاث — **فاصل لوني رفيع على الحافة** لا حدود ملوّنة كاملة:
 * الدلالة تُقرأ بلمحة دون أن يغرق السطح في اللون (مبدأ «الدلالة قبل الزينة»).
 * الحافة على `start` فتنعكس تلقائياً بين RTL وLTR.
 */
export type MoneyTone = 'due' | 'open' | 'credit';

const TONE: Record<MoneyTone, { edge: string; value: string }> = {
  due:    { edge: 'bg-negative', value: 'text-negative' },
  open:   { edge: 'bg-warning',  value: 'text-text' },
  credit: { edge: 'bg-positive', value: 'text-positive' },
};

export function MoneyCard({
  tone,
  label,
  value,
  action,
}: {
  tone: MoneyTone;
  label: string;
  value: string;
  action?: { label: string; href: string };
}) {
  const t = TONE[tone];

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden rounded border border-border bg-surface p-3 sm:p-4">
      <span aria-hidden className={cn('absolute inset-y-0 start-0 w-1', t.edge)} />
      {/* الجوال ثلاثة أعمدة ضيّقة، فالرقم يصغر ويلتفّ بدل أن يُقصّ. */}
      <div className={cn('num break-words text-[13px] font-semibold leading-tight sm:text-xl', t.value)}>
        {formatRiyal(value)}
      </div>
      <div className="mt-1 text-[11px] text-muted sm:text-xs">
        {action && (
          <>
            <Link href={action.href} className="font-medium text-primary hover:underline">
              {action.label}
            </Link>
            <span className="mx-1">·</span>
          </>
        )}
        {label}
      </div>
    </div>
  );
}

/** بطاقة الهوية: أفاتار بحرف أول + الاسم + العنوان، وفتحة لزرّ إضافي (⋮ على الجوال). */
export function IdentityCard({
  name,
  address,
  addressFallback,
  action,
}: {
  name: string;
  address: string;
  addressFallback: string;
  action?: React.ReactNode;
}) {
  const initial = name.trim().charAt(0) || '؟';

  return (
    <div className="relative flex items-start gap-3.5 rounded border border-border bg-surface p-4">
      {/* أفاتار بلون الهوية — لا تدرّج ولا لون هوية ثانٍ (قاعدة نظام التصميم). */}
      <div
        aria-hidden
        className="grid h-14 w-14 shrink-0 place-items-center rounded bg-primary-soft text-2xl font-bold text-primary"
      >
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="pe-9 text-base font-semibold leading-relaxed text-text">{name}</h2>
        <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-muted">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
          {address || addressFallback}
        </p>
      </div>
      {action && <div className="absolute end-3 top-3">{action}</div>}
    </div>
  );
}
