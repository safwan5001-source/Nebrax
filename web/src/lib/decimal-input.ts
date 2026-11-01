/**
 * تطبيع مدخل رقمي عشري من مستخدم (FS-PR14a): يفرّق بين الفاصلة العشرية وفاصل الآلاف بدل حذف كل فاصلة.
 *
 * الخلل الذي يعالجه: `1,5` كانت تُقرأ `15` (الفاصلة تُحذف دائماً) فيتحوّل 1.5 لتر إلى 15 لتراً صامتاً.
 *
 * القواعد (تُرجع `null` عند أي التباس بدل التخمين):
 *  - الأرقام العربية-الهندية → لاتينية؛ `٫` → `.`؛ `٬` و`،` → `,`؛ المسافات (وغير المنفصلة) تُحذف.
 *  - فاصلة واحدة بعدها 1..maxDecimals أرقام ⇒ عشرية (`1,5` = 1.5).
 *  - فاصلة (أو أكثر) بمجموعات من 3 أرقام (`1,234` / `1,234,567`) ⇒ آلاف، **إلا** حين يمكن أن تكون عشرية أيضاً
 *    (فاصلة واحدة وعدد المنازل بعدها = maxDecimals، مثل `1,500` للتر بثلاث منازل): ملتبسة ⇒ `null`.
 *  - اجتماع `.` و`,`: آخرهما العشري والآخر آلاف بمجموعات من 3 (`1,234.56` أو `1.234,56`).
 *  - أي شكل آخر (مجموعات مختلة، فواصل متفرقة) ⇒ `null`.
 *
 * يُرجع نصاً قانونياً بنقطة عشرية وبلا فواصل (`"1234.5"`) أو `null`. لا يتحقق من عدد المنازل الأقصى ولا
 * من الإشارة (مهمة المستدعي).
 */
export function normalizeDecimalInput(input: string | number, maxDecimals: number): string | null {
  let value = String(input)
    .trim()
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/٫/g, '.')
    .replace(/[٬،]/g, ',')
    .replace(/[\s  ]/g, '');
  if (value === '') return null;

  const negative = value.startsWith('-');
  if (negative) value = value.slice(1);
  const sign = negative ? '-' : '';

  const hasDot = value.includes('.');
  const hasComma = value.includes(',');

  if (!hasComma) return /^\d+(?:\.\d+)?$/.test(value) ? sign + value : null;

  if (hasDot) {
    const lastDot = value.lastIndexOf('.');
    const lastComma = value.lastIndexOf(',');
    if (lastDot > lastComma) {
      // 1,234.56 — الفواصل آلاف.
      return /^\d{1,3}(?:,\d{3})+\.\d+$/.test(value) ? sign + value.replace(/,/g, '') : null;
    }
    // 1.234,56 — النقاط آلاف والفاصلة عشرية.
    return /^\d{1,3}(?:\.\d{3})+,\d+$/.test(value) ? sign + value.replace(/\./g, '').replace(',', '.') : null;
  }

  // فواصل فقط.
  const parts = value.split(',');
  if (parts.length === 2) {
    const [whole, fraction] = parts;
    if (!/^\d+$/.test(whole) || !/^\d+$/.test(fraction)) return null;
    const fits = fraction.length >= 1 && fraction.length <= maxDecimals;
    const grouping = fraction.length === 3 && /^\d{1,3}$/.test(whole);
    if (fits && grouping) return null; // 1,500 للتر: 1.500 أم 1500؟ ملتبسة — يكتب المستخدم النقطة صراحةً.
    if (fits) return `${sign}${whole}.${fraction}`;
    if (grouping) return `${sign}${whole}${fraction}`;
    return null;
  }

  // أكثر من فاصلة: آلاف حصراً.
  return /^\d{1,3}(?:,\d{3})+$/.test(value) ? sign + value.replace(/,/g, '') : null;
}
