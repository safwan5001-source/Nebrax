'use client';

import { useEffect, useRef, useState } from 'react';
import { Delete } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type PosNumericEditorLabels = {
  apply: string;
  backspace: string;
  cancel: string;
  clear: string;
  decimal: string;
  digit: (digit: string) => string;
  value: string;
};

interface PosNumericEditorProps {
  allowDecimal: boolean;
  className?: string;
  disabled?: boolean;
  editable?: boolean;
  inputAriaLabel: string;
  labels: PosNumericEditorLabels;
  onApply?: (value: string) => void;
  onBlur?: () => void;
  onChange: (value: string) => void;
  showKeypad: boolean;
  title: string;
  value: string;
}

/**
 * محرر POS لرقم واحد: الإدخال النصي يبقى المسار المتوافق، ولوحة الأرقام
 * مساعد اختياري فقط. لا يحسب مالاً ولا يفرض صلاحيات؛ صفحة الكاشير تبقى
 * مصدر تحقق السعر والخصم والكمية.
 */
export function PosNumericEditor({
  allowDecimal,
  className,
  disabled = false,
  editable = true,
  inputAriaLabel,
  labels,
  onApply,
  onBlur,
  onChange,
  showKeypad,
  title,
  value,
}: PosNumericEditorProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const appliedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setDraft(value);
    appliedRef.current = false;
  }, [open, value]);

  if (!editable) return null;

  function updateDraft(next: string) {
    const valid = allowDecimal ? /^\d*(?:\.\d*)?$/ : /^\d*$/;
    if (valid.test(next)) setDraft(next);
  }

  function append(valueToAppend: string) {
    if (valueToAppend === '.' && (!allowDecimal || draft.includes('.'))) return;
    updateDraft(`${draft}${valueToAppend}`);
  }

  function apply() {
    if (appliedRef.current) return;
    appliedRef.current = true;
    onChange(draft);
    onApply?.(draft);
    setOpen(false);
  }

  if (!showKeypad) {
    return (
      <Input
        aria-label={inputAriaLabel}
        className={cn('num text-center', className)}
        disabled={disabled}
        dir="ltr"
        inputMode={allowDecimal ? 'decimal' : 'numeric'}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        pattern={allowDecimal ? '[0-9]*[.]?[0-9]*' : '[0-9]*'}
        value={value}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label={inputAriaLabel}
        className={cn(
          'num rounded border border-border bg-background text-center text-text hover:border-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        disabled={disabled}
        dir="ltr"
        onClick={() => setOpen(true)}
      >
        {value || '0'}
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title={title} className="max-w-sm">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <Input
            aria-label={labels.value}
            autoComplete="off"
            className="num h-12 text-end text-lg font-semibold"
            dir="ltr"
            inputMode={allowDecimal ? 'decimal' : 'numeric'}
            onChange={(event) => updateDraft(event.target.value)}
            pattern={allowDecimal ? '[0-9]*[.]?[0-9]*' : '[0-9]*'}
            value={draft}
          />

          <div className="grid grid-cols-3 gap-2" dir="ltr">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                type="button"
                aria-label={labels.digit(digit)}
                className="num min-h-12 rounded-md border border-border bg-background text-base font-semibold text-text hover:border-primary hover:bg-primary-soft active:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                onClick={() => append(digit)}
              >
                {digit}
              </button>
            ))}
            {allowDecimal ? (
              <button
                type="button"
                aria-label={labels.decimal}
                className="num min-h-12 rounded-md border border-border bg-background text-base font-semibold text-text hover:border-primary hover:bg-primary-soft active:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                onClick={() => append('.')}
              >
                .
              </button>
            ) : (
              <span aria-hidden />
            )}
            <button
              type="button"
              aria-label={labels.digit('0')}
              className="num min-h-12 rounded-md border border-border bg-background text-base font-semibold text-text hover:border-primary hover:bg-primary-soft active:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              onClick={() => append('0')}
            >
              0
            </button>
            <button
              type="button"
              aria-label={labels.backspace}
              className="grid min-h-12 place-items-center rounded-md border border-border bg-background text-text hover:border-primary hover:bg-primary-soft active:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              onClick={() => updateDraft(draft.slice(0, -1))}
            >
              <Delete aria-hidden className="h-4 w-4" strokeWidth={1.7} />
            </button>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(false)}>{labels.cancel}</Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setDraft('')}>{labels.clear}</Button>
              <Button type="submit" className="min-h-11">{labels.apply}</Button>
            </div>
          </div>
        </form>
      </Dialog>
    </>
  );
}
