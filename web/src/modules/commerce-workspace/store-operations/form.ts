import { riyalToMinor } from '@/lib/money';
import type { MinOrderScope, OperationsChanges, OperationsView, OutsideHoursPolicy, Period } from './api';

/**
 * COPS-H4-3 (UI) — نموذج إعدادات تشغيل القناة (دوال نقية): مسودة ← تحقق ← **تغييرات فقط** تُرسَل مع `expected_version`. التحقق هنا مرآة لخدمة الخادم
 * (`CommerceChannelOperationsSettingsService`) لتوفير الرحلة؛ الخادم هو الحَكَم النهائي. الأيام 0=الأحد..6=السبت؛ الأوقات «HH:MM» بتوقيت القناة (النهاية حتى «24:00»).
 */
export const MAX_PAUSE_MESSAGE = 200;
export const MAX_PERIODS_PER_DAY = 3;
export const MAX_PERIODS = 21;
export const MAX_MIN_ORDER_MINOR = 100_000_000_000;

export type Draft = {
  accepting: boolean;
  /** قيمة `datetime-local` بالتوقيت المحلي للمتصفح، أو ''. */
  pausedUntil: string;
  pauseMessage: string;
  policy: OutsideHoursPolicy;
  hours: Period[];
  /** الحد الأدنى بالريال كنص، '' = بلا حد. */
  minOrder: string;
  minScope: MinOrderScope;
};

export type DraftErrorKey =
  | 'pauseMessageInvalid'
  | 'pausedUntilRequiresPause'
  | 'pausedUntilInvalid'
  | 'pausedUntilPast'
  | 'minOrderInvalid'
  | 'hoursInvalid'
  | 'hoursTooMany'
  | 'hoursOverlap'
  | 'gateClosed';

export type DraftErrors = Partial<Record<'pauseMessage' | 'pausedUntil' | 'minOrder' | 'hours' | 'gate', DraftErrorKey>>;

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO UTC ← قيمة `datetime-local` (محلي). */
export function localToIso(local: string): string | null {
  if (local === '') return null;
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}

