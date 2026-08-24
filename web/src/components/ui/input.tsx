import * as React from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { ARABIC_DISPLAY_LOCALE } from '@/lib/formatting';
import { cn } from '@/lib/utils';

const EASTERN_ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const WEEKDAY_LABELS = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];

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

function parseIsoDate(value: string | number | readonly string[] | undefined): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function formatIsoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  valueSetter?.call(input, value);
}

function isOutOfRange(value: string, min?: string | number, max?: string | number) {
  const minValue = min?.toString();
  const maxValue = max?.toString();
  return Boolean((minValue && value < minValue) || (maxValue && value > maxValue));
}

type GregorianDateInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

const GregorianDateInput = React.forwardRef<HTMLInputElement, GregorianDateInputProps>(
  ({ className, dir: _dir, lang: _lang, inputMode: _inputMode, placeholder: _placeholder, onChange, value, defaultValue, min, max, disabled, ...props }, forwardedRef) => {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const [open, setOpen] = React.useState(false);
    const normalizedValue = typeof value === 'string' ? normalizeGregorianDate(value) : value;
    const normalizedDefaultValue = typeof defaultValue === 'string' ? normalizeGregorianDate(defaultValue) : defaultValue;
    const selectedDate = parseIsoDate(normalizedValue ?? normalizedDefaultValue);
    const [viewDate, setViewDate] = React.useState(() => selectedDate ?? new Date());
    const calendarId = React.useId();

    React.useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement, []);

    React.useEffect(() => {
      if (selectedDate && open) setViewDate(selectedDate);
    }, [normalizedValue, open]);

    React.useEffect(() => {
      if (!open) return;

      const closeWhenOutside = (event: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
      };
      const closeOnEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') setOpen(false);
      };

      document.addEventListener('mousedown', closeWhenOutside);
      document.addEventListener('keydown', closeOnEscape);
      return () => {
        document.removeEventListener('mousedown', closeWhenOutside);
        document.removeEventListener('keydown', closeOnEscape);
      };
    }, [open]);

    const commitDate = (nextValue: string) => {
      const input = inputRef.current;
      if (!input) return;
      setNativeInputValue(input, nextValue);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      setOpen(false);
      input.focus();
    };

    const year = viewDate.getFullYear();
    const monthIndex = viewDate.getMonth();
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const firstWeekday = new Date(year, monthIndex, 1).getDay();
    const selectedIso = selectedDate ? formatIsoDate(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()) : null;
    const monthLabel = new Intl.DateTimeFormat(ARABIC_DISPLAY_LOCALE, { month: 'long', year: 'numeric' }).format(viewDate);

    return (
      <div ref={containerRef} className="relative">
        <input
          ref={inputRef}
          type="text"
          dir="ltr"
          lang="en-GB"
          inputMode="numeric"
          autoComplete="off"
          placeholder="YYYY-MM-DD"
          value={normalizedValue}
          defaultValue={normalizedDefaultValue}
          min={min}
          max={max}
          disabled={disabled}
          className={cn(
            'h-9 w-full rounded border border-border bg-surface px-3 pr-10 text-left font-mono text-sm tabular-nums tracking-wide text-text placeholder:text-muted [unicode-bidi:isolate]',
            'aria-[invalid=true]:border-negative aria-[invalid=true]:focus-visible:ring-negative/25',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50',
            className
          )}
          onChange={(event) => {
            const normalized = normalizeGregorianDate(event.currentTarget.value);
            if (normalized !== event.currentTarget.value) setNativeInputValue(event.currentTarget, normalized);
            onChange?.(event);
          }}
          {...props}
        />
        <button
          type="button"
          aria-label="فتح التقويم الميلادي"
          aria-expanded={open}
          aria-controls={calendarId}
          disabled={disabled}
          onClick={() => {
            setViewDate(selectedDate ?? new Date());
            setOpen((current) => !current);
          }}
          className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-muted transition-colors hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CalendarDays className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </button>
        {open && (
          <div id={calendarId} role="dialog" aria-label="التقويم الميلادي" className="absolute z-50 mt-1 w-72 rounded-lg border border-border bg-surface p-3 shadow-xl" dir="rtl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <button type="button" aria-label="الشهر التالي" onClick={() => setViewDate(new Date(year, monthIndex + 1, 1))} className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <p className="num text-sm font-semibold text-text">{monthLabel}</p>
              <button type="button" aria-label="الشهر السابق" onClick={() => setViewDate(new Date(year, monthIndex - 1, 1))} className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center" dir="ltr">
              {WEEKDAY_LABELS.map((label) => <span key={label} className="py-1 text-xs font-medium text-muted">{label}</span>)}
              {Array.from({ length: firstWeekday }, (_, index) => <span key={`empty-${index}`} aria-hidden="true" />)}
              {Array.from({ length: daysInMonth }, (_, index) => {
                const day = index + 1;
                const iso = formatIsoDate(year, monthIndex, day);
                const selected = iso === selectedIso;
                const unavailable = isOutOfRange(iso, min, max);
                return (
                  <button
                    key={iso}
                    type="button"
                    aria-label={`اختيار ${iso}`}
                    aria-pressed={selected}
                    disabled={unavailable}
                    onClick={() => commitDate(iso)}
                    className={cn(
                      'num h-8 rounded text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                      selected ? 'bg-primary text-primary-foreground' : 'text-text hover:bg-primary-soft hover:text-primary',
                      unavailable && 'cursor-not-allowed opacity-35 hover:bg-transparent hover:text-text'
                    )}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }
);
GregorianDateInput.displayName = 'GregorianDateInput';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    if (type === 'date') return <GregorianDateInput ref={ref} className={className} {...props} />;

    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'h-9 w-full rounded border border-border bg-surface px-3 text-sm text-text placeholder:text-muted',
          'aria-[invalid=true]:border-negative aria-[invalid=true]:focus-visible:ring-negative/25',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50',
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';
