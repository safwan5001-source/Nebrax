'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronLeft, LockKeyhole } from 'lucide-react';
import { cn } from '@/lib/utils';

/** FUEL-B4 — عناصر عرض مشتركة لشاشات الإدارة. خصائص منطقية فقط (RTL/LTR)، أهداف لمس ≥ 48px، والحالة نصٌّ لا لوناً وحده. */

export type Tone = 'neutral' | 'positive' | 'warning' | 'negative' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-primary-soft text-text',
  positive: 'bg-[color:var(--fo-positive-tint)] text-positive',
  warning: 'bg-[color:var(--fo-warning-tint)] text-warning',
  negative: 'bg-[color:var(--fo-negative-tint)] text-negative',
  info: 'bg-primary-soft text-primary',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn('inline-flex min-h-6 items-center rounded-md px-2 py-0.5 text-xs font-semibold', TONES[tone])}>{children}</span>;
}

export function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex min-h-7 items-center rounded-full border border-border bg-background px-2.5 text-xs text-text">{children}</span>;
}

/** بطاقة رابط قابلة للنقر (قائمة الموظفين، بطاقات الأقسام). */
export function LinkCard({ href, title, hint, trailing, icon }: { href: string; title: string; hint?: string; trailing?: ReactNode; icon?: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex min-h-[64px] items-center gap-3 rounded-[14px] border border-border bg-surface p-4 hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {icon ? <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-primary-soft text-primary">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-text">{title}</span>
        {hint ? <span className="mt-0.5 block text-sm leading-5 text-muted">{hint}</span> : null}
      </span>
      {trailing}
      <ChevronLeft aria-hidden="true" className="h-5 w-5 shrink-0 text-muted ltr:rotate-180" strokeWidth={1.8} />
    </Link>
  );
}

/** مفتاح تفعيل/تعطيل بدور `switch` (≥48px). `locked` = لا يُغيَّر، مع سبب ظاهر نصاً. */
export function SwitchRow({ id, label, checked, onChange, disabled = false, locked, note, badge }: {
  id: string;
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  locked?: string | null;
  note?: ReactNode;
  badge?: ReactNode;
}) {
  const off = disabled || !!locked;
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className={cn('block text-[15px] leading-6', off && !checked ? 'text-muted' : 'text-text')}>{label} {badge}</label>
        {locked ? (
          <p className="mt-0.5 flex items-center gap-1.5 text-xs leading-5 text-muted"><LockKeyhole aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />{locked}</p>
        ) : null}
        {note}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={off}
        onClick={onChange}
        className={cn(
          'relative mt-0.5 inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'border-primary bg-primary' : 'border-[color:var(--fo-control)] bg-background',
        )}
      >
        <span aria-hidden="true" className={cn('inline-block h-6 w-6 rounded-full bg-white shadow transition-transform', checked ? 'ltr:translate-x-7 rtl:-translate-x-7' : 'ltr:translate-x-1 rtl:-translate-x-1', !checked && 'bg-muted/70')} />
      </button>
    </div>
  );
}
