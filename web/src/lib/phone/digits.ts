/**
 * تطبيع الأرقام — مصدر واحد لقاعدة «أرقام إنجليزية 0–9 فقط» في حقول الهاتف.
 *
 * التحويل **فعليّ على القيمة** (لا تنسيق CSS): الأرقام العربية الهندية ٠–٩ والفارسية ۰–۹
 * والأرقام ذات العرض الكامل ０–９ تُحوَّل إلى 0–9 عند الكتابة واللصق والبحث، فلا تُخزَّن
 * ولا تُرسَل إلا إنجليزية.
 */

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;
const FULLWIDTH_ZERO = 0xff10;

/** يحوّل كل رقم عربي/فارسي/عريض إلى 0–9 ويترك ما عداه كما هو. */
export function toEnglishDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) out += String(code - ARABIC_INDIC_ZERO);
    else if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) out += String(code - EXTENDED_ARABIC_INDIC_ZERO);
    else if (code >= FULLWIDTH_ZERO && code <= FULLWIDTH_ZERO + 9) out += String(code - FULLWIDTH_ZERO);
    else out += ch;
  }
  return out;
}

/** علامات الاتجاه غير المرئية التي يلصقها النسخ من واجهات RTL مع الأرقام. */
const BIDI_MARKS = /[‎‏؜‪-‮⁦-⁩​﻿]/g;

/** كل ما عدا 0–9 يُحذف (بعد تحويل الأرقام العربية والفارسية). */
export function digitsOnly(input: string): string {
  return toEnglishDigits(input).replace(/\D+/g, '');
}

/**
 * يطبّع نصاً مُدخلاً/ملصوقاً في حقل هاتف: أرقام إنجليزية، بلا مسافات أو فواصل أو أقواس
 * أو علامات اتجاه، مع الإبقاء على `+` البادئة فقط (أو تحويل `00` البادئة إلى `+`).
 */
export function normalizePhoneText(input: string): string {
  const cleaned = toEnglishDigits(input).replace(BIDI_MARKS, '').trim();
  // «＋» العريضة و«٠٠» (بعد التحويل 00) تعني «+» الدولية.
  const international = /^[+＋]/.test(cleaned) || /^\s*00(?!$)/.test(cleaned.replace(/[\s\-().]/g, ''));
  const digits = cleaned.replace(/\D+/g, '');
  if (!international) return digits;
  return '+' + (/^[+＋]/.test(cleaned) ? digits : digits.replace(/^00/, ''));
}
