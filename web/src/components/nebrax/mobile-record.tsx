'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * تعريف سجلّ الجوال: ترتيب أهمية صريح بدل إسقاط كل خلية جدول بوزن واحد.
 *
 * الترتيب مقصود ومُلزِم — المعرّف، ثم الطرف المقابل، ثم المبلغ/المؤشّر،
 * ثم الحالة، ثم التاريخ والبيانات الوصفية، وأخيراً الإجراءات.
 */
export interface MobileRecord {
  /** المعرّف الأساسي (رقم المستند، اسم المنتج…) — أول ما تقع عليه العين. */
  title: React.ReactNode;
  /** الطرف المقابل: العميل، المورد، التصنيف… */
  subtitle?: React.ReactNode;
  /**
   * سطر عنوان مختصر تحت الطرف المقابل مباشرة — مدينة، فرع… نصٌّ لا يحمل معنىً
   * رقمياً، فيُعرض بخطّ النص العادي لا Mono (بخلاف `meta` المخصَّص للتاريخ
   * والمراجع). اختياريٌّ بالكامل ولا يغيّر عرض أي صفحة لا تمرّره.
   */
  caption?: React.ReactNode;
  /** المبلغ أو المؤشّر الأهم، ويُعرض بخط Mono ومحاذاة النهاية. */
  amount?: React.ReactNode;
  amountLabel?: React.ReactNode;
  /** مؤشّر ثانوي (المتبقي، المخزون…) يُعرض تحت المبلغ بوزن أخفّ. */
  secondary?: { label: React.ReactNode; value: React.ReactNode };
  /** شارات الحالة — نص لا لون فقط. */
  status?: React.ReactNode;
  /** التاريخ أو البيانات الوصفية. */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}

export function MobileRecordItem({ record, className }: { record: MobileRecord; className?: string }) {
  const hasMetric = record.amount != null || record.secondary != null;
  const hasStatusRow = record.status != null || record.meta != null;

  return (
    <div className={cn('flex flex-col gap-2 p-3.5', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-text">{record.title}</div>
          {record.subtitle != null ? (
            <div className="mt-0.5 truncate text-sm text-muted">{record.subtitle}</div>
          ) : null}
          {record.caption != null ? (
            <div className="mt-0.5 truncate text-xs text-muted/80">{record.caption}</div>
          ) : null}
        </div>

        {hasMetric ? (
          <div className="shrink-0 text-end">
            {record.amountLabel != null ? (
              <div className="text-[11px] leading-tight text-muted">{record.amountLabel}</div>
            ) : null}
            {record.amount != null ? (
              <div className="num text-base font-semibold leading-tight text-text">{record.amount}</div>
            ) : null}
            {record.secondary != null ? (
              <div className="mt-0.5 text-xs leading-tight text-muted">
                <span>{record.secondary.label}</span>{' '}
                <span className="num">{record.secondary.value}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {hasStatusRow ? (
        <div className="flex flex-wrap items-center gap-2">
          {record.status}
          {record.meta != null ? <span className="num ms-auto text-xs text-muted">{record.meta}</span> : null}
        </div>
      ) : null}

      {record.actions != null ? (
        <div className="flex items-center justify-end gap-0.5 border-t border-border pt-2">{record.actions}</div>
      ) : null}
    </div>
  );
}
