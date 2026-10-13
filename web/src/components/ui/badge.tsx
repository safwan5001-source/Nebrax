import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-primary-soft text-primary',
        muted: 'border border-border text-muted',
        positive: 'bg-positive/10 text-positive',
        warning: 'bg-warning/10 text-warning',
        negative: 'bg-negative/10 text-negative',
      },
    },
    defaultVariants: { tone: 'neutral' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /**
   * يسمح بالتفاف النص بدل `whitespace-nowrap` **حين تضيق الحاوية فعلاً** عن عرض الشارة الطبيعي (نص مكبَّر 200%).
   * `shrink-0` + `max-w-full`: لا تنكمش الشارة لتلتف قبل أوانها داخل صف flex (كان ذلك يغيّر المظهر عند 100%)، لكنها لا تتجاوز عرض حاويتها.
   * الافتراضي `false` كما كان.
   */
  wrap?: boolean;
}

export function Badge({ className, tone, wrap = false, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), wrap && 'max-w-full shrink-0 whitespace-normal break-words text-start', className)} {...props} />;
}
