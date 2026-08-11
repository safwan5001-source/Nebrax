/**
 * حسابات لوحة التحكم — دوال خالصة بلا React ولا شبكة، فتُختبَر مباشرةً.
 *
 * قاعدة المشروع: **الأرقام تصل من الـ API بالريال كنصوص** (التحويل من الهللات
 * يقع في طبقة موارد الـ backend). فكل ما هنا يعمل على نصوص ويُعيد أرقاماً
 * للعرض — ولا يُجري حساباً محاسبياً، إنما يشتقّ ما يُعرض من أرقام مُرحَّلة.
 */

/** يقرأ رقماً من نصّ الـ API بأمان: الفراغ والـ null والنصّ التالف ⇒ صفر. */
export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));

  return Number.isFinite(n) ? n : 0;
}

/**
 * صافي الدخل = الإيراد − المصروف.
 *
 * يُحسب هنا ولا يُقرأ من `net_income` وحده لأن بطاقة «الأداء المالي» تعرض
 * الطرفين معاً: الرقم الرئيسي (المبيعات) والسطر الفرعي (الصافي)، فلا بدّ أن
 * يتّسقا. وحين يُرسل الخادم `net_income` نستعمله — هو مصدر الحقيقة — ونحسبه
 * فقط عند غيابه.
 */
export function netIncome(
  revenue: string | number | null | undefined,
  expense: string | number | null | undefined,
  serverNet?: string | number | null,
): number {
  if (serverNet !== null && serverNet !== undefined && serverNet !== '') {
    return toNumber(serverNet);
  }

  return toNumber(revenue) - toNumber(expense);
}

/**
 * نسبة امتلاء شريط «الإيرادات مقابل المصروفات».
 *
 * المرجع هو **الأكبر** بين الطرفين لا الإيراد وحده: مصروفٌ يتجاوز الإيراد
 * يجب أن يملأ شريطه ويُقصّر شريط الإيراد — لا أن يفيض خارج الإطار.
 */
export function barPercent(value: number, max: number): number {
  if (max <= 0) return 0;

  return Math.min(100, Math.max(0, (value / max) * 100));
}

/** لون الطرف: المصروف أحمر متى وُجد فعلاً، وإلا محايد (لا شريط أحمر بصفر). */
export function expenseTone(expense: number): 'negative' | 'neutral' {
  return expense > 0 ? 'negative' : 'neutral';
}

export interface DatedAmount {
  /** ISO date (YYYY-MM-DD) */
  date: string;
  amount: number;
}

/**
 * سلسلة يومية بعدد ثابت من النقاط، تنتهي عند **أحدث تاريخ في البيانات** لا
 * عند اليوم: بياناتٌ تجريبية أو فترةٌ ماضية يجب أن تُرسم لا أن تظهر خطاً صفرياً.
 *
 * تُعيد مصفوفة بطول `days` مرتّبة من الأقدم إلى الأحدث.
 */
export function dailySeries(rows: DatedAmount[], days = 7): number[] {
  const buckets = new Array(days).fill(0) as number[];

  // تُستبعَد التواريخ التالفة **قبل** حساب الأحدث: `Math.max` مع `NaN` يعطي
  // `NaN`، فصفٌّ واحد تالف كان يُفرغ السلسلة كلّها بدل أن يُتخطّى وحده.
  const stamped = rows
    .map((r) => ({ ts: Date.parse(r.date), amount: r.amount }))
    .filter((r) => Number.isFinite(r.ts));

  if (stamped.length === 0) return buckets;

  const maxTs = stamped.reduce((m, r) => Math.max(m, r.ts), -Infinity);

  for (const row of stamped) {
    const diff = Math.floor((maxTs - row.ts) / 86_400_000);
    if (diff >= 0 && diff < days) buckets[days - 1 - diff] += row.amount;
  }

  return buckets;
}

/**
 * تجميع مبالغ حسب مفتاح — أساس تبويبات رسم المبيعات (منتج/فئة/فرع/بائع).
 * يُعيدها مرتّبةً تنازلياً ومقصوصةً عند `limit`، فيبقى الرسم مقروءاً.
 */
export function groupTop<T>(
  rows: T[],
  keyOf: (row: T) => string | null | undefined,
  amountOf: (row: T) => number,
  limit = 8,
): { key: string; amount: number }[] {
  const totals = new Map<string, number>();

  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue; // بلا مفتاح ⇒ خارج التجميع، لا مجموعة «فارغ» تُشوّش
    totals.set(key, (totals.get(key) ?? 0) + amountOf(row));
  }

  return [...totals.entries()]
    .map(([key, amount]) => ({ key, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}
