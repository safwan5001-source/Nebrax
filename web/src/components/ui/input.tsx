import * as React from 'react';
import { cn } from '@/lib/utils';

const EASTERN_ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/**
 * Converts a user-entered date to the ISO calendar value required by the API.
 * Native mobile date controls can adopt a Hijri calendar or reorder segments
 * under RTL; this keeps date form fields Gregorian and unambiguous.
 */
export function normalizeGregorianDate(value: string): string {
  const latinDigits = value
    .replace(/[٠-٩]/g, (digit) => String(EASTERN_ARABIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)));

  const match = latinDigits.match(/^(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})$/);
  if (!match) return latinDigits;

  const [, first, second, third] = match;
  const year = first.length === 4 ? first : third.length === 4 ? third : null;
  if (!year) return latinDigits;

  const month = second;
  const day = first.length === 4 ? third : first;
  const monthNumber = Number(month);
  const dayNumber = Number(day);

  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return latinDigits;

  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, dir, lang, inputMode, placeholder, onChange, value, defaultValue, ...props }, ref) => {
    const isDate = type === 'date';
    const normalizedValue = isDate && typeof value === 'string' ? normalizeGregorianDate(value) : value;
    const normalizedDefaultValue = isDate && typeof defaultValue === 'string'
      ? normalizeGregorianDate(defaultValue)
      : defaultValue;

    return (
      <input
        ref={ref}
        type={isDate ? 'text' : type}
        dir={isDate ? 'ltr' : dir}
        lang={isDate ? 'en-GB' : lang}
        inputMode={isDate ? 'numeric' : inputMode}
        placeholder={isDate ? 'YYYY-MM-DD' : placeholder}
        value={normalizedValue}
        defaultValue={normalizedDefaultValue}
        className={cn(
          'h-9 w-full rounded border border-border bg-surface px-3 text-sm text-text placeholder:text-muted',
          'aria-[invalid=true]:border-negative aria-[invalid=true]:focus-visible:ring-negative/25',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50',
          isDate && 'text-left font-mono tabular-nums tracking-wide [unicode-bidi:isolate]',
          className
        )}
        onChange={isDate
          ? (event) => {
              event.currentTarget.value = normalizeGregorianDate(event.currentTarget.value);
              onChange?.(event);
            }
          : onChange}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';
