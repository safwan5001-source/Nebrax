/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  تفقيط المبالغ — تحويل رقم (بالوحدات الصغرى) إلى مبلغ مكتوب بالحروف.
 * ═══════════════════════════════════════════════════════════════════════════
 *  يدعم العربية والإنجليزية. المبالغ بالهللات: يُفصل الجزءان (ريالات/هللات)
 *  ويُصاغ كلٌّ بالحروف. النطاق: حتى المليارات (كافٍ لأي مبلغ محاسبي واقعي).
 *  دالة نقيّة بلا حالة — سهلة الاختبار.
 */

import type { CurrencyCode } from '../types';

/** أسماء العملة الرئيسية/الفرعية بالحروف لكل لغة (العربية مفرد ثابت؛ الإنجليزية بصيغتَي مفرد/جمع). */
interface CurrencyWords {
  ar: { major: string; minor: string };
  en: { majorSingular: string; majorPlural: string; minorSingular: string; minorPlural: string };
}

const CURRENCY_WORDS: Partial<Record<CurrencyCode, CurrencyWords>> = {
  SAR: {
    ar: { major: 'ريال', minor: 'هللة' },
    en: { majorSingular: 'Saudi Riyal', majorPlural: 'Saudi Riyals', minorSingular: 'Halala', minorPlural: 'Halalas' },
  },
};

// ─────────────────────────── العربية ───────────────────────────
const AR_ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
  'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const AR_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_HUNDREDS = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];
// المقاييس: [مفرد، مثنى، جمع] لكلٍّ من ألف/مليون/مليار.
const AR_SCALES: Array<[string, string, string]> = [
  ['', '', ''],
  ['ألف', 'ألفان', 'آلاف'],
  ['مليون', 'مليونان', 'ملايين'],
  ['مليار', 'ملياران', 'مليارات'],
];

/** يصوغ مجموعة (1..999) بالحروف العربية. */
function arGroup(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rem = n % 100;
  if (h > 0) parts.push(AR_HUNDREDS[h]);
  if (rem > 0) {
    if (rem < 20) parts.push(AR_ONES[rem]);
    else {
      const t = Math.floor(rem / 10);
      const o = rem % 10;
      parts.push(o > 0 ? `${AR_ONES[o]} و${AR_TENS[t]}` : AR_TENS[t]);
    }
  }
  return parts.join(' و');
}

/** يصوغ مقياس مجموعة (ألف/مليون/مليار) مع الصيغة الصرفية الصحيحة. */
function arScale(group: number, scaleIdx: number): string {
  if (scaleIdx === 0 || group === 0) return arGroup(group);
  const [singular, dual, plural] = AR_SCALES[scaleIdx];
  if (group === 1) return singular;
  if (group === 2) return dual;
  if (group >= 3 && group <= 10) return `${arGroup(group)} ${plural}`;
  return `${arGroup(group)} ${singular}`;
}

/** رقم صحيح (≥0) إلى حروف عربية. */
export function numberToArabicWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'صفر';
  const groups: number[] = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    parts.push(arScale(groups[i], i));
  }
  return parts.join(' و');
}

// ─────────────────────────── الإنجليزية ───────────────────────────
const EN_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES = ['', 'thousand', 'million', 'billion'];

function enGroup(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rem = n % 100;
  if (h > 0) parts.push(`${EN_ONES[h]} hundred`);
  if (rem > 0) {
    if (rem < 20) parts.push(EN_ONES[rem]);
    else {
      const t = Math.floor(rem / 10);
      const o = rem % 10;
      parts.push(o > 0 ? `${EN_TENS[t]}-${EN_ONES[o]}` : EN_TENS[t]);
    }
  }
  return parts.join(' ');
}

/** رقم صحيح (≥0) إلى حروف إنجليزية. */
export function numberToEnglishWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'zero';
  const groups: number[] = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    const scale = EN_SCALES[i] ? ` ${EN_SCALES[i]}` : '';
    parts.push(`${enGroup(groups[i])}${scale}`);
  }
  return parts.join(' ');
}

/**
 * يفقّط مبلغاً بالوحدات الصغرى (هللات) إلى جملة بالحروف حسب اللغة والعملة.
 * مثال (SAR, ar): 115050 → «مئة وخمسة عشر ريالاً وخمسون هللة فقط لا غير».
 */
export function amountToWords(minor: number, currency: CurrencyCode, locale: 'ar' | 'en'): string {
  const words = CURRENCY_WORDS[currency] ?? CURRENCY_WORDS.SAR!;
  const total = Math.floor(Math.abs(minor));
  const major = Math.floor(total / 100);
  const cents = total % 100;

  if (locale === 'ar') {
    const majorPart = `${numberToArabicWords(major)} ${words.ar.major}`;
    const minorPart = cents > 0 ? ` و${numberToArabicWords(cents)} ${words.ar.minor}` : '';
    return `${majorPart}${minorPart} فقط لا غير`;
  }

  const majorName = major === 1 ? words.en.majorSingular : words.en.majorPlural;
  const majorPart = `${numberToEnglishWords(major)} ${majorName}`;
  const minorName = cents === 1 ? words.en.minorSingular : words.en.minorPlural;
  const minorPart = cents > 0 ? ` and ${numberToEnglishWords(cents)} ${minorName}` : '';
  return `${majorPart}${minorPart} only`;
}
