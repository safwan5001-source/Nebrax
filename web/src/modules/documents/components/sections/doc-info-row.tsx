import { cn } from '@/lib/utils';

/** صفّ «تسمية: قيمة» داخل بطاقات المستند. لا يُعرض حين القيمة فارغة. */
export function DocInfoRow({
  label,
  value,
  stacked = false,
  align = 'start',
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  stacked?: boolean;
  align?: 'start' | 'end';
}) {
  if (value === null || value === undefined || value === '') return null;
  const alignClass = align === 'end' ? 'items-end text-end' : 'items-start';
  return (
    <div className={stacked ? cn('flex flex-col gap-0.5 py-0.5', alignClass) : 'flex items-start justify-between gap-3 py-0.5'}>
      <span data-doc-info-label className="shrink-0 text-muted">{label}</span>
      <span data-doc-info-value className={stacked ? 'min-w-0 break-words font-medium text-text' : 'min-w-0 break-words text-end font-medium text-text'}>{value}</span>
    </div>
  );
}
