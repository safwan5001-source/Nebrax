'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { CircleAlert, Inbox } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * حالات الشاشة الثلاث بصياغة واحدة (تحميل / فراغ / خطأ).
 *
 * القاعدة في `design-system/patterns/states.md`: لا شاشة بيضاء صامتة. هذه
 * المكوّنات تجعل الالتزام بها أرخص من مخالفتها، فلا تعيد كل صفحة رسم هيكلها.
 */

type Surface = 'panel' | 'bare';

function surfaceClass(surface: Surface) {
  return surface === 'panel' ? 'rounded border border-border bg-surface' : '';
}

export function LoadingState({
  variant = 'table',
  rows = 6,
  label,
  surface = 'panel',
  className,
}: {
  variant?: 'table' | 'cards' | 'metrics';
  rows?: number;
  /** تسمية وصول أدقّ من «جارٍ التحميل» المجرّدة حين يفيد ذكر ما يُحمَّل. */
  label?: string;
  surface?: Surface;
  className?: string;
}) {
  const t = useTranslations('nebrax');
  const busyLabel = label ?? t('loading');
  if (variant === 'metrics') {
    return (
      <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-4', className)} role="status" aria-busy="true" aria-label={busyLabel}>
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (variant === 'cards') {
    return (
      <div className={cn('space-y-3', className)} role="status" aria-busy="true" aria-label={busyLabel}>
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(surfaceClass(surface), 'space-y-2 p-4', className)}
      role="status"
      aria-busy="true"
      aria-label={busyLabel}
    >
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-8 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  surface = 'panel',
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  action?: React.ReactNode;
  surface?: Surface;
  className?: string;
}) {
  return (
    <div className={cn(surfaceClass(surface), 'flex flex-col items-center gap-2 px-4 py-12 text-center', className)}>
      <Icon className="h-8 w-8 text-muted opacity-60" strokeWidth={1.5} aria-hidden="true" />
      <p className="text-sm font-medium text-text">{title}</p>
      {description ? <p className="max-w-md text-sm leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  retryLabel,
  surface = 'panel',
  className,
}: {
  message: React.ReactNode;
  onRetry?: () => void;
  /** يتجاوز التسمية المترجمة حين تملك الشاشة صياغة أدقّ لإعادة المحاولة. */
  retryLabel?: string;
  surface?: Surface;
  className?: string;
}) {
  const t = useTranslations('nebrax');

  return (
    <div className={cn(surfaceClass(surface), 'flex flex-col items-center gap-3 px-4 py-10 text-center', className)}>
      <CircleAlert className="h-7 w-7 text-negative" strokeWidth={1.6} aria-hidden="true" />
      <p role="alert" className="text-sm text-negative">
        {message}
      </p>
      {onRetry ? (
        <Button type="button" variant="outline" onClick={onRetry}>
          {retryLabel ?? t('retry')}
        </Button>
      ) : null}
    </div>
  );
}
