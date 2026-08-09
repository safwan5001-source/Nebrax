'use client';

import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * أكورديون **قسم واحد مفتوح في كل مرة** — نمط الجوال في نبراس: الشاشة ضيّقة،
 * ففتح قسمين معاً يُغرق المستخدم في تمرير طويل.
 *
 * الحالة يملكها الأب (`openId`) لا المكوّن، فيتشارك مع التبويبات على الديسكتوب
 * قسماً نشطاً واحداً — ينتقل المستخدم بين المقاسين فيجد نفسه في القسم نفسه.
 */
export function Accordion({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-2', className)}>{children}</div>;
}

export function AccordionItem({
  id,
  title,
  count,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded border border-border bg-surface">
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`acc-${id}`}
          className={cn(
            'flex w-full items-center justify-between gap-3 px-3.5 py-3 text-start',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40'
          )}
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-text">
            {title}
            {count !== undefined && (
              <span className="num rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary">
                {count}
              </span>
            )}
          </span>
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 text-muted transition-transform', open && 'rotate-180 text-primary')}
            strokeWidth={2}
          />
        </button>
      </h3>
      {/* المحتوى لا يُركَّب إلا وهو مفتوح — لا طلبات ولا جداول مخفيّة تستهلك الجوال. */}
      {open && (
        <div id={`acc-${id}`} className="border-t border-border">
          {children}
        </div>
      )}
    </div>
  );
}
