/**
 * FLOWERS-H2-7 / ADR-16 — تعريفات التخصيص لمنتج (`GET|PUT commerce/workspace/products/{id}/personalization`).
 * الأنواع المدعومة اليوم: نص قصير، نص طويل، اختيار — لا رفع ملفات ولا HTML ولا أثر سعري. الخادم يستبدل
 * المجموعة كاملةً (المفتاح هو الهوية)، ويرفض غير الصالح؛ التحقق هنا يعكس حدوده لفشلٍ مبكر فقط.
 */

import { api } from '@/lib/api';
import { adminCall, bool, list, obj, productPath, str, type AdminResult } from '../admin-http';

// مرايا حدود الخادم (ProductPersonalizationService / CommerceProductPersonalizationField).
export const MAX_FIELDS = 8;
export const MAX_OPTIONS = 30;
export const MAX_KEY_LENGTH = 48;
export const MAX_LABEL_LENGTH = 120;
export const MAX_HELP_LENGTH = 255;
export const MAX_LENGTH_CEILING = 500;
export const DEFAULT_TEXT_LENGTH = 60;
export const DEFAULT_TEXTAREA_LENGTH = 250;
export const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const FIELD_TYPES = ['text', 'textarea', 'select'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type PersonalizationOption = { valueKey: string; label: string; labelEn: string; isActive: boolean };

export type PersonalizationField = {
  key: string;
  type: FieldType;
  label: string;
  labelEn: string;
  helpText: string;
  isRequired: boolean;
  /** نص قصير/طويل فقط؛ `null` للاختيار. */
  maxLength: number | null;
  isActive: boolean;
  options: PersonalizationOption[];
  /** هل المفتاح محفوظ على الخادم (فيُقفل ولا يُعاد تسميته). */
  persisted: boolean;
};

/** عدد المحارف كما يعدّها الخادم (Unicode لا وحدات UTF-16)، فلا يُرفض عنوانٌ من رموز تعبيرية وهو ضمن الحد. */
export const charCount = (value: string): number => Array.from(value).length;

const isType = (v: unknown): v is FieldType => (FIELD_TYPES as readonly unknown[]).includes(v);

function mapOption(raw: unknown): PersonalizationOption | null {
  const row = obj(raw);
  const valueKey = str(row?.value_key);
  const label = str(row?.label);

  return row && valueKey && label !== null ? { valueKey, label, labelEn: str(row.label_en) ?? '', isActive: bool(row.is_active, true) } : null;
}

function mapField(raw: unknown): PersonalizationField | null {
  const row = obj(raw);
  const key = str(row?.key);
  if (!row || !key || !isType(row.type) || str(row.label) === null) return null;
  const options = list(row.options).map(mapOption);
  if (!options.every((o): o is PersonalizationOption => o !== null)) return null;

  return {
    key,
    type: row.type,
    label: row.label as string,
    labelEn: str(row.label_en) ?? '',
    helpText: str(row.help_text) ?? '',
    isRequired: bool(row.is_required),
    maxLength: row.type === 'select' ? null : typeof row.max_length === 'number' ? row.max_length : row.type === 'text' ? DEFAULT_TEXT_LENGTH : DEFAULT_TEXTAREA_LENGTH,
    isActive: bool(row.is_active, true),
    options,
    persisted: true,
  };
}

export function mapPersonalization(payload: unknown): PersonalizationField[] | null {
  const fields = obj(obj(payload)?.data)?.fields;
  if (!Array.isArray(fields)) return null;

  // صفٌّ لا نفهمه (نوعٌ جديد من خادم أحدث مثلاً) يُفشل التحميل: حذفه بصمت ثم حفظ المجموعة كاملةً يمحوه من الخادم.
  const mapped = fields.map(mapField);

  return mapped.every((f): f is PersonalizationField => f !== null) ? mapped : null;
}

/** القائمة + بصمتها (`revision`) كما أعادهما الخادم؛ البصمة تُعاد عند الحفظ فيرفض الخادم الاستبدال القديم داخل القفل. */
export type PersonalizationDocument = { fields: PersonalizationField[]; revision: string | null };

export function mapPersonalizationDocument(payload: unknown): PersonalizationDocument | null {
  const fields = mapPersonalization(payload);
  if (!fields) return null;
  const revision = obj(obj(payload)?.data)?.revision;

  return { fields, revision: typeof revision === 'string' && revision !== '' ? revision : null };
}

export const loadPersonalization = (productId: string): Promise<AdminResult<PersonalizationDocument>> =>
  adminCall(async () => mapPersonalizationDocument(await api<unknown>(productPath(productId, 'personalization'))));

const blankToNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

export function personalizationPayload(fields: readonly PersonalizationField[]) {
  return {
    fields: fields.map((f) => ({
      key: f.key,
      type: f.type,
      label: f.label.trim(),
      label_en: blankToNull(f.labelEn),
      help_text: blankToNull(f.helpText),
      is_required: f.isRequired,
      ...(f.type === 'select' ? {} : { max_length: f.maxLength ?? (f.type === 'text' ? DEFAULT_TEXT_LENGTH : DEFAULT_TEXTAREA_LENGTH) }),
      is_active: f.isActive,
      ...(f.type === 'select'
        ? { options: f.options.map((o) => ({ value_key: o.valueKey, label: o.label.trim(), label_en: blankToNull(o.labelEn), is_active: o.isActive })) }
        : {}),
    })),
  };
}

export const savePersonalization = (productId: string, fields: readonly PersonalizationField[], expectedRevision: string | null = null): Promise<AdminResult<PersonalizationDocument>> =>
  adminCall(async () =>
    mapPersonalizationDocument(
      await api<unknown>(productPath(productId, 'personalization'), {
        method: 'PUT',
        body: { ...(expectedRevision ? { expected_revision: expectedRevision } : {}), ...personalizationPayload(fields) },
      }),
    ),
  );

// ── منطق المسوّدة ────────────────────────────────────────────────────────────────

export const isSlug = (value: string): boolean => value.length > 0 && value.length <= MAX_KEY_LENGTH && KEY_PATTERN.test(value);

/** يحوّل نصاً (الإنجليزي) إلى slug صالح، أو `''` إن لم يبقَ ما يصلح. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_KEY_LENGTH)
    .replace(/-+$/g, '');
}

/** مفتاح مقترح فريد: من الاسم الإنجليزي إن وُجد وإلا `prefix-N`. */
export function suggestKey(prefix: string, labelEn: string, taken: readonly string[]): string {
  const base = slugify(labelEn) || prefix;
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base.slice(0, MAX_KEY_LENGTH - String(n).length - 1)}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }

  return `${prefix}-${Date.now()}`;
}

