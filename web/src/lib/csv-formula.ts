// تحييد صيغ الجداول عند التصدير فقط. لا يغيّر القيمة المخزّنة ولا `toCsv` المشترك.
import { toCsv } from '@/lib/export';

/** رقم اختياري الإشارة، بلا مسافات، وبفاصلة عشرية واحدة على الأكثر. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * يسبق خلايا النص التي قد يقرأها Excel كصيغة بعلامة اقتباس واحدة.
 * المسافات البادئة لا تخفي بادئة `= + - @` أو جدولة أو إرجاع سطر.
 * الرقم السالب الحقيقي (`-10.50`) يبقى رقماً بلا بادئة.
 */
export function spreadsheetCell(value: string | number | null | undefined): string | number {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (PLAIN_NUMBER.test(value)) return value;

  const probe = value.replace(/^[ ]+/, '');
  if (/^[=+\-@\t\r]/.test(probe)) return `'${value}`;
  return value;
}

/** يحيّد الصيغ أولاً ثم يسلّم التهريب الحالي للفواصل والاقتباس والأسطر. */
export function formulaSafeCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  return toCsv(
    headers.map((header) => String(spreadsheetCell(header))),
    rows.map((row) => row.map((cell) => spreadsheetCell(cell))),
  );
}
