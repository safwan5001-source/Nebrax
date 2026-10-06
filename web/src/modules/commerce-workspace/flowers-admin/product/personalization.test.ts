import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

import { ApiError } from '@/lib/api';
import {
  changeType,
  isSlug,
  loadPersonalization,
  mapPersonalization,
  move,
  newField,
  newOption,
  personalizationPayload,
  savePersonalization,
  signature,
  slugify,
  suggestKey,
  validateField,
  type PersonalizationField,
} from './personalization';

afterEach(() => apiMock.mockReset());

const serverBody = {
  data: {
    fields: [
      { key: 'card-name', type: 'text', label: 'الاسم على البطاقة', label_en: 'Card name', help_text: 'حتى 20 حرفاً', is_required: true, max_length: 20, is_active: true, options: [] },
      { key: 'ribbon', type: 'select', label: 'لون الشريط', label_en: null, help_text: null, is_required: false, max_length: null, is_active: false, options: [
        { value_key: 'red', label: 'أحمر', label_en: 'Red', is_active: true },
        { value_key: 'gold', label: 'ذهبي', label_en: null, is_active: false },
      ] },
    ],
  },
};
const fields = () => mapPersonalization(serverBody)!;

describe('personalization client', () => {
  it('maps hyphenated slug keys, types, options and inactive state; marks fields persisted', () => {
    const [name, ribbon] = fields();
    expect(name).toMatchObject({ key: 'card-name', type: 'text', labelEn: 'Card name', helpText: 'حتى 20 حرفاً', isRequired: true, maxLength: 20, persisted: true });
    expect(ribbon).toMatchObject({ key: 'ribbon', type: 'select', maxLength: null, isActive: false });
    expect(ribbon.options.map((o) => [o.valueKey, o.isActive, o.labelEn])).toEqual([['red', true, 'Red'], ['gold', false, '']]);
  });

  it('fails the load on a row it does not understand instead of dropping it (a whole-set save would delete it server-side)', () => {
    const body = { data: { fields: [{ key: 'photo', type: 'file', label: 'x' }, { key: 'ok', type: 'text', label: 'ok' }] } };
    expect(mapPersonalization(body)).toBeNull();
    const badOption = { data: { fields: [{ key: 'r', type: 'select', label: 'r', options: [{ value_key: 'a', label: 'A' }, { nope: true }] }] } };
    expect(mapPersonalization(badOption)).toBeNull();
    expect(mapPersonalization({ data: {} })).toBeNull();
    expect(mapPersonalization({ data: { fields: [{ key: 'ok', type: 'text', label: 'ok' }] } })!.map((f) => f.key)).toEqual(['ok']);
  });

  it('counts Unicode characters like the server: 61 emoji is 61 characters, not 122 UTF-16 units', () => {
    const [name, ribbon] = fields();
    const emoji = (n: number) => '🌹'.repeat(n);
    expect(validateField({ ...name, label: emoji(61), labelEn: emoji(120), helpText: emoji(200) }, [])).toEqual([]);
    expect(validateField({ ...name, label: emoji(121) }, [])).toContainEqual({ field: 'label', code: 'tooLong' });
    expect(validateField({ ...ribbon, options: [{ ...ribbon.options[0], label: emoji(120), labelEn: emoji(120) }] }, [])).toEqual([]);
  });

  it('builds the payload: select has options and no max_length, text has max_length and no options, blanks → null', () => {
    const [name, ribbon] = fields();
    const { fields: sent } = personalizationPayload([{ ...name, helpText: '  ' }, ribbon]);
    expect(sent[0]).toEqual({ key: 'card-name', type: 'text', label: 'الاسم على البطاقة', label_en: 'Card name', help_text: null, is_required: true, max_length: 20, is_active: true });
    expect('options' in sent[0]).toBe(false);
    expect('max_length' in sent[1]).toBe(false);
    expect(sent[1]).toMatchObject({ key: 'ribbon', is_active: false, options: [{ value_key: 'red', label: 'أحمر', label_en: 'Red', is_active: true }, { value_key: 'gold', label: 'ذهبي', label_en: null, is_active: false }] });
  });

  it('reads and writes via the product path', async () => {
    apiMock.mockResolvedValue(serverBody);
    await loadPersonalization('p1');
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/workspace/products/p1/personalization');
    await savePersonalization('p1', fields());
    expect(apiMock.mock.calls.at(-1)![1]).toMatchObject({ method: 'PUT', body: { fields: [{ key: 'card-name' }, { key: 'ribbon' }] } });
  });

  it('surfaces the server rejection', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(422, 'مفاتيح مُدخَلات التخصيص يجب أن تكون فريدة.', {}));
    expect(await savePersonalization('p1', fields())).toMatchObject({ ok: false, kind: 'invalid', message: 'مفاتيح مُدخَلات التخصيص يجب أن تكون فريدة.' });
  });
});

