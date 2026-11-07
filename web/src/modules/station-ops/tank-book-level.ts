import type { Tank } from './schemas';
import type { TankLevelInput } from './tank-level';

/**
 * TANK-LEVEL-P2 — تحويل عقد الخادم `book_level` إلى حالة عرض صريحة. نقي بلا I/O.
 *
 * القواعد:
 *  - الخادم هو السلطة الوحيدة: لا اشتقاق منسوب من أي مصدر آخر في المتصفح. غياب الحقلين (خادم أقدم) ⇒ `not_provided`، لا صفر.
 *  - المنسوب الفاسد/الناقص ⇒ `invalid_data` **لهذه البطاقة وحدها**؛ لذلك يعبر الحقلان مخطط الاستجابة كـ`unknown` ويُتحقَّق منهما هنا
 *    (رفض الاستجابة كلها بسبب بطاقة واحدة كان سيُسقط صفحة الخزانات بأكملها).
 *  - `basis` يجب أن تكون `warehouse_book` بالضبط وإلا فالقيمة غير موثوقة الدلالة ⇒ `invalid_data` (لا نسميها «رصيد دفتري» تخميناً).
 *  - `as_of` يُتجاهل دائماً: لا طابع زمني يُعرض ما لم تثبت دلالته (الخادم يرسل `null`، وإن أرسل غيره لا نعرضه).
 *  - السعة (للنسبة) هي `capacity_milliliters` دون سواها.
 */

/** أسباب عدم التوفر التي يعلنها الخادم (`FuelTankBookBalanceReader::REASONS`). */
export const API_UNAVAILABLE_REASONS = [
  'multi_tank',
  'no_stock_record',
  'ambiguous_stock_record',
  'invalid_stock_record',
  'no_warehouse',
  'tank_inactive',
  'unit_mismatch',
  'invalid_configuration',
] as const;

export type ApiUnavailableReason = (typeof API_UNAVAILABLE_REASONS)[number];

/** أسباب جانب العميل: لم يرسل الخادم الحقلين، أو أرسلهما بشكل فاسد، أو سبباً لا نعرفه. */
export type ClientUnavailableReason = 'not_provided' | 'invalid_data' | 'unknown_reason';

export type BookLevelUnavailableReason = ApiUnavailableReason | ClientUnavailableReason;

export const BOOK_LEVEL_BASIS = 'warehouse_book';

export type TankBookLevelView =
  | { kind: 'level'; input: TankLevelInput }
  | { kind: 'unavailable'; reason: BookLevelUnavailableReason };

const KNOWN = new Set<string>(API_UNAVAILABLE_REASONS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveTankBookLevel(tank: Pick<Tank, 'capacity_milliliters' | 'book_level' | 'book_level_unavailable_reason'>): TankBookLevelView {
  const { book_level: level, book_level_unavailable_reason: reason } = tank;

  if (level === undefined && reason === undefined) return { kind: 'unavailable', reason: 'not_provided' };

  if (level === null) {
    if (typeof reason !== 'string' || reason === '') return { kind: 'unavailable', reason: 'invalid_data' };
    return { kind: 'unavailable', reason: KNOWN.has(reason) ? (reason as ApiUnavailableReason) : 'unknown_reason' };
  }

  // منسوب موجود: يجب ألا يصحبه سبب عدم توفر، وأن يكون الشكل سليماً كاملاً.
  if (reason !== null && reason !== undefined) return { kind: 'unavailable', reason: 'invalid_data' };
  if (!isRecord(level) || level.basis !== BOOK_LEVEL_BASIS) return { kind: 'unavailable', reason: 'invalid_data' };
  const ml = level.milliliters;
  if (typeof ml !== 'number' || !Number.isSafeInteger(ml) || ml < 0) return { kind: 'unavailable', reason: 'invalid_data' };

  return {
    kind: 'level',
    input: { levelMilliliters: ml, capacityMilliliters: tank.capacity_milliliters, source: 'book', measuredAt: null },
  };
}
