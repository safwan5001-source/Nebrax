// الـ API يعيد المبالغ بالريال كنص ("1150.00"). نعرضها بفواصل آلاف + رمز ﷼.
// (التحويل من الهللات يتم في طبقة الـ API؛ هنا تنسيق العرض فقط.)
const formatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatRiyal(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '—'; // لا نعرض "NaN ﷼" عند قيمة شاذة
  return `${formatter.format(n)} ﷼`;
}

// تنسيق مختصر بلا أصفار عشرية زائدة (للأرقام العنوانية كمؤشرات اللوحة):
// 482500 → "482,500 ﷼"، 1150.50 → "1,150.50 ﷼". الجداول والفواتير تبقى بفاصلتين.
const shortFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatRiyalShort(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return `${shortFormatter.format(n)} ﷼`;
}

export function isNegative(value: string | number | null | undefined): boolean {
  return Number(value ?? 0) < 0;
}

// تحويل مبلغ ريال نصّي ("1000.50") إلى هللات — أعداد صحيحة بلا float.
// يطبّع الأرقام العربية-الهندية ويتسامح مع فواصل الآلاف، ويرفض أي مدخل مشوّه
// بإرجاع NaN (بدل تحويله صمتاً إلى 0 أو مبلغ خاطئ) — الـ API يستقبل المبالغ بالهللات.
export function riyalToMinor(input: string | number): number {
  let s = String(input).trim();
  if (!s) return 0;

  // تطبيع: أرقام عربية-هندية → لاتينية، فاصلة عشرية عربية → نقطة، إزالة فواصل الآلاف والمسافات
  s = s
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٫]/g, '.')
    .replace(/[,٬\s]/g, '');

  if (!/^-?\d+(\.\d{1,2})?$/.test(s) || s.replace('-', '').replace('.', '').length > 15) {
    return NaN; // مدخل مشوّه أو أكبر من النطاق الآمن — على النموذج رفضه لا إرساله
  }

  const neg = s.startsWith('-');
  const [intPart, decRaw = ''] = s.replace('-', '').split('.');
  const dec = (decRaw + '00').slice(0, 2);
  const minor = parseInt(intPart || '0', 10) * 100 + parseInt(dec, 10);
  return neg ? -minor : minor;
}

// صلاحية مدخل مبلغ: يقبله riyalToMinor دون رفض.
export function isValidRiyal(input: string | number): boolean {
  return Number.isFinite(riyalToMinor(input));
}

// استخراج ضريبة متضمَّنة من مبلغ إجمالي (شامل الضريبة) — بالهللات.
// يطابق صيغة الـ backend حرفياً: round(gross × rate ÷ (100+rate))
// عبر intdiv(2·g·r + denom, 2·denom) — فتتّسق أرقام الواجهة مع الترحيل.
export function extractInclusiveTax(grossMinor: number, rate: number): number {
  if (rate <= 0 || grossMinor <= 0) return 0;
  const denom = 100 + rate;
  return Math.floor((2 * grossMinor * rate + denom) / (2 * denom));
}
