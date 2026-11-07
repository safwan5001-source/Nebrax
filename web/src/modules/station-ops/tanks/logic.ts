import { litersToMilliliters } from '@/lib/fuel-quantity';
import type { LevelFlag } from './schemas';

/**
 * FUEL-B6 — منطق نموذج القراءة (دوال نقية بلا I/O).
 *
 * المبدأ: **معاينة إرشادية** تمنع إرسال ما نعلم أن الخادم سيرفضه (سالب/غير صالح/فوق السعة) وتُنبّه لما يحتاج مراجعة، لكنها لا تحلّ محل الخادم:
 * التحقق النهائي (السعة، الترتيب الزمني، الصلاحية، النطاق) عنده. القواعد هنا نسخة من قواعد `FuelTankLevel` الخادمية وبقيم الخزان المعتمدة
 * نفسها فقط — **لا حدّ اختراعي**، ولا تتحوّل قراءة غير صالحة إلى صفر.
 */

export interface TankLimits {
  capacityMl: number;
  safeCapacityMl: number;
  minimumLevelMl: number;
  deadStockMl: number;
}

export type Evaluation =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'over_capacity'; ml: number }
  | { kind: 'ok'; ml: number; fillBasisPoints: number | null; availableMl: number; flags: LevelFlag[]; deltaMl: number | null };

/** لترات المستخدم (حتى 3 منازل) ⇒ تقييم. الفراغ ليس صفراً. الصفر الصريح مقبول (خزان فارغ فعلاً). */
export function evaluateReading(raw: string, limits: TankLimits, previousMl: number | null): Evaluation {
  if (raw.trim() === '') return { kind: 'empty' };
  const ml = litersToMilliliters(raw, true);
  if (ml === null) return { kind: 'invalid' };
  if (limits.capacityMl > 0 && ml > limits.capacityMl) return { kind: 'over_capacity', ml };
  const flags: LevelFlag[] = [];
  if (limits.safeCapacityMl > 0 && ml > limits.safeCapacityMl) flags.push('above_safe_capacity');
  if (limits.minimumLevelMl > 0 && ml < limits.minimumLevelMl) flags.push('below_minimum_level');
  if (limits.deadStockMl > 0 && ml < limits.deadStockMl) flags.push('below_dead_stock');
  return {
    kind: 'ok',
    ml,
    fillBasisPoints: fillBasisPoints(ml, limits.capacityMl),
    availableMl: Math.max(limits.capacityMl - ml, 0),
    flags,
    deltaMl: previousMl === null ? null : ml - previousMl,
  };
}

/** نسبة الامتلاء بالنقاط الأساسية (حساب صحيح، تقريب لأقرب نقطة) — كما في الخادم. */
export function fillBasisPoints(ml: number, capacityMl: number): number | null {
  if (capacityMl <= 0) return null;
  return Math.floor((ml * 10000 + Math.floor(capacityMl / 2)) / capacityMl);
}

/** نسبة مئوية للعرض بمنزلة واحدة من النقاط الأساسية (7525 ⇒ 75.3) بلا float في الحساب المالي/الكمي: القسمة لعرض فقط. */
export function percentText(basisPoints: number | null, locale: string): string {
  if (basisPoints === null) return '—';
  const value = basisPoints / 100;
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', { maximumFractionDigits: 1, minimumFractionDigits: 0 }).format(value);
}

/** عرض مبسّط لعمر القياس (ثوانٍ ⇒ مكوّنات)؛ لا نص هنا: الشاشة تترجم. */
export function ageParts(seconds: number | null): { unit: 'minutes' | 'hours' | 'days'; value: number } | null {
  if (seconds === null) return null;
  if (seconds < 3600) return { unit: 'minutes', value: Math.max(Math.floor(seconds / 60), 0) };
  if (seconds < 86400) return { unit: 'hours', value: Math.floor(seconds / 3600) };
  return { unit: 'days', value: Math.floor(seconds / 86400) };
}

