import { describe, expect, it } from 'vitest';
import { localizedText } from './template-catalog';

describe('localizedText', () => {
  it('picks the UI language and falls back to the other when missing', () => {
    expect(localizedText({ ar: 'فارغ', en: 'Blank' }, 'ar')).toBe('فارغ');
    expect(localizedText({ ar: 'فارغ', en: 'Blank' }, 'en')).toBe('Blank');
    expect(localizedText({ ar: 'فارغ', en: '' }, 'en')).toBe('فارغ');
    expect(localizedText({ ar: '', en: 'Blank' }, 'ar')).toBe('Blank');
  });
});