export const newField = (existing: readonly PersonalizationField[]): PersonalizationField => ({
  key: suggestKey('field', '', existing.map((f) => f.key)),
  type: 'text',
  label: '',
  labelEn: '',
  helpText: '',
  isRequired: false,
  maxLength: DEFAULT_TEXT_LENGTH,
  isActive: true,
  options: [],
  persisted: false,
});

export const newOption = (field: Pick<PersonalizationField, 'options'>): PersonalizationOption => ({
  valueKey: suggestKey('option', '', field.options.map((o) => o.valueKey)),
  label: '',
  labelEn: '',
  isActive: true,
});

/** تغيير النوع: يضبط الطول الافتراضي للنوع الجديد ويفرغ الخيارات إن لم يعد اختياراً. */
export function changeType(field: PersonalizationField, type: FieldType): PersonalizationField {
  if (field.type === type) return field;
  if (type === 'select') return { ...field, type, maxLength: null };

  return { ...field, type, maxLength: field.maxLength ?? (type === 'text' ? DEFAULT_TEXT_LENGTH : DEFAULT_TEXTAREA_LENGTH), options: [] };
}

export type FieldError =
  | { field: 'key'; code: 'format' | 'duplicate' }
  | { field: 'label'; code: 'required' | 'tooLong' }
  | { field: 'labelEn' | 'helpText'; code: 'tooLong' }
  | { field: 'maxLength'; code: 'range' }
  | { field: 'options'; code: 'none' | 'tooMany' }
  | { field: 'optionKey'; code: 'format' | 'duplicate'; index: number }
  | { field: 'optionLabel'; code: 'required' | 'tooLong'; index: number }
  | { field: 'optionLabelEn'; code: 'tooLong'; index: number };

/** كل أخطاء حقلٍ واحد، بالنظر إلى بقية حقول المنتج (تفرّد المفتاح). */
export function validateField(field: PersonalizationField, others: readonly PersonalizationField[]): FieldError[] {
  const errors: FieldError[] = [];
  if (!isSlug(field.key)) errors.push({ field: 'key', code: 'format' });
  else if (others.some((o) => o.key === field.key)) errors.push({ field: 'key', code: 'duplicate' });

  const label = field.label.trim();
  if (label === '') errors.push({ field: 'label', code: 'required' });
  else if (charCount(label) > MAX_LABEL_LENGTH) errors.push({ field: 'label', code: 'tooLong' });
  if (charCount(field.labelEn.trim()) > MAX_LABEL_LENGTH) errors.push({ field: 'labelEn', code: 'tooLong' });
  if (charCount(field.helpText.trim()) > MAX_HELP_LENGTH) errors.push({ field: 'helpText', code: 'tooLong' });

  if (field.type !== 'select') {
    const max = field.maxLength;
    if (max === null || !Number.isInteger(max) || max < 1 || max > MAX_LENGTH_CEILING) errors.push({ field: 'maxLength', code: 'range' });
  } else {
    if (field.options.length === 0) errors.push({ field: 'options', code: 'none' });
    if (field.options.length > MAX_OPTIONS) errors.push({ field: 'options', code: 'tooMany' });
    field.options.forEach((option, index) => {
      if (!isSlug(option.valueKey)) errors.push({ field: 'optionKey', code: 'format', index });
      else if (field.options.findIndex((o) => o.valueKey === option.valueKey) !== index) errors.push({ field: 'optionKey', code: 'duplicate', index });
      const optionLabel = option.label.trim();
      if (optionLabel === '') errors.push({ field: 'optionLabel', code: 'required', index });
      else if (charCount(optionLabel) > MAX_LABEL_LENGTH) errors.push({ field: 'optionLabel', code: 'tooLong', index });
      if (charCount(option.labelEn.trim()) > MAX_LABEL_LENGTH) errors.push({ field: 'optionLabelEn', code: 'tooLong', index });
    });
  }

  return errors;
}

export function move<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];

  return next;
}

export function signature(fields: readonly PersonalizationField[]): string {
  return JSON.stringify(personalizationPayload(fields));
}

export const canAddField = (fields: readonly PersonalizationField[]): boolean => fields.length < MAX_FIELDS;

