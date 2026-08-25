'use client';

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * قسمٌ واحد داخل نموذج ERP — بطاقةٌ بعنوان، لا بطاقةٌ لكل حقل.
 *
 * التقسيم بالمعنى (المورّد، البنود، الدفع، الضريبة…) لا بعدد الحقول: المستخدم
 * المحاسبي يقرأ النموذج كمستند له أقسام، فيجد ما يبحث عنه دون مسح كل الحقول.
 */
export function FormSection({
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
  contentClassName,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  /** إجراء على مستوى القسم (إضافة سطر، رفع مرفق…) يُعرض في نهاية سطر العنوان. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className={cn(action ? 'flex-row items-start justify-between gap-3 space-y-0' : undefined)}>
        <div className="min-w-0 space-y-1">
          <CardTitle className={cn(Icon ? 'flex items-center gap-2' : undefined)}>
            {Icon ? <Icon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} aria-hidden="true" /> : null}
            {title}
          </CardTitle>
          {description ? <p className="text-sm leading-relaxed text-muted">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}

/**
 * شبكة حقول: عمودٌ واحد على الجوال دائماً، ثم عمودان أو ثلاثة حسب طبيعة الحقول.
 *
 * صفٌّ من حقلين ضيّقين على شاشة 390px يجعل كل واحد منهما أضيق من أن يُقرأ رقمُه أو
 * يُفتح منتقي تاريخه، فالعمود الواحد ليس تنازلاً بل هو الشكل الصحيح هناك.
 */
export function FieldGrid({
  columns = 2,
  children,
  className,
}: {
  columns?: 2 | 3;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4',
        columns === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2',
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * حقلٌ يشغل عرض الشبكة كاملاً — الوصف والملاحظات والحقول الطويلة.
 * تفادياً لتكرار `sm:col-span-2 lg:col-span-3` بأشكال متضاربة في كل صفحة.
 */
export function FieldSpan({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('sm:col-span-2 lg:col-span-3', className)}>{children}</div>;
}