/** مفتاح ثابت لنية القراءة: تغيّر أي حقل ⇒ نية جديدة (والخادم يعيد الأثر الأول لأي مفتاح موجود فلا يُعاد استعمال مفتاح لحمولة مختلفة). */
export function readingIntent(input: { stationId: string; tankId: string; type: string; ml: number; method: string; note: string; at?: string | null; reason?: string }) {
  return { s: input.stationId, k: input.tankId, t: input.type, q: input.ml, m: input.method, n: input.note.trim(), at: input.at ?? null, r: (input.reason ?? '').trim() };
}

export const METHODS = ['dipstick', 'gauge', 'atg_console', 'other'] as const;
export type Method = (typeof METHODS)[number];

/** طرق القياس المنطقية لكل نوع قراءة (واجهة فقط): قراءة ATG تُنقل من شاشة جهاز، واليدوية بالمسطرة أو العدّاد الميكانيكي. */
export function methodsFor(type: 'physical' | 'atg'): readonly Method[] {
  return type === 'atg' ? ['atg_console', 'other'] : ['dipstick', 'gauge', 'other'];
}

export function evidenceBody(method: Method, note: string): { method: Method; note?: string } {
  const clean = note.trim();
  return clean === '' ? { method } : { method, note: clean.slice(0, 500) };
}

// ───────────────────────── القراءة المتأخرة (بتاريخ سابق) ─────────────────────────

/**
 * `YYYY-MM-DDTHH:mm` (قيمة `datetime-local` بلا منطقة) مفسَّرةً **بتوقيت المحطة** ⇒ لحظة ISO (UTC).
 * وقت القياس يختاره المستخدم صراحةً فقط (لا ساعة عميل تلقائية)؛ التحويل بمنطقة المحطة لا بمنطقة الجهاز. منطقة غائبة/غير صالحة ⇒ منطقة الجهاز.
 * `null` لمدخل غير صالح (لا تخمين).
 */
export function zonedLocalToIso(local: string, timeZone: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(asUtc)) return null;
  const roundTrip = new Date(asUtc);
  if (roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) return null; // تاريخ غير موجود (31 فبراير…)

  if (timeZone) {
    try {
      const offsetAt = (ts: number) => {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ts));
        const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
        return Date.UTC(pick('year'), pick('month') - 1, pick('day'), pick('hour'), pick('minute'), pick('second')) - ts;
      };
      const first = asUtc - offsetAt(asUtc);
      return new Date(asUtc - offsetAt(first)).toISOString();
    } catch {
      // منطقة غير صالحة ⇒ منطقة الجهاز أدناه
    }
  }
  const device = new Date(year, month - 1, day, hour, minute);
  return Number.isNaN(device.getTime()) ? null : device.toISOString();
}

export type LateWindow =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'future' }
  | { kind: 'not_late' }
  | { kind: 'too_old'; hours: number }
  | { kind: 'ok'; iso: string; hoursAgo: number };

/**
 * تقييم إرشادي لوقت القياس المختار مقابل سياسة المحطة المعلنة. الحكم النهائي للخادم (ساعته وسماحيته): هنا نمنع فقط ما نعلم أنه سيُرفض
 * (مستقبل / أبعد من الحد) وننبّه على «ليست متأخرة» (ضمن الدقائق الأخيرة تُسجَّل قراءة عادية بوقتها). `nowMs` للمقارنة فقط ولا يُرسَل أبداً.
 */
export function evaluateLateTime(local: string, timeZone: string | null | undefined, maxHours: number, nowMs: number): LateWindow {
  if (local.trim() === '') return { kind: 'empty' };
  const iso = zonedLocalToIso(local, timeZone);
  if (iso === null) return { kind: 'invalid' };
  const diff = nowMs - Date.parse(iso);
  if (diff < -300_000) return { kind: 'future' };
  if (diff <= 300_000) return { kind: 'not_late' };
  if (diff > maxHours * 3_600_000) return { kind: 'too_old', hours: maxHours };
  return { kind: 'ok', iso, hoursAgo: Math.floor(diff / 3_600_000) };
}
