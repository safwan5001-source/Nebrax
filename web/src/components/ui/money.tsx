import { cn } from '@/lib/utils';
import { formatRiyalParts } from '@/lib/money';

/**
 * عرض مبلغ ريال — نفس قيمة `formatRiyal` حرفياً (انظر `formatRiyalParts` في
 * `lib/money.ts`)، مع تمييز بصري اختياري بين الجزء الصحيح والعشري تحت بوابة v3
 * (`data-awj-money-integer` / `data-awj-money-decimal`، مُعرَّفة في globals.css).
 *
 * بلا بوابة: نص عادي مطابق لـ`formatRiyal(value)` بالضبط — لا تغيير بصري ولا
 * حسابي. هذا مكوّن عرض فقط؛ لا يمسّ التقريب أو وحدات الهللة أو القيم المخزَّنة.
 *
 * design-system/v3/FOUNDATIONS.md §5: لا حركة على الأرقام المالية (قاعدة ٨)،
 * والإشارة داخل عزل LTR للجزء الصحيح لا خارجه (قاعدة ٥).
 */
export function Money({
  value,
  className,
}: {
  value: string | number | null | undefined;
  className?: string;
}) {
  const parts = formatRiyalParts(value);

  if (parts.invalid) {
    return <span className={cn('num', className)}>—</span>;
  }

  return (
    <span className={cn('num', className)} dir="ltr" style={{ unicodeBidi: 'isolate' }}>
      {parts.negative && <span data-awj-money-negative="">-</span>}
      <span data-awj-money-integer="">{parts.integer}</span>
      <span data-awj-money-decimal="">.{parts.fraction}</span>
      {' '}
      {parts.symbol}
    </span>
  );
}
