import { litersToMilliliters, millilitersToLiters } from '@/lib/fuel-quantity';
import type { EndLinkPayload, LinkPayload, OwnerPayload, TankerPayload } from './client';
import type { LinkPhase, OwnerCompanyLink, Tanker, TankerOwner, TankerStatus } from './types';

/** منطق نقي للنماذج (بلا React ولا شبكة): تحقق قبل الإرسال وبناء حمولات تحوي **الحقول المتغيّرة فقط** عند التعديل. */

export const LIMITS = { name: 255, code: 64, phone: 50, notes: 2000, plate: 64, country: 8, reason: 500, linkNote: 1000 } as const;

export type FormErrors<K extends string> = Partial<Record<K, string>>;

const trimmed = (value: string) => value.trim();
const orNull = (value: string) => (trimmed(value) === '' ? null : trimmed(value));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** رمز الخطأ = مفتاح ترجمة تحت `fuelTankers.errors.*`. */
export type ErrorCode = 'required' | 'too_long' | 'invalid_capacity' | 'invalid_date' | 'end_before_start';

// ───────────────────────── صاحب الصهريج ─────────────────────────

export interface OwnerForm { name: string; code: string; phone: string; notes: string; status: TankerStatus; reason: string }

export const EMPTY_OWNER_FORM: OwnerForm = { name: '', code: '', phone: '', notes: '', status: 'active', reason: '' };

export function ownerFormFrom(owner: TankerOwner): OwnerForm {
  return { name: owner.name, code: owner.code ?? '', phone: owner.phone ?? '', notes: owner.notes ?? '', status: owner.status, reason: '' };
}

export function validateOwner(form: OwnerForm): FormErrors<'name' | 'code' | 'phone' | 'notes' | 'reason'> & Record<string, ErrorCode | undefined> {
  const errors: Record<string, ErrorCode> = {};
  if (trimmed(form.name) === '') errors.name = 'required';
  else if (trimmed(form.name).length > LIMITS.name) errors.name = 'too_long';
  if (trimmed(form.code).length > LIMITS.code) errors.code = 'too_long';
  if (trimmed(form.phone).length > LIMITS.phone) errors.phone = 'too_long';
  if (trimmed(form.notes).length > LIMITS.notes) errors.notes = 'too_long';
  if (trimmed(form.reason).length > LIMITS.reason) errors.reason = 'too_long';
  return errors;
}

/**
 * إنشاء: كل الحقول المعبّأة. تعديل: ما تغيّر فقط (فلا يُكتب شيء لم يُلمس ولا يُرسَل هاتف/ملاحظات لمستخدم لا يراها: `original.phone === undefined`
 * ⇒ لا يظهر حقلها أصلاً في النموذج وتبقى خارج الحمولة).
 */
export function buildOwnerPayload(form: OwnerForm, original?: TankerOwner): OwnerPayload {
  const reason = orNull(form.reason) ?? undefined;
  if (!original) {
    return {
      name: trimmed(form.name),
      code: orNull(form.code),
      phone: orNull(form.phone),
      notes: orNull(form.notes),
      status: form.status,
      ...(reason ? { reason } : {}),
    };
  }
  const payload: OwnerPayload = {};
  if (trimmed(form.name) !== original.name) payload.name = trimmed(form.name);
  if (orNull(form.code) !== (original.code ?? null)) payload.code = orNull(form.code);
  if (original.phone !== undefined && orNull(form.phone) !== (original.phone ?? null)) payload.phone = orNull(form.phone);
  if (original.notes !== undefined && orNull(form.notes) !== (original.notes ?? null)) payload.notes = orNull(form.notes);
  if (form.status !== original.status) payload.status = form.status;
  if (Object.keys(payload).length > 0 && reason) payload.reason = reason;
  return payload;
}

export const hasChanges = (payload: object) => Object.keys(payload).filter((key) => key !== 'reason').length > 0;

// ───────────────────────── الصهريج ─────────────────────────

export interface TankerForm { plate: string; country: string; capacityLiters: string; notes: string; status: TankerStatus; reason: string }

export const EMPTY_TANKER_FORM: TankerForm = { plate: '', country: '', capacityLiters: '', notes: '', status: 'active', reason: '' };

export function tankerFormFrom(tanker: Tanker): TankerForm {
  return {
    plate: tanker.plate_number,
    country: tanker.plate_country ?? '',
    capacityLiters: tanker.capacity_milliliters === null ? '' : millilitersToLiters(tanker.capacity_milliliters),
    notes: tanker.notes ?? '',
    status: tanker.status,
    reason: '',
  };
}

/** السعة باللتر (حتى 3 منازل) ⇒ mL صحيح موجب؛ الفراغ = بلا سعة؛ ما عدا ذلك `undefined` (غير صالح). */
export function capacityMilliliters(input: string): number | null | undefined {
  if (trimmed(input) === '') return null;
  const value = litersToMilliliters(input);
  return value === null ? undefined : value;
}

