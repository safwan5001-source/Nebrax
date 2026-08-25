'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ARABIC_DISPLAY_LOCALE } from '@/lib/formatting';
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
  totalUnit,
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
  totalUnit?: string;
  onPageChange: (page: number) => void;
  onPerPageChange?: (perPage: number) => void;
  perPageOptions?: number[];
  disabled?: boolean;
  className?: string;
}) {
  const safeLastPage = Math.max(1, lastPage);
  const safePage = Math.min(Math.max(1, page), safeLastPage);
  const num = (value: number) => value.toLocaleString(ARABIC_DISPLAY_LOCALE);

  return (
    <nav
      aria-label="تنقّل النتائج"
      className={cn('flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between', className)}
    >
      <p className="text-xs text-muted" aria-live="polite">
        {typeof total === 'number' ? (
          <>
            <span className="num">{num(total)}</span>
            {totalUnit ? ` ${totalUnit}` : ''} ·{' '}
          </>
        ) : null}
        صفحة <span className="num">{num(safePage)}</span> من <span className="num">{num(safeLastPage)}</span>
      </p>

      <div className="flex items-center gap-2">
        {onPerPageChange ? (
          <Select
            value={String(perPage)}
            onChange={(event) => onPerPageChange(Number(event.target.value))}
            aria-label="عدد النتائج في الصفحة"
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
          aria-label="الصفحة السابقة"
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
          aria-label="الصفحة التالية"
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
