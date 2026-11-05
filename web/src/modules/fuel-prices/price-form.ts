import { riyalToMinor } from '@/lib/money';
import type { CreatePricePayload } from './client';
import type { EffectiveRow, PriceScope, SuggestionRow, TaxMode } from './contract';

/** سقف يطابق الخادم (10,000 ريال/لتر بالهللات). */
export const MAX_PRICE_MINOR = 1_000_000;

export type PriceParse =
  | { ok: true; minor: number }
  | { ok: false; error: 'empty' | 'format' | 'zero' | 'too_large' };

/**
 * يحوّل مدخل «ريال لكل لتر» إلى هللات صحيحة بلا float. يقبل الأرقام العربية-الهندية، ويرفض أكثر من خانتين عشريتين
 * أو سالباً أو صفراً أو فوق السقف. غير المفهوم لا يتحوّل إلى 0 أبداً.
 */
export function parsePriceInput(raw: string): PriceParse {
  if (raw.trim() === '') return { ok: false, error: 'empty' };
  const minor = riyalToMinor(raw);
  if (!Number.isFinite(minor) || minor < 0) return { ok: false, error: 'format' };
  if (minor === 0) return { ok: false, error: 'zero' };
  if (minor > MAX_PRICE_MINOR) return { ok: false, error: 'too_large' };
  return { ok: true, minor };
}

/** مفتاح تكرار لمحاولة حفظ واحدة منطقياً (يبقى عبر إعادة المحاولة بعد انقطاع، ويتجدّد بعد نجاح أو تغيير المدخلات). */
export function newIdempotencyKey(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return `fp-${c.randomUUID()}`;
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return `fp-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export type StartMode = { kind: 'now' } | { kind: 'scheduled'; localValue: string };

export type ScheduleParse = { ok: true; iso: string } | { ok: false; error: 'empty' | 'format' | 'past' };

/** قيمة `datetime-local` (بتوقيت الجهاز) ⇒ لحظة ISO مطلقة. المجدول يجب أن يسبق الآن بدقيقة على الأقل. */
export function parseScheduled(localValue: string, nowMs: number): ScheduleParse {
  if (localValue.trim() === '') return { ok: false, error: 'empty' };
  const ms = new Date(localValue).getTime();
  if (Number.isNaN(ms)) return { ok: false, error: 'format' };
  if (ms < nowMs + 60_000) return { ok: false, error: 'past' };
  return { ok: true, iso: new Date(ms).toISOString() };
}

/** السعر الحالي ضمن النطاق نفسه (لا سعر المؤسسة الموروث على شاشة محطة): هو ما سيتعارض وقد يُغلق عند الاستبدال. */
export function currentInScope(row: EffectiveRow | undefined, scope: PriceScope): EffectiveRow | null {
  if (!row || row.status !== 'effective' || row.price_per_liter_minor === null) return null;
  if (scope.kind === 'station') return row.source === 'station_override' ? row : null;
  return row.source === 'tenant_default' ? row : null;
}

export interface BuildInput {
  scope: PriceScope;
  fuelProductId: string;
  minor: number;
  start: StartMode;
  scheduledIso?: string;
  note: string;
  supersede: boolean;
  suggestion?: Pick<SuggestionRow, 'tax_mode'> | null;
  idempotencyKey: string;
}

export function buildPayload(input: BuildInput): CreatePricePayload {
  const note = input.note.trim();
  const payload: CreatePricePayload = {
    fuel_station_id: input.scope.kind === 'station' ? input.scope.stationId : null,
    fuel_product_id: input.fuelProductId,
    price_per_liter_minor: input.minor,
    idempotency_key: input.idempotencyKey,
    ...(input.start.kind === 'now' ? { start_now: true as const } : { effective_from: input.scheduledIso }),
    ...(note ? { reason: note } : {}),
    ...(input.supersede ? { supersede: true as const } : {}),
  };
  if (input.suggestion) {
    // الإقرار يستند إلى نمط الضريبة الذي رآه المستخدم وأكّده؛ الخادم يعيد التحقق منه داخل المعاملة.
    payload.source = { type: 'product_card', confirm_tax_mode: input.suggestion.tax_mode ?? '', confirm_unit: 'L' };
  }
  return payload;
}

export function isTaxMode(value: string | null | undefined): value is TaxMode {
  return value === 'tax_inclusive' || value === 'tax_exclusive';
}

/** رموز الرفض الخادمية ⇒ مفتاح رسالة. المجهول ⇒ `generic` (لا نعرض نص إنجليزي/تقني). */
export const REJECTION_KEYS: Record<string, string> = {
  price_overlap: 'overlap',
  supersede_requires_open_ended: 'supersedeOpenEnded',
  supersede_backdated: 'supersedeBackdated',
  supersede_conflicts_with_later_price: 'supersedeLater',
  idempotency_key_conflict: 'idempotencyConflict',
  suggestion_unavailable: 'suggestionUnavailable',
  suggestion_stale: 'suggestionStale',
  suggestion_tax_mode_mismatch: 'suggestionTaxMismatch',
  suggestion_unit_unconfirmed: 'suggestionUnitUnconfirmed',
};

export function rejectionKey(reason: string | undefined): string {
  return (reason && REJECTION_KEYS[reason]) || 'generic';
}
