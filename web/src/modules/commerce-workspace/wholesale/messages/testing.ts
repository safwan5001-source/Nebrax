import { expect } from 'vitest';

/** Shared assertions for a section dictionary: identical keys in ar/en and no empty strings. */
export function expectMessageParity(messages: { ar: Record<string, string>; en: Record<string, string> }): void {
  expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.ar).sort());
  for (const dict of [messages.ar, messages.en]) {
    for (const [key, value] of Object.entries(dict)) {
      expect(value.trim(), `empty message: ${key}`).not.toBe('');
    }
  }
  // `{var}` placeholders must match between languages.
  for (const key of Object.keys(messages.ar)) {
    const vars = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    expect(vars(messages.en[key]), `placeholder mismatch: ${key}`).toEqual(vars(messages.ar[key]));
  }
}
