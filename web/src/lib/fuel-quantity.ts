function normalizedDecimal(input: string | number): string {
  return String(input)
    .trim()
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/٫/g, '.')
    .replace(/[,٬\s]/g, '');
}

/** يحوّل لتر المستخدم إلى mL صحيح لعقد API، ويرفض الكسور الأدق من 3 منازل والقيم السالبة. */
export function litersToMilliliters(input: string | number, allowZero = false): number | null {
  const value = normalizedDecimal(input);
  if (!/^\d+(?:\.\d{1,3})?$/.test(value)) return null;

  const [whole, fraction = ''] = value.split('.');
  const result = Number(`${whole}${fraction.padEnd(3, '0')}`);

  return Number.isSafeInteger(result) && (allowZero ? result >= 0 : result > 0) ? result : null;
}

/** صيغة إدخال باللتر من قيمة mL الداخلية دون كشف وحدة التخزين للمستخدم. */
export function millilitersToLiters(value: string | number | null | undefined): string {
  const milliliters = Number(value ?? 0);
  if (!Number.isSafeInteger(milliliters)) return '';

  const negative = milliliters < 0;
  const absolute = Math.abs(milliliters);
  const whole = Math.floor(absolute / 1000);
  const fraction = String(absolute % 1000).padStart(3, '0').replace(/0+$/, '');

  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** صيغة عرض تشغيلية موحّدة للكميات باللتر. */
export function formatLiters(value: string | number | null | undefined, locale?: string): string {
  const liters = Number(value ?? 0);
  if (!Number.isFinite(liters)) return '—';

  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(liters)} L`;
}

export function formatMillilitersAsLiters(value: string | number | null | undefined, locale?: string): string {
  const liters = millilitersToLiters(value);

  return liters === '' ? '—' : formatLiters(liters, locale);
}
