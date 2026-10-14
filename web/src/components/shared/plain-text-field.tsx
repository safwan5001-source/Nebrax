'use client';

import { useId } from 'react';
import { Input } from '@/components/ui/input';

/**
 * حقل نصّي مُعنوَن محايد (INT-UX-5c): تسمية + تلميح + رسالة خطأ مرتبطة بالحقل (`aria-describedby`/`aria-invalid`). قيمة تقنية
 * قصيرة (مثل معرّف متجر): اتجاهها LTR، بلا إكمال تلقائي ولا تصحيح إملائي ولا تكبير تلقائي. كل النصوص خاصيات.
 */
export function PlainTextField({
  value,
  onChange,
  label,
  hint,
  error,
  disabled = false,
  required = false,
  testId,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  hint?: string;
  error?: string | null;
  disabled?: boolean;
  required?: boolean;
  testId?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-text">
        {label}
        {required ? <span aria-hidden="true" className="ms-0.5 text-negative">*</span> : null}
      </label>
      <Input
        id={id}
        dir="ltr"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        data-testid={testId}
      />
      {hint ? <p id={hintId} className="text-xs leading-relaxed text-muted">{hint}</p> : null}
      {error ? <p id={errorId} role="alert" className="text-xs leading-relaxed text-negative" data-testid={testId ? `${testId}-error` : undefined}>{error}</p> : null}
    </div>
  );
}
