'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type FormWidth = 'narrow' | 'default' | 'wide' | 'full';

const widthClass: Record<FormWidth, string> = {
  narrow: 'mx-auto max-w-4xl',
  default: 'mx-auto max-w-5xl',
  wide: 'mx-auto max-w-7xl',
  full: '',
};

/**
 * شريط إجراءات النموذج.
 *
 * على الديسكتوب صفٌّ في نهاية النموذج: الحفظ الأساسي واضح، والثانوي بجانبه،
 * والمُتلِف (إن وُجد) منفصلٌ في البداية فلا يُضغط بالخطأ مكان الحفظ.
 *
 * على الجوال يلتصق الشريط بأسفل الشاشة: نماذج ERP أطول من شاشة الهاتف، ودفنُ
 * زرّ الحفظ في نهايتها يعني تمريراً كاملاً بعد كل تعديل. الحشوة `pb-safe` تُبقيه
 * فوق الشريط المنزلق في iPhone، و`FormPage` يحجز له مساحةً في الأسفل فلا يغطّي
 * آخر حقلٍ في النموذج.
 */
export function FormActions({
  primary,
  secondary,
  destructive,
  note,
  sticky = true,
  className,
}: {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  /** إجراء متلف (حذف مسودة) — يبقى بعيداً عن الحفظ بصرياً. */
  destructive?: React.ReactNode;
  /** سطر تنبيه صغير فوق الأزرار (تلميح ترحيل، عدد أخطاء…). */
  note?: React.ReactNode;
  /** أطفئه للنماذج القصيرة التي لا تحتاج شريطاً ثابتاً. */
  sticky?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2',
        sticky
          ? 'sticky bottom-0 z-20 -mx-4 border-t border-border bg-surface px-4 pt-3 pb-safe lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0'
          : undefined,
        className
      )}
    >
      {note ? <div className="text-xs leading-5 text-muted">{note}</div> : null}
      <div className="flex items-center gap-2 lg:justify-end">
        {destructive ? <div className="me-auto shrink-0">{destructive}</div> : null}
        {secondary ? <div className="flex-1 lg:flex-none [&>*]:w-full lg:[&>*]:w-auto">{secondary}</div> : null}
        <div className="flex-[2] lg:flex-none [&>*]:w-full lg:[&>*]:w-auto">{primary}</div>
      </div>
    </div>
  );
}

/**
 * هيكل صفحة نموذج ERP (إنشاء/تعديل).
 *
 * الرأس يجيب سؤالين قبل أي حقل: أين أنا (رجوع + عنوان صريح «إنشاء» أو «تعديل»)،
 * وما حالة ما أحرّره (`status`). لا CTA مكرّراً في الرأس: الحفظ مكانه شريط
 * الإجراءات وحده، فلا يتردّد المستخدم بين زرَّي حفظ.
 */
export function FormPage({
  backHref,
  backLabel,
  title,
  description,
  status,
  aside,
  actions,
  width = 'default',
  children,
  className,
}: {
  backHref: string;
  /** تسمية وصول لزرّ الرجوع الأيقوني. */
  backLabel: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** شارة الحالة (مسودة…) في نهاية سطر الرأس. */
  status?: React.ReactNode;
  /** عمود جانبي لاصق على الديسكتوب (ملخّص الإجماليات عادةً). */
  aside?: React.ReactNode;
  /** `FormActions` — يُمرَّر صراحةً ليحجز `FormPage` مساحته أسفل الجوال. */
  actions?: React.ReactNode;
  width?: FormWidth;
  children: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations('nebrax');

  return (
    <div className={cn(widthClass[width], 'space-y-5', className)}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Button asChild variant="ghost" size="icon" className="shrink-0" aria-label={backLabel || t('back')}>
            <Link href={backHref}>
              <ArrowRight className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-text">{title}</h1>
            {description ? <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{description}</p> : null}
          </div>
        </div>
        {status ? <div className="shrink-0">{status}</div> : null}
      </header>

      {aside ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 space-y-5">{children}</div>
          <div className="min-w-0 lg:sticky lg:top-5 lg:h-fit">{aside}</div>
        </div>
      ) : (
        <div className="space-y-5">{children}</div>
      )}

      {actions}
    </div>
  );
}
