'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * قائمة إعدادات مدمجة: صفٌّ لكل إعداد (عنوان + شرح على جهة، وأداة التحكم على الجهة الأخرى) داخل سطح واحد
 * بحدود فاصلة — لا بطاقة لكل حقل. على الجوال تنزل الأداة تحت الشرح بعرض كامل.
 */
export function SettingsList({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('divide-y divide-border rounded border border-border bg-surface', className)} {...rest}>
      {children}
    </div>
  );
}

export function SettingRow({
  labelId,
  label,
  hint,
  hintId,
  control,
  error,
  errorId,
  className,
}: {
  /** معرّف عنصر العنوان — تشير إليه الأداة بـ`aria-labelledby`. */
  labelId: string;
  label: ReactNode;
  hint?: ReactNode;
  hintId?: string;
  control: ReactNode;
  error?: ReactNode;
  errorId?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6', className)}>
      <div className="min-w-0 flex-1 space-y-1">
        <p id={labelId} className="text-sm font-medium text-text">
          {label}
        </p>
        {hint ? (
          <p id={hintId} className="text-xs leading-5 text-muted">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} role="alert" className="text-xs leading-5 text-negative">
            {error}
          </p>
        ) : null}
      </div>
      <div className="shrink-0 sm:pt-0.5">{control}</div>
    </div>
  );
}
