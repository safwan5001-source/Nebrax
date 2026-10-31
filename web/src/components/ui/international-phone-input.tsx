'use client';

import * as React from 'react';
import { Check, ChevronDown, Globe, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { digitsOnly, normalizePhoneText } from '@/lib/phone/digits';
import { phoneCountries, searchCountries, type PhoneCountry } from '@/lib/phone/countries';
import {
  DEFAULT_COUNTRY,
  E164_MAX_DIGITS,
  callingCodeOf,
  displayNational,
  exampleNational,
  fromE164,
  splitInternational,
  toE164,
  type CountryCode,
} from '@/lib/phone/phone';

/**
 * ═══════════════════════════════════════════════════════════════
 *  InternationalPhoneInput — حقل هاتف دولي قابل لإعادة الاستخدام
 * ═══════════════════════════════════════════════════════════════
 *  القيمة (`value`/`onChange`) نصّ E.164 دائماً («+9665XXXXXXXX») أو '' — لا كائن ولا بادئة
 *  تُضاف عند الإرسال. الدولة المختارة حالةٌ داخلية للعرض فقط.
 *
 *  القاعدة الصلبة: كل ما يُعرض ويُعالَج ويُحفَظ هنا أرقامٌ إنجليزية 0–9 — يُحوَّل العربي والفارسي
 *  فعلياً عند الكتابة واللصق والبحث (`@/lib/phone/digits`)، والعرض `dir="ltr"` دائماً.
 *
 *  لوحة الدول `role="listbox"` ببحث (`role="combobox"`) تعمل بلوحة المفاتيح (↑↓ Home End Enter Esc)
 *  وتُغلق بالنقر خارجها. الأعلام SVG حقيقية من `/flags` (country-flag-icons، MIT).
 */

export interface InternationalPhoneInputProps {
  id: string;
  /** رقم E.164 أو ''. */
  value: string;
  onChange: (e164: string) => void;
  onBlur?: () => void;
  name?: string;
  disabled?: boolean;
  invalid?: boolean;
  defaultCountry?: CountryCode;
  'aria-describedby'?: string;
  className?: string;
}

function Flag({ code, className }: { code: string; className?: string }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) {
    return (
      <span className={cn('inline-flex aspect-[3/2] w-7 shrink-0 items-center justify-center rounded-[3px] bg-border text-muted', className)} aria-hidden="true">
        <Globe className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <img
      src={`/flags/${code}.svg`}
      alt=""
      width={28}
      height={19}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      data-flag={code}
      className={cn('aspect-[3/2] w-7 shrink-0 rounded-[3px] bg-border object-contain shadow-[0_0_0_1px_var(--border)]', className)}
    />
  );
}

export function InternationalPhoneInput({
  id,
  value,
  onChange,
  onBlur,
  name,
  disabled,
  invalid,
  defaultCountry = DEFAULT_COUNTRY,
  'aria-describedby': describedBy,
  className,
}: InternationalPhoneInputProps) {
  const t = useTranslations('phoneInput');
  const locale = useLocale() === 'en' ? 'en' : 'ar';
  const countries = React.useMemo(() => phoneCountries(locale), [locale]);

  const initial = React.useMemo(() => fromE164(value), []);
  const [country, setCountry] = React.useState<CountryCode>(initial?.country ?? defaultCountry);
  const [national, setNational] = React.useState(initial?.national ?? '');
  const [keptNote, setKeptNote] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);

  const lastEmitted = React.useRef(value);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const listId = `${id}-countries`;

  // قيمة خارجية جديدة (إعادة ضبط النموذج أو تحميل بيانات) تُعاد إلى الحالة الداخلية.
  React.useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    const next = fromE164(value);
    if (next) {
      setCountry(next.country);
      setNational(next.national);
    } else if (!value) {
      setNational('');
    }
  }, [value]);

  const emit = React.useCallback(
    (nextCountry: CountryCode, nextNational: string) => {
      const e164 = toE164(nextNational, nextCountry);
      lastEmitted.current = e164;
      onChange(e164);
    },
    [onChange],
  );

  const cc = callingCodeOf(country);
  const maxNational = E164_MAX_DIGITS - cc.length;
  const selected = countries.find((c) => c.code === country);
  const placeholder = React.useMemo(() => exampleNational(country), [country]);

  function handleNationalChange(raw: string) {
    setKeptNote(false);
    const text = normalizePhoneText(raw);
    if (text.startsWith('+')) {
      // لصق/كتابة رقم دولي: تُحدَّد الدولة من رمزه ويبقى الحقل رقماً وطنياً بلا تكرار للمفتاح.
      const split = splitInternational(text, country);
      if (split) {
        setCountry(split.country);
        setNational(split.national);
        emit(split.country, split.national);
        return;
      }
      // «+» وحدها أو رمز غير معروف: لا تغيير في الحقل.
      if (text.length <= 1) {
        setNational('');
        emit(country, '');
      }
      return;
    }
    const allDigits = digitsOnly(text);
    // الصفر البادئ بادئة وطنية (05…) لا يُحتسب من طول E.164.
    const digits = allDigits.slice(0, allDigits.startsWith('0') ? maxNational + 1 : maxNational);
    const shown = displayNational(digits, country);
    setNational(shown);
    emit(country, shown);
  }

  function chooseCountry(next: PhoneCountry) {
    setOpen(false);
    setQuery('');
    if (next.code !== country) {
      setCountry(next.code);
      const kept = digitsOnly(national);
      const trimmed = kept.slice(0, E164_MAX_DIGITS - next.dial.length + (kept.startsWith('0') ? 1 : 0));
      setNational(trimmed);
      emit(next.code, trimmed);
      setKeptNote(trimmed.length > 0);
    }
    inputRef.current?.focus();
  }

  const filtered = React.useMemo(() => searchCountries(countries, query), [countries, query]);

  function openList() {
    if (disabled) return;
    setQuery('');
    const idx = countries.findIndex((c) => c.code === country);
    setActive(Math.max(idx, 0));
    setOpen(true);
  }

  function closeList(restoreFocus = true) {
    setOpen(false);
    setQuery('');
    if (restoreFocus) triggerRef.current?.focus();
  }

  // الفتح: لوحة المفاتيح تُفتح تلقائياً مع المؤشر الدقيق فقط (لا تغطي القائمة على الجوال).
  React.useEffect(() => {
    if (!open) return;
    const finePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches;
    if (finePointer) searchRef.current?.focus();
  }, [open]);

  // الصف النشط يبقى ظاهراً.
  React.useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, filtered]);

  // النقر/اللمس خارج الحقل يغلق القائمة.
  React.useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closeList(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, [open]);

  function onSearchKeyDown(e: React.KeyboardEvent) {
    const last = filtered.length - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, last));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(last, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = filtered[active];
      if (pick) chooseCountry(pick);
    } else if (e.key === 'Tab') {
      closeList(false);
    }
  }

  const activeOptionId = open && filtered[active] ? `${id}-opt-${filtered[active].code}` : undefined;
  const triggerLabel = `${t('country_label')}: ${selected?.name ?? country}, +${cc}`;

  return (
    <div
      ref={rootRef}
      className={cn('relative min-w-0', className)}
      onKeyDown={(e) => {
        // Escape يغلق القائمة أينما كان التركيز (الزر أو البحث أو القائمة) دون أن يُغلق حواراً يحتويها.
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          e.stopPropagation();
          closeList();
        }
      }}
    >
      <div data-invalid={invalid || undefined} className="ax-affix flex" dir="ltr">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          onClick={() => (open ? closeList(false) : openList())}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && !open) {
              e.preventDefault();
              openList();
            }
          }}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={triggerLabel}
          data-testid="phone-country-trigger"
          className="flex min-h-11 shrink-0 items-center gap-2 border-e border-border bg-transparent px-2.5 text-sm text-text transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Flag code={country} />
          <span className="num w-[3.25rem] text-start font-semibold" data-testid="phone-dial-code">+{cc}</span>
          <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>
        <input
          ref={inputRef}
          id={id}
          name={name}
          dir="ltr"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          disabled={disabled}
          value={national}
          onChange={(e) => handleNationalChange(e.target.value)}
          onBlur={onBlur}
          onPaste={(e) => {
            // اللصق يمرّ بالتطبيع نفسه حتى لو حمل أرقاماً عربية أو + أو مسافات.
            const text = e.clipboardData.getData('text');
            if (!text) return;
            e.preventDefault();
            handleNationalChange(text);
          }}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="num h-full w-full min-w-0 flex-1 bg-transparent px-3 text-text placeholder:text-muted focus:outline-none"
        />
      </div>

      {keptNote ? (
        <p className="mt-1.5 text-xs text-muted" role="status" data-testid="phone-kept-note">
          {t('kept_note')}
        </p>
      ) : null}

      {open ? (
        <div className="absolute inset-x-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-border bg-surface shadow-lg" data-testid="phone-country-panel">
          <div className="relative border-b border-border p-2">
            <Search className="pointer-events-none absolute start-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              dir="auto"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder={t('search_placeholder')}
              aria-label={t('search_label')}
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={activeOptionId}
              aria-autocomplete="list"
              className="h-11 w-full rounded-lg border border-border bg-background ps-9 pe-3 text-base text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label={t('country_label')} className="max-h-64 overflow-y-auto overscroll-contain py-1">
            {filtered.length === 0 ? (
              <li role="presentation" className="px-3 py-6 text-center text-sm text-muted">
                {t('empty')}
              </li>
            ) : (
              filtered.map((c, i) => {
                const isSelected = c.code === country;
                return (
                  <li
                    key={c.code}
                    id={`${id}-opt-${c.code}`}
                    role="option"
                    aria-selected={isSelected}
                    data-active={i === active || undefined}
                    data-country={c.code}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => chooseCountry(c)}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm text-text',
                      i === active && 'bg-background',
                      isSelected && 'font-semibold',
                    )}
                  >
                    <Flag code={c.code} />
                    <span className="min-w-0 flex-1 truncate" dir="auto">{c.name}</span>
                    <span className="num shrink-0 text-muted" dir="ltr">+{c.dial}</span>
                    {isSelected ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : <span className="w-4 shrink-0" aria-hidden="true" />}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
