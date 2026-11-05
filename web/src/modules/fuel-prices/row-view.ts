import type { EffectiveRow, SuggestionRow, TaxMode } from './contract';
import { isTaxMode } from './price-form';

/**
 * عرض صف السعر الفعّال: الخادم هو الحَكَم؛ هنا تحويل دفاعي إلى حالة عرض. أي تناقض (وحدة غير اللتر، حالة/مصدر مجهول،
 * سعر غائب في صف فعّال) ⇒ `invalid` لا رقم. الغياب `not_configured` — ليس صفراً أبداً.
 */
export type PriceView =
  | { kind: 'known'; minor: number; scope: 'station' | 'tenant'; from: string | null; until: string | null; taxMode: TaxMode | null; sellable: boolean; blockers: string[] }
  | { kind: 'not_configured'; taxMode: TaxMode | null }
  | { kind: 'product_inactive' }
  | { kind: 'invalid' };

const SCOPE: Record<string, 'station' | 'tenant'> = { station_override: 'station', tenant_default: 'tenant' };

export function describeRow(row: EffectiveRow | undefined): PriceView {
  if (!row || row.unit !== 'L') return { kind: 'invalid' };
  const taxMode = isTaxMode(row.tax_mode) ? row.tax_mode : null;
  if (row.tax_mode !== null && taxMode === null) return { kind: 'invalid' };
  if (row.status === 'not_configured') return { kind: 'not_configured', taxMode };
  if (row.status === 'product_inactive') return { kind: 'product_inactive' };
  if (row.status !== 'effective') return { kind: 'invalid' };
  const scope = row.source ? SCOPE[row.source] : undefined;
  if (row.price_per_liter_minor === null || !scope) return { kind: 'invalid' };
  return { kind: 'known', minor: row.price_per_liter_minor, scope, from: row.effective_from, until: row.effective_until, taxMode, sellable: row.sellable, blockers: row.blockers };
}

export type SuggestionView =
  | { kind: 'available'; minor: number; taxMode: TaxMode; cardUnit: string | null; matchesCurrent: boolean }
  | { kind: 'blocked'; blockers: string[] }
  | { kind: 'invalid' };

export function describeSuggestion(row: SuggestionRow | undefined): SuggestionView {
  if (!row || row.unit !== 'L') return { kind: 'invalid' };
  if (row.status === 'blocked') return { kind: 'blocked', blockers: row.blockers };
  if (row.status !== 'available' || row.price_per_liter_minor === null || !isTaxMode(row.tax_mode) || row.blockers.length > 0) return { kind: 'invalid' };
  return { kind: 'available', minor: row.price_per_liter_minor, taxMode: row.tax_mode, cardUnit: row.card_unit_name, matchesCurrent: row.matches_current };
}

/** هل سيتعارض السعر الجديد (يبدأ عند `startMs`) مع السعر الحالي ضمن النطاق نفسه فيلزم إغلاقه باستبدال صريح؟ */
export function needsSupersede(current: { effective_until: string | null } | null, startMs: number): boolean {
  if (current === null) return false;
  if (current.effective_until === null) return true;
  const until = Date.parse(current.effective_until);
  return Number.isNaN(until) ? true : until > startMs;
}
