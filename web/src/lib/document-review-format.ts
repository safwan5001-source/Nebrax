import { formatMinorRiyal } from '@/lib/money';
import { isMinorAmountField } from '@/lib/document-review';

export function formatReviewValue(key: string, value: string | number | boolean | null): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? '✓' : '—';
  if (typeof value === 'number' && isMinorAmountField(key)) {
    return formatMinorRiyal(value);
  }
  return String(value);
}
