'use client';

import { useId } from 'react';
import { Input } from '@/components/ui/input';

/**
 * حقل «اكتب القيمة لتأكيد الإجراء الهدّام» (INT-UX-5b) — محايد: كل نصّ خاصية.
 * المطابقة **حرفية** (حسّاسة لحالة الأحرف وبلا قصّ مسافات): القيمة المطلوبة تُعرض أمامه، والمقارنة يجريها المستدعي
 * (`typed === expected`) ويُمرّر نتيجتها إلى زرّ التأكيد. الحقل بلا إكمال تلقائي ولا تصحيح إملائي ولا تكبير تلقائي،
 * واتجاهه LTR لأن معرّف المتجر قيمة تقنية داخل واجهة قد تكون RTL.
 */
export function TypedConfirmationField({
  value,
  onChange,
  label,
  expected,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  /** القيمة التي يجب كتابتها؛ تُعرض للقراءة والنسخ البصري، لا تُملأ في الحقل. */
  expected: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-text">{label}</label>
      <p dir="ltr" className="num break-all rounded border border-border bg-background px-3 py-2 text-xs text-text [unicode-bidi:plaintext]" data-testid="typed-confirmation-expected">{expected}</p>
      <Input
        id={id}
        dir="ltr"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        data-testid="typed-confirmation-input"
      />
    </div>
  );
}
