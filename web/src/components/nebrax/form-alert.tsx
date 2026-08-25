'use client';

import * as React from 'react';
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

type AlertTone = 'error' | 'warning' | 'info';

const toneStyles: Record<AlertTone, { box: string; icon: string }> = {
  error: { box: 'border-negative/30 bg-negative/10 text-negative', icon: 'text-negative' },
  warning: { box: 'border-warning/30 bg-warning/10 text-warning', icon: 'text-warning' },
  info: { box: 'border-border bg-muted/40 text-text', icon: 'text-primary' },
};

const toneIcons: Record<AlertTone, typeof CircleAlert> = {
  error: CircleAlert,
  warning: TriangleAlert,
  info: Info,
};

/**
 * رسالة حالة داخل نموذج أو صفحة تفاصيل — صياغةٌ واحدة بدل ست صياغات متقاربة.
 *
 * الخطأ يحمل `role="alert"` فيُعلَن على قارئ الشاشة فور ظهوره؛ التحذير والمعلومة
 * لا تحملانه لأنهما وصفٌ للحالة القائمة لا نتيجةُ فعلٍ للتوّ. ولكلٍّ أيقونتُه
 * فلا يقع التمييز على اللون وحده.
 */
export function FormAlert({
  tone = 'error',
  children,
  className,
}: {
  tone?: AlertTone;
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = toneIcons[tone];
  const styles = toneStyles[tone];

  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={cn('flex items-start gap-2.5 rounded-md border px-3.5 py-3 text-sm leading-6', styles.box, className)}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', styles.icon)} strokeWidth={1.8} aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
