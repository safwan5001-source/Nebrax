'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * مفتاح تبديل (Switch) — بديل بصري لـ«نعم/لا» في الإعدادات.
 * زرّ `role="switch"` حقيقي: يعمل بلوحة المفاتيح (مسافة/إدخال)، وله حلقة تركيز،
 * ويستخدم لون الهوية وحده (لا لون هوية ثانٍ — انظر DESIGN_SYSTEM.md).
 */
export const Switch = React.forwardRef<
  HTMLButtonElement,
  {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
    id?: string;
    'aria-label'?: string;
    'aria-labelledby'?: string;
    className?: string;
  }
>(({ checked, onCheckedChange, disabled, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onCheckedChange(!checked)}
    className={cn(
      'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
      'disabled:cursor-not-allowed disabled:opacity-50',
      checked ? 'bg-primary' : 'bg-border',
      className
    )}
    {...props}
  >
    {/* المقبض ينزلق للطرف المقابل حسب اتجاه الصفحة (RTL أولاً). */}
    <span
      aria-hidden
      className={cn(
        'mx-0.5 block h-5 w-5 rounded-full bg-surface shadow-sm transition-transform duration-150 ease-out',
        checked ? 'rtl:-translate-x-5 ltr:translate-x-5' : 'translate-x-0'
      )}
    />
  </button>
));
Switch.displayName = 'Switch';