describe('personalization draft logic', () => {
  it('accepts exactly the backend slug rule, including hyphens', () => {
    for (const ok of ['a', 'card-name', 'a1-b2-c3', 'x'.repeat(48)]) expect(isSlug(ok), ok).toBe(true);
    for (const bad of ['', 'Card', 'card_name', '-a', 'a-', 'a--b', 'اسم', 'a b', 'x'.repeat(49)]) expect(isSlug(bad), bad).toBe(false);
  });

  it('slugifies English text and suggests unique keys', () => {
    expect(slugify('Card Name!')).toBe('card-name');
    expect(slugify('  اسم  ')).toBe('');
    expect(suggestKey('field', '', [])).toBe('field');
    expect(suggestKey('field', '', ['field'])).toBe('field-2');
    expect(suggestKey('field', 'Card name', ['card-name', 'card-name-2'])).toBe('card-name-3');
  });

  it('new fields start valid-key, invalid-label, text with the server default length', () => {
    const f = newField([]);
    expect(f).toMatchObject({ type: 'text', maxLength: 60, persisted: false, isActive: true });
    expect(validateField(f, [])).toEqual([{ field: 'label', code: 'required' }]);
  });

  it('validates key uniqueness, lengths and the max_length range for text types', () => {
    const [name] = fields();
    const dup = { ...name, persisted: false };
    expect(validateField(dup, [name])).toContainEqual({ field: 'key', code: 'duplicate' });
    expect(validateField({ ...name, key: 'Bad_Key' }, [])).toContainEqual({ field: 'key', code: 'format' });
    expect(validateField({ ...name, maxLength: 0 }, [])).toContainEqual({ field: 'maxLength', code: 'range' });
    expect(validateField({ ...name, maxLength: 501 }, [])).toContainEqual({ field: 'maxLength', code: 'range' });
    expect(validateField({ ...name, label: 'x'.repeat(121) }, [])).toContainEqual({ field: 'label', code: 'tooLong' });
    expect(validateField({ ...name, helpText: 'x'.repeat(256) }, [])).toContainEqual({ field: 'helpText', code: 'tooLong' });
    expect(validateField(name, [])).toEqual([]);
  });

  it('an option English label over the server limit is a field error on that option (not a late 422)', () => {
    const [, ribbon] = fields();
    const long = { ...ribbon, options: [{ ...ribbon.options[0], labelEn: 'x'.repeat(121) }] };
    expect(validateField(long, [])).toEqual([{ field: 'optionLabelEn', code: 'tooLong', index: 0 }]);
    expect(validateField({ ...ribbon, options: [{ ...ribbon.options[0], labelEn: 'x'.repeat(120) }] }, [])).toEqual([]);
  });

  it('a required active select needs an active option, otherwise the product becomes unpurchasable', () => {
    const [, ribbon] = fields();
    const allOff = { ...ribbon, isActive: true, isRequired: true, options: ribbon.options.map((o) => ({ ...o, isActive: false })) };
    expect(validateField(allOff, [])).toContainEqual({ field: 'options', code: 'noneActive' });
    expect(validateField({ ...allOff, isRequired: false }, [])).toEqual([]);
    expect(validateField({ ...allOff, isActive: false }, [])).toEqual([]);
    expect(validateField({ ...allOff, options: [{ ...allOff.options[0], isActive: true }] }, [])).toEqual([]);
  });

  it('a select needs at least one valid option with a unique key and a label', () => {
    const [, ribbon] = fields();
    expect(validateField({ ...ribbon, options: [] }, [])).toContainEqual({ field: 'options', code: 'none' });
    const bad: PersonalizationField = { ...ribbon, options: [{ valueKey: 'Red', label: '', labelEn: '', isActive: true }, { valueKey: 'a', label: 'x', labelEn: '', isActive: true }, { valueKey: 'a', label: 'y', labelEn: '', isActive: true }] };
    const errors = validateField(bad, []);
    expect(errors).toContainEqual({ field: 'optionKey', code: 'format', index: 0 });
    expect(errors).toContainEqual({ field: 'optionLabel', code: 'required', index: 0 });
    expect(errors).toContainEqual({ field: 'optionKey', code: 'duplicate', index: 2 });
    expect(validateField(ribbon, [])).toEqual([]);
    expect(validateField({ ...ribbon, options: Array.from({ length: 31 }, (_, i) => ({ valueKey: `o-${i}`, label: 'x', labelEn: '', isActive: true })) }, [])).toContainEqual({ field: 'options', code: 'tooMany' });
  });

  it('changing type adapts length/options and keeps the rest', () => {
    const [name, ribbon] = fields();
    expect(changeType(name, 'select')).toMatchObject({ type: 'select', maxLength: null, label: name.label });
    const toText = changeType(ribbon, 'textarea');
    expect(toText).toMatchObject({ type: 'textarea', maxLength: 250, options: [] });
    expect(changeType(name, 'text')).toBe(name);
    expect(newOption(ribbon).valueKey).toBe('option');
  });

  it('moves items and signs the whole definition set', () => {
    expect(move([1, 2, 3], 2, -1)).toEqual([1, 3, 2]);
    expect(move([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    const a = fields();
    expect(signature(a)).toBe(signature(fields()));
    expect(signature(a)).not.toBe(signature([a[1], a[0]]));
  });
});
