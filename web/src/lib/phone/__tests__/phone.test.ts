import { describe, expect, it } from 'vitest';
import { digitsOnly, normalizePhoneText, toEnglishDigits } from '../digits';
import { phoneCountries, searchCountries } from '../countries';
import { getExampleNumber } from 'libphonenumber-js/core';
import metadata from 'libphonenumber-js/metadata.max.json';
import examples from 'libphonenumber-js/examples.mobile.json';
import {
  displayNational,
  exampleNational,
  fromE164,
  isPendingInternational,
  isValidE164,
  mainCountryFor,
  splitInternational,
  stateFromValue,
  toE164,
  type CountryCode,
} from '../phone';

const exampleE164 = (code: string): string | null => {
  try {
    return getExampleNumber(code as CountryCode, examples, metadata as never)?.number ?? null;
  } catch {
    return null;
  }
};

describe('digit normalisation (English 0-9 only)', () => {
  it('converts Arabic-Indic, Persian and full-width digits', () => {
    expect(toEnglishDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(toEnglishDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(toEnglishDigits('０１２３４５６７８９')).toBe('0123456789');
    expect(digitsOnly('٠٥٠ ١٢٣-٤٥٦٧')).toBe('0501234567');
  });

  it('keeps only a leading + and turns a leading 00 into +', () => {
    expect(normalizePhoneText('+٩٦٦ 5١ ٢٣٤ ٥٦٧٨')).toBe('+966512345678');
    expect(normalizePhoneText('00971 50 123 4567')).toBe('+971501234567');
    expect(normalizePhoneText('‎+966‏ 512-345-678')).toBe('+966512345678');
    expect(normalizePhoneText('0501234567')).toBe('0501234567');
  });
});

describe('E.164 building', () => {
  it('strips the national trunk prefix and never doubles the country code', () => {
    expect(toE164('0512345678', 'SA')).toBe('+966512345678');
    expect(toE164('512345678', 'SA')).toBe('+966512345678');
    expect(toE164('966512345678', 'SA')).toBe('+966512345678');
    expect(toE164('٥١٢٣٤٥٦٧٨', 'SA')).toBe('+966512345678');
    expect(toE164('', 'SA')).toBe('');
  });

  it('builds a prefixed value for a still-incomplete number', () => {
    expect(toE164('5', 'SA')).toBe('+9665');
    expect(isValidE164('+9665')).toBe(false);
  });

  it('removes a duplicated dial code from the field once the number is valid', () => {
    expect(displayNational('966512345678', 'SA')).toBe('512345678');
    expect(displayNational('512345678', 'SA')).toBe('512345678');
    // رقم هندي وطني صالح يبدأ بـ91 لا يُعامل كرمز دولة.
    expect(displayNational('9123456789', 'IN')).toBe('9123456789');
  });
});

describe('validation per country', () => {
  const valid: Array<[string, string]> = [
    ['Saudi Arabia', '+966512345678'],
    ['UAE', '+971501234567'],
    ['Yemen', '+967712345678'],
    ['Egypt', '+201012345678'],
    ['India', '+919876543210'],
    ['United States', '+12025550123'],
  ];
  it.each(valid)('accepts a real %s mobile number', (_n, e164) => {
    expect(isValidE164(e164)).toBe(true);
  });

  const invalid: Array<[string, string]> = [
    ['Saudi number with a landline prefix', '+966112345678'],
    ['Saudi number too short', '+96651234567'],
    ['Saudi number too long', '+9665123456789'],
    ['UAE with a Saudi-style tail', '+97151234'],
    ['India with 9 digits', '+91987654321'],
    ['no plus', '966512345678'],
    ['letters', '+966abc'],
    ['empty', ''],
  ];
  it.each(invalid)('rejects %s', (_n, e164) => {
    expect(isValidE164(e164)).toBe(false);
  });

  it('accepts a landline only when mobile-only is switched off', () => {
    expect(isValidE164('+966112345678')).toBe(false);
    expect(isValidE164('+966112345678', { mobileOnly: false })).toBe(true);
  });
});

describe('international input splitting', () => {
  it('derives the country from a pasted international number', () => {
    expect(splitInternational('+971501234567')).toEqual({ country: 'AE', national: '501234567' });
    expect(splitInternational('+٩٦٧ ٧١٢ ٣٤٥ ٦٧٨')).toEqual({ country: 'YE', national: '712345678' });
    expect(splitInternational('00201012345678')).toEqual({ country: 'EG', national: '1012345678' });
  });

  it('ignores a bare + and an unknown code', () => {
    expect(splitInternational('+')).toBeNull();
    expect(splitInternational('+97')).toBeNull(); // 97 ليس رمز اتصال؛ يكتمل بإدخال الخانة التالية
    expect(splitInternational('+971')).toEqual({ country: 'AE', national: '' });
  });

  it('prefers the current country when the calling code is shared', () => {
    expect(splitInternational('+1', 'CA')?.country).toBe('CA');
    expect(splitInternational('+1', 'SA')?.country).toBe('US');
    expect(splitInternational('+12025550123')?.country).toBe('US');
  });

  it('round-trips a stored E.164 value', () => {
    expect(fromE164('+919876543210')).toEqual({ country: 'IN', national: '9876543210' });
    expect(fromE164('')).toBeNull();
  });
});

describe('country list and search', () => {
  const list = phoneCountries('ar');

  it('is comprehensive and bilingual', () => {
    expect(list.length).toBeGreaterThan(220);
    const sa = list.find((c) => c.code === 'SA')!;
    expect(sa.nameAr).toContain('السعودية');
    expect(sa.nameEn).toBe('Saudi Arabia');
    expect(sa.dial).toBe('966');
    expect(phoneCountries('en').find((c) => c.code === 'SA')!.name).toBe('Saudi Arabia');
  });

  it('finds countries by Arabic name, English name, and dial code in any digit script', () => {
    expect(searchCountries(list, 'اليمن')[0].code).toBe('YE');
    expect(searchCountries(list, 'مصر')[0].code).toBe('EG');
    expect(searchCountries(list, 'india')[0].code).toBe('IN');
    expect(searchCountries(list, 'united states')[0].code).toBe('US');
    expect(searchCountries(list, 'السعوديه')[0].code).toBe('SA'); // ة↔ه
    expect(searchCountries(list, 'الامارات').map((c) => c.code)).toContain('AE');
    expect(searchCountries(list, '+967')[0].code).toBe('YE');
    expect(searchCountries(list, '٩٦٧')[0].code).toBe('YE');
    expect(searchCountries(list, '00971')[0].code).toBe('AE');
    expect(searchCountries(list, 'zzzzzz')).toEqual([]);
  });

  it('gives a mobile example placeholder in English digits', () => {
    expect(exampleNational('SA')).toMatch(/^[0-9 ()\-]+$/);
    expect(exampleNational('SA').length).toBeGreaterThan(5);
  });
});

describe('shared calling codes (+1, +7, +44, …)', () => {
  const byCode = new Map<string, string[]>();
  for (const c of phoneCountries('en')) byCode.set(c.dial, [...(byCode.get(c.dial) ?? []), c.code]);
  const shared = [...byCode.entries()].filter(([, list]) => list.length > 1);

  it('finds a real set of shared codes, including NANP', () => {
    expect(shared.length).toBeGreaterThan(8);
    const nanp = byCode.get('1')!;
    expect(nanp).toEqual(expect.arrayContaining(['US', 'CA']));
  });

  it.each(shared.map(([code, list]) => [code, list] as const))('+%s: a partial code keeps the selected country and the main one is the fallback', (code, list) => {
    expect(mainCountryFor(code)).not.toBeNull();
    expect(list).toContain(mainCountryFor(code));
    for (const c of list) {
      expect(splitInternational(`+${code}`, c as CountryCode)?.country, `${c} preferred for +${code}`).toBe(c);
    }
    expect(splitInternational(`+${code}`)?.country).toBe(mainCountryFor(code));
  });

  it('every selectable country with a mobile example survives paste → split → rebuild with the SAME E.164 (no silent change)', () => {
    let checked = 0;
    for (const c of phoneCountries('en')) {
      const example = exampleE164(c.code);
      if (!example) continue;
      const split = splitInternational(example, c.code);
      expect(split, c.code).not.toBeNull();
      expect(toE164(split!.national, split!.country), `${c.code} ${example}`).toBe(example);
      expect(isValidE164(example), `${c.code} example is a valid mobile`).toBe(true);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('a pasted valid number resolves to the country it truly belongs to, not the previously selected sibling', () => {
    // كندا (416) تُلصق وأمريكا مختارة ← كندا؛ وأمريكا (202) وكندا مختارة ← أمريكا؛ الرقم نفسه لا يتغيّر.
    expect(splitInternational('+14162345678', 'US')).toEqual({ country: 'CA', national: '4162345678' });
    expect(splitInternational('+12025550123', 'CA')).toEqual({ country: 'US', national: '2025550123' });
    // أرقام +44: النطاقات تتداخل بين المملكة المتحدة والجزر التابعة في بيانات libphonenumber نفسها (مثلاً مثال جزيرة مان يُحسم GB)،
    // فالضمان المطلوب: الدولة ضمن أصحاب المفتاح والرقم E.164 لا يتغيّر مهما كانت الدولة المختارة سابقاً.
    const siblings: CountryCode[] = ['GB', 'JE', 'GG', 'IM'];
    for (const own of siblings) {
      const number = exampleE164(own)!;
      for (const selected of siblings) {
        const split = splitInternational(number, selected)!;
        expect(siblings, `${number} pasted while ${selected} is selected`).toContain(split.country);
        expect(toE164(split.national, split.country)).toBe(number);
      }
    }
    for (const own of ['JE', 'GG'] as CountryCode[]) {
      expect(splitInternational(exampleE164(own)!, 'GB')?.country).toBe(own);
    }
  });

  it('an invalid or partial number never flips the user-selected sibling', () => {
    expect(splitInternational('+1416', 'CA')?.country).toBe('CA');
    expect(splitInternational('+1555', 'CA')?.country).toBe('CA');
    expect(splitInternational('+7', 'KZ')?.country).toBe('KZ');
    expect(splitInternational('+7', 'SA')?.country).toBe('RU');
  });

  it('restoring a saved value keeps the sibling the caller prefers when the number alone cannot tell', () => {
    expect(stateFromValue('+1416', 'CA')).toEqual({ country: 'CA', national: '416', legacy: false });
    expect(stateFromValue('+14162345678', 'US').country).toBe('CA');
  });

  it('searching a shared code lists the main country first, then the siblings alphabetically', () => {
    const list = phoneCountries('en');
    const hits = searchCountries(list, '+1');
    expect(hits[0].code).toBe('US');
    expect(hits.slice(0, byCode.get('1')!.length).map((c) => c.code).sort()).toEqual([...byCode.get('1')!].sort());
    expect(searchCountries(list, '+7')[0].code).toBe('RU');
    expect(searchCountries(list, '+44')[0].code).toBe('GB');
  });
});

describe('saved values and in-progress input', () => {
  it('a legacy local value is shown as typed and flagged, never re-interpreted as a country', () => {
    expect(stateFromValue('0500000000', 'SA')).toEqual({ country: 'SA', national: '0500000000', legacy: true });
    expect(stateFromValue('٠٥٠٠٠٠٠٠٠٠', 'SA').national).toBe('0500000000');
    expect(stateFromValue('', 'SA')).toEqual({ country: 'SA', national: '', legacy: false });
  });

  it('an incomplete calling code is pending, a complete one is not', () => {
    expect(isPendingInternational('+')).toBe(true);
    expect(isPendingInternational('+9')).toBe(true);
    expect(isPendingInternational('+97')).toBe(true);
    expect(isPendingInternational('+971')).toBe(false);
    expect(isPendingInternational('0501234567')).toBe(false);
  });

  it('does not truncate an over-long pasted number silently', () => {
    const split = splitInternational('+9665123456789012345678');
    expect(split?.national).toBe('5123456789012345678');
    expect(isValidE164(toE164(split!.national, split!.country))).toBe(false);
  });
});
