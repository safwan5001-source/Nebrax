import { allCountries, callingCodeOf, mainCountryFor, type CountryCode } from './phone';
import { toEnglishDigits } from './digits';

export interface PhoneCountry {
  code: CountryCode;
  /** رمز الاتصال بلا + (أرقام إنجليزية). */
  dial: string;
  nameAr: string;
  nameEn: string;
  /** اسم العرض بلغة الواجهة. */
  name: string;
  /** نص البحث المطبَّع (عربي + إنجليزي + رمز + مفتاح). */
  haystack: string;
}

/** تطبيع عربي للبحث: بلا تشكيل/تطويل، وتوحيد الألف والياء والتاء المربوطة. */
export function normalizeSearch(input: string): string {
  return toEnglishDigits(input)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[ً-ٰٟـ̀-ͯ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}+ ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function regionNames(locale: string): (code: string) => string {
  try {
    const dn = new Intl.DisplayNames([locale], { type: 'region' });
    return (code) => dn.of(code) ?? code;
  } catch {
    return (code) => code;
  }
}

const cache = new Map<string, PhoneCountry[]>();

/** قائمة الدول مرتبة بالاسم حسب لغة الواجهة. الأسماء من Intl (لا قائمة يدوية). */
export function phoneCountries(locale: 'ar' | 'en'): PhoneCountry[] {
  const hit = cache.get(locale);
  if (hit) return hit;
  const ar = regionNames('ar');
  const en = regionNames('en');
  const list = allCountries().map((code): PhoneCountry => {
    const nameAr = ar(code);
    const nameEn = en(code);
    const dial = callingCodeOf(code);
    return {
      code,
      dial,
      nameAr,
      nameEn,
      name: locale === 'ar' ? nameAr : nameEn,
      haystack: normalizeSearch(`${nameAr} ${nameEn} ${code} +${dial} ${dial}`),
    };
  });
  list.sort((a, b) => a.name.localeCompare(b.name, locale));
  cache.set(locale, list);
  return list;
}

/**
 * بحث بالاسم (عربي أو إنجليزي) أو برمز الدولة ISO أو بمفتاح الاتصال (+966 / 966 / 00966 / ٩٦٦).
 * الأولوية: تطابق الاسم تاماً ← رمز ISO ← بداية الاسم ← بداية كلمة فيه ← احتواء الاسم. ومفتاح الاتصال التام قبل الجزئي.
 */
export function searchCountries(list: PhoneCountry[], query: string): PhoneCountry[] {
  const q = normalizeSearch(query);
  if (!q) return list;
  const dialQuery = q.replace(/^(\+|00)/, '');
  if (/^\d+$/.test(dialQuery) && dialQuery.length > 0) {
    const byDial = list.filter((c) => c.dial.startsWith(dialQuery));
    // مفتاح مشترك (+1 …): الدولة الرئيسية للمفتاح أولاً ثم بقية أصحابه بالترتيب الأبجدي.
    const main = mainCountryFor(dialQuery);
    const exact = byDial.filter((c) => c.dial === dialQuery).sort((a, b) => Number(b.code === main) - Number(a.code === main));
    return [...exact, ...byDial.filter((c) => c.dial !== dialQuery)];
  }
  const scored: Array<{ c: PhoneCountry; score: number }> = [];
  for (const c of list) {
    const names = [normalizeSearch(c.nameAr), normalizeSearch(c.nameEn)];
    let score = -1;
    if (names.includes(q)) score = 0;
    else if (c.code.toLowerCase() === q) score = 1;
    else if (names.some((n) => n.startsWith(q))) score = 2;
    else if (names.some((n) => n.split(' ').some((w) => w.startsWith(q)))) score = 3;
    else if (c.haystack.includes(q)) score = 4;
    if (score >= 0) scored.push({ c, score });
  }
  // الفرز مستقر: داخل الدرجة الواحدة يبقى ترتيب الأبجدية.
  return scored.sort((a, b) => a.score - b.score).map((x) => x.c);
}
