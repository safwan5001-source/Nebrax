'use client';

import type { Ref } from 'react';
import { useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  ariaLabel?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** اختصار لوحة مفاتيح معلَن وصولياً، مثل `/`. */
  keyShortcuts?: string;
  /** ارتفاع/حشوة الحقل — افتراضي `h-10`. الشاشات الكثيفة تمرّر `h-9` دون تغيير الباقي. */
  inputClassName?: string;
}

export function SearchBar({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
  inputRef,
  keyShortcuts,
  inputClassName,
}: SearchBarProps) {
  const t = useTranslations('nebrax');

  return (
    <div className={cn('relative w-full', className)}>
      <Search
        className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
        strokeWidth={1.7}
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? t('search')}
        aria-keyshortcuts={keyShortcuts}
        autoComplete="off"
        className={cn('h-10 pe-10 ps-9 text-sm', inputClassName)}
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onChange('')}
          aria-label={t('clearSearch')}
          className="absolute end-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted hover:text-text"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.7} />
        </Button>
      ) : null}
    </div>
  );
}
