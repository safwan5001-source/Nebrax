/**
 * FLOWERS-H2-2…H2-4 / ADR-19 — عميل جدولة التسليم لقناة المتجر: القواعد (settings) والفترات (slots) والتواريخ
 * المحجوبة (blocked-dates). الخادم هو السلطة الوحيدة للتوفّر والمواعيد؛ لا يُحسَب هنا موعد ولا سعة ولا
 * «أول موعد». كل التواريخ تقويمية `Y-m-d` بمنطقة القناة الزمنية ولا تُحوَّل بساعة المتصفّح.
 */

import { api } from '@/lib/api';
import { adminCall, bool, list, num, obj, str, storePath, type AdminResult } from './admin-http';

// مرايا حدود الخادم (CommerceDeliveryScheduleSetting / CommerceDeliverySlot / CommerceDeliveryBlockedDate).
export const MAX_LEAD_TIME_MINUTES = 43200;
export const MAX_DAYS_AHEAD = 90;
export const DEFAULT_DAYS_AHEAD = 30;
export const MAX_SLOTS = 48;
export const MAX_SLOT_CAPACITY = 10000;
export const MAX_BLOCKED_DATES = 400;
export const MAX_LABEL_LENGTH = 80;
export const MAX_REASON_LENGTH = 120;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const DELIVERY_METHODS = ['delivery', 'pickup'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];
export type BlockedMethod = 'all' | DeliveryMethod;

export type ScheduleSettings = {
  enabled: boolean;
  required: boolean;
  timezone: string;
  leadTimeMinutes: number;
  cutoffTime: string | null;
  maxDaysAhead: number;
};

export type DeliverySlot = {
  /** `null` لنافذة جديدة لم تُحفظ بعد — تُنشأ بلا معرّف وتأخذ معرّفاً من الخادم. */
  id: string | null;
  method: DeliveryMethod;
  label: string;
  labelEn: string | null;
  startTime: string;
  endTime: string;
  /** 0 = الأحد … 6 = السبت، مرتّبة تصاعدياً. */
  weekdays: number[];
  capacity: number | null;
  shippingZoneId: string | null;
  isActive: boolean;
};

export type BlockedDate = { date: string; method: BlockedMethod; reason: string | null };

export type ScheduleDocument = {
  settings: ScheduleSettings;
  slots: DeliverySlot[];
  blockedDates: BlockedDate[];
  /** بصمة النوافذ كما قرأها العميل؛ تُعاد عند الاستبدال فيرفضه الخادم (409) إن غيّرها غيرنا داخل القفل. */
  slotsRevision?: string | null;
  /** كذلك للتواريخ المحجوبة (`blocked_dates_revision`). */
  blockedRevision?: string | null;
};

const isMethod = (value: unknown): value is DeliveryMethod => (DELIVERY_METHODS as readonly unknown[]).includes(value);

export function mapSettings(raw: unknown): ScheduleSettings | null {
  const row = obj(raw);
  if (!row || typeof row.enabled !== 'boolean' || typeof row.timezone !== 'string') return null;

  return {
    enabled: row.enabled,
    required: bool(row.required, true),
    timezone: row.timezone,
    leadTimeMinutes: Math.max(0, Math.trunc(num(row.lead_time_minutes))),
    cutoffTime: typeof row.cutoff_time === 'string' && TIME_PATTERN.test(row.cutoff_time) ? row.cutoff_time : null,
    maxDaysAhead: Math.max(1, Math.trunc(num(row.max_days_ahead, DEFAULT_DAYS_AHEAD))),
  };
}

export function mapSlot(raw: unknown): DeliverySlot | null {
  const row = obj(raw);
  if (!row || !isMethod(row.method) || typeof row.label !== 'string') return null;
  const start = str(row.start_time);
  const end = str(row.end_time);
  if (!start || !end) return null;

  return {
    id: str(row.id),
    method: row.method,
    label: row.label,
    labelEn: str(row.label_en),
    startTime: start,
    endTime: end,
    weekdays: list(row.weekdays)
      .filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)
      .sort((a, b) => a - b),
    capacity: typeof row.capacity === 'number' && Number.isFinite(row.capacity) ? row.capacity : null,
    shippingZoneId: str(row.shipping_zone_id),
    isActive: bool(row.is_active, true),
  };
}

