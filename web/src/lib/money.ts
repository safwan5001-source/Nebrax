// الـ API يعيد المبالغ بالريال كنص ("1150.00"). نعرضها بفواصل آلاف + رمز ﷼.
// (التحويل من الهللات يتم في طبقة الـ API؛ هنا تنسيق العرض فقط.)
const formatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatRiyal(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return `${formatter.format(n)} ﷼`;
}

export function isNegative(value: string | number | null | undefined): boolean {
  return Number(value ?? 0) < 0;
}
