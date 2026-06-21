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

// تحويل مبلغ ريال نصّي ("1000.50") إلى هللات (bigint) — بلا float.
// الـ API يستقبل المبالغ بالهللات.
export function riyalToMinor(input: string | number): number {
  const s = String(input).trim();
  if (!s) return 0;
  const neg = s.startsWith('-');
  const [intPart, decRaw = ''] = s.replace('-', '').split('.');
  const dec = (decRaw + '00').slice(0, 2);
  const minor = (Number(intPart || '0') || 0) * 100 + (Number(dec) || 0);
  return neg ? -minor : minor;
}