export function mapBlockedDate(raw: unknown): BlockedDate | null {
  const row = obj(raw);
  const date = str(row?.date);
  if (!row || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const method = row.method === 'all' || isMethod(row.method) ? row.method : 'all';

  return { date, method, reason: str(row.reason) };
}

export function mapScheduleDocument(payload: unknown): ScheduleDocument | null {
  const data = obj(obj(payload)?.data);
  const settings = mapSettings(data?.settings);
  if (!data || !settings || !Array.isArray(data.slots) || !Array.isArray(data.blocked_dates)) return null;

  return {
    settings,
    slots: data.slots.map(mapSlot).filter((s): s is DeliverySlot => s !== null),
    blockedDates: data.blocked_dates.map(mapBlockedDate).filter((b): b is BlockedDate => b !== null),
    slotsRevision: typeof data.slots_revision === 'string' && data.slots_revision !== '' ? data.slots_revision : null,
    blockedRevision: typeof data.blocked_dates_revision === 'string' && data.blocked_dates_revision !== '' ? data.blocked_dates_revision : null,
  };
}

const path = (storeId: string, suffix = '') => storePath(storeId, `delivery-schedule${suffix}`);

export function loadSchedule(storeId: string): Promise<AdminResult<ScheduleDocument>> {
  return adminCall(async () => mapScheduleDocument(await api<unknown>(path(storeId))));
}

export function saveSettings(storeId: string, settings: ScheduleSettings): Promise<AdminResult<ScheduleDocument>> {
  return adminCall(async () =>
    mapScheduleDocument(
      await api<unknown>(path(storeId, '/settings'), {
        method: 'PUT',
        body: {
          is_enabled: settings.enabled,
          is_required: settings.required,
          timezone: settings.timezone,
          lead_time_minutes: settings.leadTimeMinutes,
          cutoff_time: settings.cutoffTime,
          max_days_ahead: settings.maxDaysAhead,
        },
      }),
    ),
  );
}

/** الخادم يستبدل المجموعة كاملةً بالمعرّف: ما غاب من الطلب يُحذف. لذلك تُرسَل كل النوافذ دائماً. */
export function saveSlots(storeId: string, slots: DeliverySlot[], expectedRevision: string | null = null): Promise<AdminResult<ScheduleDocument>> {
  return adminCall(async () =>
    mapScheduleDocument(
      await api<unknown>(path(storeId, '/slots'), {
        method: 'PUT',
        body: {
          ...(expectedRevision ? { expected_revision: expectedRevision } : {}),
          slots: slots.map((slot) => ({
            ...(slot.id ? { id: slot.id } : {}),
            method: slot.method,
            label: slot.label.trim(),
            label_en: slot.labelEn && slot.labelEn.trim() !== '' ? slot.labelEn.trim() : null,
            start_time: slot.startTime,
            end_time: slot.endTime,
            weekdays: slot.weekdays,
            capacity: slot.capacity,
            shipping_zone_id: slot.shippingZoneId,
            is_active: slot.isActive,
          })),
        },
      }),
    ),
  );
}

export function saveBlockedDates(storeId: string, rows: BlockedDate[], expectedRevision: string | null = null): Promise<AdminResult<ScheduleDocument>> {
  return adminCall(async () =>
    mapScheduleDocument(
      await api<unknown>(path(storeId, '/blocked-dates'), {
        method: 'PUT',
        body: {
          ...(expectedRevision ? { expected_revision: expectedRevision } : {}),
          blocked_dates: rows.map((row) => ({
            date: row.date,
            method: row.method,
            reason: row.reason && row.reason.trim() !== '' ? row.reason.trim() : null,
          })),
        },
      }),
    ),
  );
}

// ── قواعد الإدخال (تعكس الخادم لفشلٍ مبكر فقط؛ يبقى رفض الخادم مصدر الحقيقة) ─────────────────────────────

export const settingsEqual = (a: ScheduleSettings, b: ScheduleSettings): boolean =>
  a.enabled === b.enabled
  && a.required === b.required
  && a.timezone === b.timezone
  && a.leadTimeMinutes === b.leadTimeMinutes
  && a.cutoffTime === b.cutoffTime
  && a.maxDaysAhead === b.maxDaysAhead;

export type LeadUnit = 'minutes' | 'hours' | 'days';
const UNIT_MINUTES: Record<LeadUnit, number> = { minutes: 1, hours: 60, days: 1440 };

/** أنسب وحدة لعرض مهلة محفوظة: الأكبر التي تقسم القيمة تماماً (0 → ساعات). */
export function splitLeadTime(minutes: number): { value: number; unit: LeadUnit } {
  if (minutes === 0) return { value: 0, unit: 'hours' };
  if (minutes % 1440 === 0) return { value: minutes / 1440, unit: 'days' };
  if (minutes % 60 === 0) return { value: minutes / 60, unit: 'hours' };

  return { value: minutes, unit: 'minutes' };
}

/** يحوّل إدخال (قيمة + وحدة) إلى دقائق، أو `null` إن لم يكن عدداً صحيحاً غير سالب ضمن السقف. */
export function leadTimeToMinutes(input: string, unit: LeadUnit): number | null {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const minutes = Number(trimmed) * UNIT_MINUTES[unit];

  return Number.isSafeInteger(minutes) && minutes <= MAX_LEAD_TIME_MINUTES ? minutes : null;
}

export function parseDaysAhead(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);

  return value >= 1 && value <= MAX_DAYS_AHEAD ? value : null;
}

/** `null` = غير محدودة. `undefined` = إدخال غير صالح. */
export function parseCapacity(input: string): number | null | undefined {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);

  return value >= 1 && value <= MAX_SLOT_CAPACITY ? value : undefined;
}

/** نهاية النافذة يجب أن تلي بدايتها في اليوم نفسه (مقارنة نصية صحيحة لصيغة HH:MM). */
export const slotRangeValid = (start: string, end: string): boolean =>
  TIME_PATTERN.test(start) && TIME_PATTERN.test(end) && end > start;
