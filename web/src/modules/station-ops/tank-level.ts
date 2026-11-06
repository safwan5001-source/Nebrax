/**
 * منسوب الخزان — تقييم نقي (بلا شبكة ولا React ولا وصول لبيانات).
 *
 * **حالة الوحدة: مكوّن عرض غير موصول بشاشة.** لا يوجد اليوم عقد API مصرَّح يعيد منسوباً حالياً للخزان
 * (انظر `docs/fuel-stations/AWJ_STATIONS_TANK_LEVEL_V1_REPORT.md`)، لذلك لا تستورد هذه الوحدة أي مصدر بيانات،
 * ولا يجوز لأي شاشة اشتقاق مدخلها من إيصالات/مبيعات/دفتر. المدخل يُمرَّر من عقد خادم معتمَد فقط.
 *
 * القواعد:
 * - لا قيمة مخترعة: غياب/سالب/غير صالح ⇒ «غير متاح» لا 0% ولا 100%.
 * - تجاوز السعة شذوذ يُعرض صراحةً ولا يُقصّ إلى 100%.
 * - العتبات عرضية فقط (ليست قاعدة عمل ولا محفّز شراء): >50 جيد · 20..50 شاملةً متابعة · <20 منخفض.
 * - تصنيف العتبة بمقارنة صحيحة `level×100` مقابل `حد×capacity` (لا قسمة عائمة)، فـ19.99% منخفض دائماً و50% متابعة دائماً.
 */

/** عتبات العرض الأولية — موضع واحد للتعديل؛ ليست إعداداً للمستأجر ولا سياسة (قرار سياسة ⇒ على المالك). */
export const TANK_LEVEL_THRESHOLDS = {
  /** أقل من هذه النسبة = منخفض. */
  lowBelowPercent: 20,
  /** أعلى من هذه النسبة (صارماً) = جيد؛ وما بين العتبتين شاملاً الطرفين = متابعة. */
  healthyAbovePercent: 50,
} as const;

export type TankLevelBand = 'healthy' | 'monitor' | 'low';

/**
 * أصل القيمة كما يعلنه الخادم صراحةً. غيابه ⇒ `undefined` ويُعرض المنسوب بلا وصف أصل:
 * لا «فعلي» ولا «مباشر» ولا «مقاس» ما لم يصرّح العقد بذلك.
 */
export type TankLevelSource = 'physical' | 'atg' | 'book' | 'estimated';
export const TANK_LEVEL_SOURCES: readonly TankLevelSource[] = ['physical', 'atg', 'book', 'estimated'];

export interface TankLevelInput {
  /** المنسوب بالمليلتر (صحيح). `null`/`undefined` = لا بيانات. */
  levelMilliliters: number | null | undefined;
  capacityMilliliters: number | null | undefined;
  /** وحدة القيمة كما يرسلها العقد؛ الغياب = مليلتر (حقول `*_milliliters`). أي وحدة أخرى ⇒ تعارض لا تحويل. */
  levelUnit?: string | null;
  capacityUnit?: string | null;
  source?: TankLevelSource | null;
  /** لحظة القياس/الحساب كما أرسلها الخادم؛ لا تُشتق ولا يُفترض تحديث حي. */
  measuredAt?: string | null;
}

export type TankLevelUnavailableReason = 'missing_level' | 'invalid_level' | 'invalid_capacity' | 'conflicting_unit';

export interface TankLevelUnavailable {
  kind: 'unavailable';
  reason: TankLevelUnavailableReason;
  /** السعة المعروفة تبقى معروضة حين تكون صالحة (وإلا null). */
  capacityMilliliters: number | null;
}

export interface TankLevelOverCapacity {
  kind: 'over_capacity';
  levelMilliliters: number;
  capacityMilliliters: number;
  source: TankLevelSource | null;
  measuredAt: string | null;
}

