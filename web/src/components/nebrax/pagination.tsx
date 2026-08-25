'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { displayLocale } from '@/lib/formatting';
import { cn } from '@/lib/utils';

const DEFAULT_PER_PAGE_OPTIONS = [25, 50, 100];

/**
 * تذييل نتائج موحّد: موضع الصفحة، حجم الصفحة، ثم التنقّل.
 *
 * الأسهم منطقية لا جغرافية: `rtl:rotate-180` يجعل «السابق» يشير للخلف في
 * العربية وللخلف نفسها في الإنجليزية، فلا تنقلب دلالة الزر بانقلاب الاتجاه.
 */
export function Pagination({
  page,
  lastPage,
  perPage,
  total,
  onPageChange,
  onPerPageChange,
  perPageOptions = DEFAULT_PER_PAGE_OPTIONS,
  disabled = false,
  className,
}: {
  page: number;
  lastPage: number;
  perPage: number;
  /** إجمالي السجلات — يُعرض قبل موضع الصفحة حين يكون معروفاً. */
  total?: number;
  onPageChange: (page: number) => void;
  onPerPageChange?: (perPage: number) => void;
  perPageOptions?: number[];
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations('nebrax');
  const locale = useLocale();
  const safeLastPage = Math.max(1, lastPage);
  const safePage = Math.min(Math.max(1, page), safeLastPage);

  // كما في `ListToolbar`: الأرقام تُنسَّق بلغة الواجهة وتُمرَّر إلى ICU نصوصاً.
  const num = (value: number) => value.toLocaleString(displayLocale(locale));
  const mono = (chunks: React.ReactNode) => <span className="num">{chunks}</span>;

  return (
    <nav
      aria-label={t('resultsNavigation')}
      className={cn('flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between', className)}
    >
      <p className="text-xs text-muted" aria-live="polite">
        {typeof total === 'number' ? (
          <>
            {t.rich('resultCount', { n: total, count: num(total), num: mono })}
            {' · '}
          </>
        ) : null}
        {t.rich('pagePosition', { page: num(safePage), lastPage: num(safeLastPage), num: mono })}
      </p>

      <div className="flex items-center gap-2">
        {onPerPageChange ? (
          <Select
            value={String(perPage)}
            onChange={(event) => onPerPageChange(Number(event.target.value))}
            aria-label={t('perPage')}
            className="h-10 w-24 bg-surface text-sm sm:h-9"
          >
            {perPageOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t('previousPage')}
          className="h-10 w-10 sm:h-9 sm:w-9"
          disabled={disabled || safePage <= 1}
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
        >
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.7} aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t('nextPage')}
          className="h-10 w-10 sm:h-9 sm:w-9"
          disabled={disabled || safePage >= safeLastPage}
          onClick={() => onPageChange(Math.min(safeLastPage, safePage + 1))}
        >
          <ChevronRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.7} aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