export function validateTanker(form: TankerForm): Record<string, ErrorCode> {
  const errors: Record<string, ErrorCode> = {};
  if (trimmed(form.plate) === '') errors.plate = 'required';
  else if (trimmed(form.plate).length > LIMITS.plate) errors.plate = 'too_long';
  if (trimmed(form.country).length > LIMITS.country) errors.country = 'too_long';
  if (capacityMilliliters(form.capacityLiters) === undefined) errors.capacity = 'invalid_capacity';
  if (trimmed(form.notes).length > LIMITS.notes) errors.notes = 'too_long';
  if (trimmed(form.reason).length > LIMITS.reason) errors.reason = 'too_long';
  return errors;
}

export function buildTankerPayload(form: TankerForm, ownerId: string, original?: Tanker): TankerPayload {
  const capacity = capacityMilliliters(form.capacityLiters) ?? null;
  const reason = orNull(form.reason) ?? undefined;
  if (!original) {
    return {
      fuel_tanker_owner_id: ownerId,
      plate_number: trimmed(form.plate),
      plate_country: orNull(form.country),
      capacity_milliliters: capacity,
      notes: orNull(form.notes),
      status: form.status,
      ...(reason ? { reason } : {}),
    };
  }
  // المالك ثابت بعد الإنشاء (PR-1): لا يُرسَل أبداً في التعديل.
  const payload: TankerPayload = {};
  if (trimmed(form.plate) !== original.plate_number) payload.plate_number = trimmed(form.plate);
  if (orNull(form.country) !== (original.plate_country ?? null)) payload.plate_country = orNull(form.country);
  if (capacity !== (original.capacity_milliliters ?? null)) payload.capacity_milliliters = capacity;
  if (original.notes !== undefined && orNull(form.notes) !== (original.notes ?? null)) payload.notes = orNull(form.notes);
  if (form.status !== original.status) payload.status = form.status;
  if (Object.keys(payload).length > 0 && reason) payload.reason = reason;
  return payload;
}

// ───────────────────────── ربط الشركة ─────────────────────────

export interface LinkForm { partnerId: string; validFrom: string; validTo: string; note: string }

export const EMPTY_LINK_FORM: LinkForm = { partnerId: '', validFrom: '', validTo: '', note: '' };

export function validateLink(form: LinkForm): Record<string, ErrorCode> {
  const errors: Record<string, ErrorCode> = {};
  if (form.partnerId === '') errors.partner = 'required';
  if (form.validFrom !== '' && !DATE.test(form.validFrom)) errors.validFrom = 'invalid_date';
  if (form.validTo !== '' && !DATE.test(form.validTo)) errors.validTo = 'invalid_date';
  // الفراغ في البداية = اليوم بحكم الخادم؛ المقارنة فقط حين يُعطى التاريخان (ISO فيقارن نصاً).
  if (!errors.validFrom && !errors.validTo && form.validFrom !== '' && form.validTo !== '' && form.validTo < form.validFrom) errors.validTo = 'end_before_start';
  if (trimmed(form.note).length > LIMITS.linkNote) errors.note = 'too_long';
  return errors;
}

/** التواريخ الفارغة لا تُرسَل (الخادم يفترض اليوم) — لا ساعة عميل في أي حمولة. */
export function buildLinkPayload(form: LinkForm): LinkPayload {
  return {
    partner_id: form.partnerId,
    ...(form.validFrom !== '' ? { valid_from: form.validFrom } : {}),
    ...(form.validTo !== '' ? { valid_to: form.validTo } : {}),
    ...(orNull(form.note) ? { note: orNull(form.note) as string } : {}),
  };
}

export function validateEnd(validTo: string, link: Pick<OwnerCompanyLink, 'valid_from'>, reason: string): Record<string, ErrorCode> {
  const errors: Record<string, ErrorCode> = {};
  if (validTo !== '' && !DATE.test(validTo)) errors.validTo = 'invalid_date';
  else if (validTo !== '' && validTo < link.valid_from) errors.validTo = 'end_before_start';
  if (trimmed(reason).length > LIMITS.reason) errors.reason = 'too_long';
  return errors;
}

export function buildEndPayload(validTo: string, reason: string): EndLinkPayload {
  return { ...(validTo !== '' ? { valid_to: validTo } : {}), ...(orNull(reason) ? { reason: orNull(reason) as string } : {}) };
}

/** تاريخ اليوم محلياً (YYYY-MM-DD) — للعرض فقط (تمييز المجدول من المنتهي)؛ لا يدخل أي حمولة ولا يحكم أي قاعدة. */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** مرحلة الربط للعرض: نشط الآن (حكم الخادم)، مُجدول (يبدأ بعد اليوم)، أو منتهٍ. */
export function linkPhase(link: Pick<OwnerCompanyLink, 'is_active' | 'valid_from' | 'valid_to'>, today: string = localToday()): LinkPhase {
  if (link.is_active) return 'active';
  return link.valid_from > today ? 'upcoming' : 'ended';
}
