import { describe, it, expect } from 'vitest';
import { numberToArabicWords, numberToEnglishWords, amountToWords } from './amount-words';

describe('numberToArabicWords', () => {
  it('handles zero and small numbers', () => {
    expect(numberToArabicWords(0)).toBe('صفر');
    expect(numberToArabicWords(15)).toBe('خمسة عشر');
    expect(numberToArabicWords(50)).toBe('خمسون');
    expect(numberToArabicWords(115)).toBe('مئة وخمسة عشر');
  });

  it('handles thousands with correct morphology', () => {
    expect(numberToArabicWords(1000)).toBe('ألف');
    expect(numberToArabicWords(2000)).toBe('ألفان');
    expect(numberToArabicWords(3000)).toBe('ثلاثة آلاف');
    expect(numberToArabicWords(1150)).toBe('ألف ومئة وخمسون');
  });

  it('handles millions', () => {
    expect(numberToArabicWords(1_000_000)).toBe('مليون');
    expect(numberToArabicWords(2_000_000)).toBe('مليونان');
  });
});

describe('numberToEnglishWords', () => {
  it('handles zero and small numbers', () => {
    expect(numberToEnglishWords(0)).toBe('zero');
    expect(numberToEnglishWords(15)).toBe('fifteen');
    expect(numberToEnglishWords(115)).toBe('one hundred fifteen');
  });

  it('handles thousands and hyphenated tens', () => {
    expect(numberToEnglishWords(1000)).toBe('one thousand');
    expect(numberToEnglishWords(1234)).toBe('one thousand two hundred thirty-four');
  });
});

describe('amountToWords (SAR, minor units)', () => {
  it('formats Arabic riyals + halalas', () => {
    // 115.50 ريال = 11550 هللة
    expect(amountToWords(11550, 'SAR', 'ar')).toBe('مئة وخمسة عشر ريال وخمسون هللة فقط لا غير');
  });

  it('omits halalas when zero (Arabic)', () => {
    expect(amountToWords(100000, 'SAR', 'ar')).toBe('ألف ريال فقط لا غير');
  });

  it('formats English riyals + halalas with plural agreement', () => {
    expect(amountToWords(11550, 'SAR', 'en')).toBe('one hundred fifteen Saudi Riyals and fifty Halalas only');
    expect(amountToWords(100101, 'SAR', 'en')).toBe('one thousand one Saudi Riyals and one Halala only');
  });
});