/** قيمة `datetime-local` (محلي) ← ISO UTC. */
export function isoToLocal(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function minorToRiyalText(minor: number | null): string {
  if (minor === null) return '';
  const whole = Math.trunc(minor / 100);
  const frac = minor % 100;

  return frac === 0 ? String(whole) : `${whole}.${pad(frac)}`;
}

export function draftFromView(view: OperationsView): Draft {
  return {
    accepting: view.acceptingOrders,
    pausedUntil: isoToLocal(view.pausedUntil),
    pauseMessage: view.pauseMessage ?? '',
    policy: view.outsideHoursPolicy,
    hours: view.openingHours.map((p) => ({ ...p })),
    minOrder: minorToRiyalText(view.minOrderMinor),
    minScope: view.minOrderScope,
  };
}

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const END = /^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/;

/**
 * بعد تعارض نسخة: تُحمَل إلى المسودة قيمُ الخادم الأحدث لكل حقل **لم يلمسه المستخدم**،
 * ويبقى ما حرّره بنفسه. وإلا بقيت قيمة قديمة في حقل غير مُحرَّر وأُعيد إرسالها عند «حفظ» فتُبطل
 * تغيير مسؤول آخر (مثلاً إيقاف مؤقت) دون أن يراه المستخدم.
 */
export function rebaseDraft(draft: Draft, oldBase: Draft, newBase: Draft): Draft {
  const out = { ...newBase } as Record<keyof Draft, unknown>;
  for (const key of Object.keys(draft) as (keyof Draft)[]) {
    if (JSON.stringify(draft[key]) !== JSON.stringify(oldBase[key])) out[key] = draft[key];
  }

  return out as Draft;
}

export function sortPeriods(periods: Period[]): Period[] {
  return [...periods].sort((a, b) => a.weekday - b.weekday || a.opens_at.localeCompare(b.opens_at));
}

export function validateHours(hours: Period[]): DraftErrorKey | null {
  if (hours.length > MAX_PERIODS) return 'hoursTooMany';
  const sorted = sortPeriods(hours);
  const perDay = new Map<number, number>();
  let previous: Period | null = null;
  for (const p of sorted) {
    if (!Number.isInteger(p.weekday) || p.weekday < 0 || p.weekday > 6 || !TIME.test(p.opens_at) || !END.test(p.closes_at) || p.opens_at >= p.closes_at) return 'hoursInvalid';
    perDay.set(p.weekday, (perDay.get(p.weekday) ?? 0) + 1);
    if ((perDay.get(p.weekday) ?? 0) > MAX_PERIODS_PER_DAY) return 'hoursTooMany';
    if (previous && previous.weekday === p.weekday && p.opens_at < previous.closes_at) return 'hoursOverlap';
    previous = p;
  }

  return null;
}

const samePeriods = (a: Period[], b: Period[]) => JSON.stringify(sortPeriods(a)) === JSON.stringify(sortPeriods(b));

/**
 * تحقق + اشتقاق التغييرات. `now` للاختبار. البوابة مغلقة ⇒ الانتقال إلى حجب (إيقاف الطلبات، `block`، حدّ أدنى جديد) مرفوض هنا قبل الخادم (الذي يرفضه أيضاً بـ409).
 */
export function validateDraft(draft: Draft, view: OperationsView, now: Date = new Date()): { ok: true; changes: OperationsChanges } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const changes: OperationsChanges = {};

  // الإيقاف
  if (draft.accepting !== view.acceptingOrders) changes.accepting_orders = draft.accepting;
  const message = draft.pauseMessage.trim();
  if ([...message].length > MAX_PAUSE_MESSAGE || /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(message)) errors.pauseMessage = 'pauseMessageInvalid';
  else if (message !== (view.pauseMessage ?? '')) changes.pause_message = message === '' ? null : message;

  // الاستئناف المجدول يخصّ الإيقاف: والطلبات مقبولة يُتجاهل النص وتُمسح القيمة المخزَّنة في الحفظ نفسه (الخادم يرفض موعداً مع قبول الطلبات).
  const untilText = draft.accepting ? '' : draft.pausedUntil;
  const untilIso = localToIso(untilText);
  if (untilText !== '' && untilIso === null) errors.pausedUntil = 'pausedUntilInvalid';
  else if (untilText !== isoToLocal(view.pausedUntil)) {
    if (untilIso !== null && new Date(untilIso).getTime() <= now.getTime()) errors.pausedUntil = 'pausedUntilPast';
    else changes.paused_until = untilIso;
  }

  // سياسة خارج الساعات + الساعات
  if (draft.policy !== view.outsideHoursPolicy) changes.outside_hours_policy = draft.policy;
  const hoursError = validateHours(draft.hours);
  if (hoursError) errors.hours = hoursError;
  else if (!samePeriods(draft.hours, view.openingHours)) changes.opening_hours = sortPeriods(draft.hours);

  // الحد الأدنى
  const minText = draft.minOrder.trim();
  if (minText === '') {
    if (view.minOrderMinor !== null) changes.min_order_minor = null;
  } else {
    const minor = riyalToMinor(minText);
    if (!Number.isInteger(minor) || minor < 1 || minor > MAX_MIN_ORDER_MINOR) errors.minOrder = 'minOrderInvalid';
    else if (minor !== view.minOrderMinor) changes.min_order_minor = minor;
  }
  if (draft.minScope !== view.minOrderScope) changes.min_order_scope = draft.minScope;

  // البوابة D-H4-03: مغلقة ⇒ لا انتقال إلى حجب.
  if (!view.deploymentEnabled) {
    const entering =
      (view.acceptingOrders && changes.accepting_orders === false) ||
      (view.outsideHoursPolicy !== 'block' && changes.outside_hours_policy === 'block') ||
      (view.minOrderMinor === null && typeof changes.min_order_minor === 'number');
    if (entering) errors.gate = 'gateClosed';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, changes };
}

/** مساعدات تحرير الفترات بالفهرس (المفتاح الطبيعي `opens_at` يتغيّر أثناء الكتابة فلا يصلح معرّفاً). */
export function addPeriod(hours: Period[], weekday: number): Period[] {
  return [...hours, { weekday, opens_at: '09:00', closes_at: '17:00' }];
}

export function removePeriodAt(hours: Period[], index: number): Period[] {
  return hours.filter((_, i) => i !== index);
}

export function updatePeriodAt(hours: Period[], index: number, patch: Partial<Pick<Period, 'opens_at' | 'closes_at'>>): Period[] {
  return hours.map((p, i) => (i === index ? { ...p, ...patch } : p));
}
