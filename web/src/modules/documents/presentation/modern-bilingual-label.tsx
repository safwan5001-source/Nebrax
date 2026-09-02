import { cn } from '@/lib/utils';
import {
  MODERN_COLUMN_LABELS,
  MODERN_FIELD_LABELS,
  MODERN_STATUS_LABELS,
  MODERN_TOTAL_LABELS,
  isModernMoneyColumn,
  modernCurrencyUnit,
  type DocumentLabelMode,
} from './visual-v2';
import type { DocItemsColumnId } from '../types';

/**
 * تسمية Modern ثنائية معزولة اتجاهياً.
 * لا تُدرج أحرف Bidi في النصوص؛ العزل عبر عناصر dir.
 * يُستخدم في تركيب modern فقط.
 */
export function ModernBilingualLabel({
  ar,
  en,
  mode,
  unit,
  className,
}: {
  ar: string;
  en: string;
  mode: DocumentLabelMode;
  unit?: string;
  className?: string;
}) {
  const a = ar.trim();
  const e = en.trim();
  const withUnit = (text: string) => (unit ? `${text} (${unit})` : text);

  if (mode === 'ar') return <span className={className}>{withUnit(a)}</span>;
  if (mode === 'en') return <span className={className}>{withUnit(e)}</span>;
  if (!a) return <span className={className} dir="ltr">{withUnit(e)}</span>;
  if (!e || a === e) return <span className={className}>{withUnit(a)}</span>;

  return (
    <span className={cn('inline-flex flex-col leading-tight', className)} data-modern-bilingual="label">
      <span dir="rtl">{a}</span>
      <span dir="ltr">{withUnit(e)}</span>
    </span>
  );
}

export function ModernFieldLabel({
  field,
  mode,
  className,
}: {
  field: keyof typeof MODERN_FIELD_LABELS;
  mode: DocumentLabelMode;
  className?: string;
}) {
  const pair = MODERN_FIELD_LABELS[field];
  return <ModernBilingualLabel ar={pair.ar} en={pair.en} mode={mode} className={className} />;
}

export function ModernColumnHeader({
  column,
  mode,
  currency,
}: {
  column: DocItemsColumnId;
  mode: DocumentLabelMode;
  currency: string;
}) {
  const pair = MODERN_COLUMN_LABELS[column];
  const unit = isModernMoneyColumn(column) ? modernCurrencyUnit(currency, mode) : undefined;
  return <ModernBilingualLabel ar={pair.ar} en={pair.en} mode={mode} unit={unit} />;
}

export function ModernTotalLabel({
  field,
  mode,
}: {
  field: keyof typeof MODERN_TOTAL_LABELS;
  mode: DocumentLabelMode;
}) {
  const pair = MODERN_TOTAL_LABELS[field];
  return <ModernBilingualLabel ar={pair.ar} en={pair.en} mode={mode} />;
}

export function ModernStatusLabel({
  status,
  mode,
}: {
  status: keyof typeof MODERN_STATUS_LABELS;
  mode: DocumentLabelMode;
}) {
  const pair = MODERN_STATUS_LABELS[status];
  return <ModernBilingualLabel ar={pair.ar} en={pair.en} mode={mode} />;
}

/** عنوان المستند من ترجمة الواجهة الحالية + البديل، عربياً أولاً في الثنائي. */
export function ModernDocumentTitle({
  locale,
  primary,
  alternate,
  mode,
}: {
  locale: string;
  primary: string;
  alternate: string;
  mode: DocumentLabelMode;
}) {
  const isAr = locale.toLowerCase().startsWith('ar');
  const ar = isAr ? primary : alternate;
  const en = isAr ? alternate : primary;
  return <ModernBilingualLabel ar={ar} en={en} mode={mode} />;
}
