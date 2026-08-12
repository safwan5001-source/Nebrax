'use client';

import * as React from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ComboOption { value: string; label: string; hint?: string }

/**
 * ═══════════════════════════════════════════════════════════════
 *  Combobox — منتقٍ ببحث
 * ═══════════════════════════════════════════════════════════════
 *  `<select>` الأصلي يكفي لعشرة خيارات ويعجز عن ثلاثمئة مورّد: لا بحث فيه،
 *  والتمرير الطويل على الجوال يجعل الاختيار أبطأ من الكتابة.
 *
 *  مبنيّ على زرّ وقائمة `role="listbox"` حقيقيَّين: يعملان بلوحة المفاتيح
 *  (↑↓ · Enter · Esc)، ويُغلقان بالنقر خارجهما، ويعلنان الحالة لقارئ الشاشة.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  id,
  disabled,
  className,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q)
    );
  }, [options, query]);

  // الإغلاق بالنقر خارج المكوّن — لا طبقة حاجبة تمنع بقية الصفحة.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as globalThis.Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  React.useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // التركيز بعد الرسم — قبله لا يوجد الحقل بعد.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  function pick(option: ComboOption) {
    onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, filtered.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter' && filtered[active]) { e.preventDefault(); pick(filtered[active]); }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded border border-border bg-surface px-3 text-sm outline-none transition-colors',
          'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40',
          'disabled:cursor-not-allowed disabled:opacity-50',
          selected ? 'text-text' : 'text-muted'
        )}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded border border-border bg-surface shadow-lg">
          <div className="flex items-center gap-2 border-b border-border px-2.5">
            <Search className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              className="h-9 w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
            />
          </div>

          <ul role="listbox" className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-center text-xs text-muted">{emptyText}</li>
            ) : (
              filtered.map((option, i) => (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(option)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-start text-sm transition-colors',
                      i === active ? 'bg-primary-soft' : 'bg-transparent',
                      option.value === value ? 'text-primary' : 'text-text'
                    )}
                  >
                    <Check className={cn('h-3.5 w-3.5 shrink-0', option.value === value ? 'opacity-100' : 'opacity-0')} strokeWidth={2} />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.hint && <span className="num shrink-0 text-xs text-muted">{option.hint}</span>}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