export interface TankLevelOk {
  kind: 'ok';
  levelMilliliters: number;
  capacityMilliliters: number;
  /** النسبة الدقيقة (للعرض الجبري/التحقق، لا للتصنيف). */
  percent: number;
  /** النسبة المعروضة: صحيحة، وبخانتين عشريتين فقط حين يكذب التقريب الصحيح موضع الحد (انظر `displayPercent`). */
  displayPercent: number;
  band: TankLevelBand;
  source: TankLevelSource | null;
  measuredAt: string | null;
}

export type TankLevelResult = TankLevelOk | TankLevelOverCapacity | TankLevelUnavailable;

const ML_UNITS = new Set(['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres']);

function isMl(unit: string | null | undefined): boolean {
  return unit === undefined || unit === null || ML_UNITS.has(unit.trim().toLowerCase());
}

function validAmount(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** تصنيف الحد بمقارنة صحيحة: level/capacity مقابل t/100 ⇒ level×100 مقابل t×capacity. */
export function classifyTankLevel(levelMilliliters: number, capacityMilliliters: number): TankLevelBand {
  const scaled = levelMilliliters * 100;
  if (scaled > TANK_LEVEL_THRESHOLDS.healthyAbovePercent * capacityMilliliters) return 'healthy';
  if (scaled < TANK_LEVEL_THRESHOLDS.lowBelowPercent * capacityMilliliters) return 'low';
  return 'monitor';
}

/**
 * النسبة المعروضة. التقريب إلى صحيح يُظهر 20 أو 50 لقيمة ليست 20 أو 50 فعلاً (19.99 ⇒ «20» مع «منخفض»،
 * 50.04 ⇒ «50» مع «جيد») فيناقض التسمية الرقم. عندها فقط تُقصّ النسبة (لا تُقرَّب) إلى خانتين: تحت الحد ⇒ للأسفل،
 * فوقه ⇒ للأعلى، فلا يطابق المعروض حدّاً إلا إن طابقه الواقع. 100% كذلك (99.996 ⇒ 99.99 لا «100»).
 */
export function displayPercent(percent: number): number {
  const rounded = Math.round(percent);
  const boundaries: number[] = [TANK_LEVEL_THRESHOLDS.lowBelowPercent, TANK_LEVEL_THRESHOLDS.healthyAbovePercent, 100];
  if (boundaries.includes(rounded) && percent !== rounded) {
    // epsilon: 19.99*100 = 1998.9999999999998 في الفاصلة العائمة؛ بدونه يُقصّ 19.99 إلى 19.98.
    return percent < rounded ? Math.floor(percent * 100 + 1e-7) / 100 : Math.ceil(percent * 100 - 1e-7) / 100;
  }
  return rounded;
}

export function evaluateTankLevel(input: TankLevelInput): TankLevelResult {
  const { levelMilliliters: level, capacityMilliliters: capacity } = input;
  const capacityValid = validAmount(capacity) && capacity > 0;
  const knownCapacity = capacityValid ? capacity : null;
  const unavailable = (reason: TankLevelUnavailableReason): TankLevelUnavailable => ({ kind: 'unavailable', reason, capacityMilliliters: knownCapacity });

  if (!isMl(input.levelUnit) || !isMl(input.capacityUnit)) return unavailable('conflicting_unit');
  if (!capacityValid) return unavailable('invalid_capacity');
  if (level === null || level === undefined) return unavailable('missing_level');
  if (!validAmount(level)) return unavailable('invalid_level');

  const source = input.source && TANK_LEVEL_SOURCES.includes(input.source) ? input.source : null;
  const measuredAt = input.measuredAt ?? null;
  if (level > capacity) return { kind: 'over_capacity', levelMilliliters: level, capacityMilliliters: capacity, source, measuredAt };

  const percent = (level / capacity) * 100;
  return {
    kind: 'ok',
    levelMilliliters: level,
    capacityMilliliters: capacity,
    percent,
    displayPercent: displayPercent(percent),
    band: classifyTankLevel(level, capacity),
    source,
    measuredAt,
  };
}
