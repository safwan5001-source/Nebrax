/**
 * FLOWERS-H2-6 / ADR-20 — مهلة تجهيز منتج (`GET|PUT commerce/workspace/products/{id}/preparation`). الخادم هو
 * السلطة: المهلة الفعلية = الأكبر بين مهلة القناة ومهلة المنتج (لا مجموعهما)، وموعد أقرب تسليم يُحسَب عنده
 * وحده — لا يُحسب هنا أي موعد. الغياب (`0`/`null`) = بلا مهلة خاصة (صفّ محذوف، تمثيل واحد).
 */

import { api } from '@/lib/api';
import { adminCall, obj, productPath, type AdminResult } from '../admin-http';
import type { LeadUnit } from '../delivery-schedule';

export const MAX_PREPARATION_MINUTES = 43200;

/** دقائق، أو `0` = بلا مهلة خاصة. */
export type Preparation = { minutes: number };

export function mapPreparation(payload: unknown): Preparation | null {
  const raw = obj(obj(payload)?.data)?.preparation_minutes;
  if (raw === null || raw === undefined) return { minutes: 0 };
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;

  return { minutes: Math.max(0, Math.trunc(raw)) };
}

const UNIT_MINUTES: Record<LeadUnit, number> = { minutes: 1, hours: 60, days: 1440 };

/**
 * يحوّل الإدخال إلى دقائق: فارغ أو `0` ⇒ `0` (بلا مهلة خاصة)؛ عدد صحيح 1…السقف ⇒ دقائق؛ غير ذلك ⇒ `null` (غير صالح).
 */
export function preparationToMinutes(input: string, unit: LeadUnit): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return 0;
  if (!/^\d+$/.test(trimmed)) return null;
  const minutes = Number(trimmed) * UNIT_MINUTES[unit];

  return Number.isSafeInteger(minutes) && minutes <= MAX_PREPARATION_MINUTES ? minutes : null;
}

/** أنسب وحدة لعرض المهلة المحفوظة؛ `0` ⇒ حقل فارغ. */
export function splitPreparation(minutes: number): { value: string; unit: LeadUnit } {
  if (minutes <= 0) return { value: '', unit: 'hours' };
  if (minutes % 1440 === 0) return { value: String(minutes / 1440), unit: 'days' };
  if (minutes % 60 === 0) return { value: String(minutes / 60), unit: 'hours' };

  return { value: String(minutes), unit: 'minutes' };
}

export const loadPreparation = (productId: string): Promise<AdminResult<Preparation>> =>
  adminCall(async () => mapPreparation(await api<unknown>(productPath(productId, 'preparation'))));

export const savePreparation = (productId: string, minutes: number): Promise<AdminResult<Preparation>> =>
  adminCall(async () =>
    mapPreparation(await api<unknown>(productPath(productId, 'preparation'), { method: 'PUT', body: { preparation_minutes: minutes === 0 ? null : minutes } })),
  );

