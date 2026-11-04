'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * AWJ-UX-SELECTION-MODE-1 — مفتاح «وضع التحديد» (عرض فقط).
 *
 * مكوّن عرض خالص: لا يعرف شيئاً عن المنتجات أو النشر أو التصدير ولا يملك حالة تحديد.
 * كل شاشة تملك حالة التحديد وقواعد عملها (حدود، صلاحيات، إجراءات جماعية) وتمرّر هنا
 * التسميات فقط، فلا يتسرّب منطق وحدة إلى أخرى.
 *
 * - زرٌّ واحد بعنصر DOM ثابت: التسمية وحدها تتبدّل بين «تحديد» و«إنهاء التحديد»، فيبقى
 *   التركيز على الزر نفسه عند الدخول والخروج (لا يضيع مع اختفاء مربعات الاختيار).
 * - هدف لمس ≥ 44px على الجوال (`min-h-11`) ويصغر على الشاشات الأكبر.
 * - `status` سطر حالة اختياري (عدّاد/تلميح) في منطقة `aria-live="polite"` (بلا `role="status"` كي لا
 *   تتكاثر مناطق الحالة في الصفحة) لقارئ الشاشة.
 */
export function SelectionModeToggle({
  active,
  onEnter,
  onExit,
  enterLabel,
  exitLabel,
  disabled = false,
  status,
  className,
}: {
  active: boolean;
  onEnter: () => void;
  onExit: () => void;
  enterLabel: string;
  exitLabel: string;
  disabled?: boolean;
  /** نص الحالة في وضع التحديد (مثل «المحدد: 3»)؛ يُحجب خارج الوضع. */
  status?: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-awj-selection-toggle="" className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      <Button
        type="button"
        variant={active ? 'primary' : 'outline'}
        className="min-h-11 md:min-h-9"
        disabled={disabled}
        onClick={active ? onExit : onEnter}
        data-awj-selection-mode={active ? 'on' : 'off'}
      >
        {active ? exitLabel : enterLabel}
      </Button>
      <span aria-live="polite" className="text-sm text-muted">
        {active ? status : null}
      </span>
    </div>
  );
}
