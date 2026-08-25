'use client';

import * as React from 'react';
import { ActionGroup, type PageAction } from './action-group';
import { cn } from '@/lib/utils';

export type { PageAction } from './action-group';

/**
 * رأس صفحة نبراكس الموحّد.
 *
 * ترتيب المعلومات ثابت في كل الشاشات: تمهيد اختياري → العنوان → الوصف →
 * عناصر السياق (مبدّل الفرع مثلاً) ثم الإجراءات في نهاية السطر.
 * على الجوال ينزل الشريط إلى عمود واحد وتتمدّد الإجراءات لتبقى في متناول الإبهام.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  context,
  actions,
  actionsSlot,
  inlineActionLimit,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  /** عناصر تحكّم في نطاق الصفحة (مبدّل فرع، تبويب…) تُعرض تحت العنوان. */
  context?: React.ReactNode;
  actions?: PageAction[];
  /** بديل تصريحي حين يحتاج الإجراء مكوّناً خاصاً لا يصفه `PageAction`. */
  actionsSlot?: React.ReactNode;
  inlineActionLimit?: number;
  className?: string;
}) {
  const hasActions = (actions && actions.length > 0) || actionsSlot;

  return (
    <header className={cn('flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between', className)}>
      <div className="min-w-0 space-y-2">
        <div className="min-w-0">
          {eyebrow ? <p className="text-xs font-semibold tracking-wide text-primary">{eyebrow}</p> : null}
          <h1 className="text-xl font-semibold text-text">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{description}</p>
          ) : null}
        </div>
        {context ? <div className="flex flex-wrap items-center gap-2">{context}</div> : null}
      </div>

      {hasActions ? (
        <div className="flex w-full flex-wrap items-center gap-2 sm:justify-end lg:w-auto">
          {actions && actions.length > 0 ? (
            <ActionGroup actions={actions} inlineLimit={inlineActionLimit} />
          ) : null}
          {actionsSlot}
        </div>
      ) : null}
    </header>
  );
}
