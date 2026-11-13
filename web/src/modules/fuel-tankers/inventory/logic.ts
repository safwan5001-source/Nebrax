/**
 * TANKER-PR6A — منطق نقي لقراءة استجابة مراجعة جاهزية الدمج المخزني. **قراءة فقط**: الواجهة لا تنفّذ ترحيلاً ولا خصماً؛ الخادم هو السلطة في التصنيف.
 * التحليل دفاعي: حقل مفقود أو بقيمة غريبة ⇒ قيمة آمنة، وتصنيف مجهول ⇒ «يحتاج مراجعة» لا «جاهز» (فشل مغلق).
 */
export const READINESS = ['ready', 'needs_review', 'blocked'] as const;
export type Readiness = (typeof READINESS)[number];

/** الرموز الثابتة التي يُصدرها الخادم (`FuelTankerFillInventoryReadiness`)؛ غير المعروف يُعرض بنص عام. */
export const BLOCKERS = [
  'station_not_active', 'station_warehouse_required', 'warehouse_unavailable', 'warehouse_branch_mismatch', 'fuel_product_unavailable', 'stock_record_missing',
  'cost_baseline_required', 'cost_history_open', 'cost_pool_quantity_mismatch', 'insufficient_balance',
] as const;
export const REVIEW_REASONS = ['capacity_overrun', 'insufficient_balance', 'overdue'] as const;
export const REQUIREMENTS = ['pool_quantity_equals_warehouse_stock', 'pool_value_equals_fuel_share_of_ledger_1140'] as const;

export interface ReadinessItem {
  readiness: Readiness;
  blockers: string[];
  reviewReasons: string[];
  overdue: boolean;
  ageHours: number;
  availableMilliliters: number | null;
  cumulativeMilliliters: number | null;
}

export interface ReviewRow {
  id: string;
  number: string;
  voucherNumber: string;
  stationId: string;
  quantityLiters: string;
  quantityMilliliters: number;
  ownerName: string | null;
  tankerPlate: string | null;
  recordedAt: string | null;
  attachmentsCount: number | null;
  readiness: ReadinessItem;
}

export interface PoolSummary {
  warehouseId: string;
  fuelProductId: string;
  stockMilliliters: number | null;
  costPoolMilliliters: number | null;
  quantityInSync: boolean | null;
  pendingCount: number;
  pendingTotalMilliliters: number;
  shortfallMilliliters: number | null;
  /** يغيب لمن لا يملك `products.view_cost`. */
  costPoolValueMinor: number | null;
}

export interface ReviewSummary { total: number; ready: number; needsReview: number; blocked: number; overdue: number }

export interface ReviewPage {
  rows: ReviewRow[];
  pools: PoolSummary[];
  summary: ReviewSummary;
  page: number;
  lastPage: number;
  total: number;
  truncated: boolean;
  /** الترحيل غير مفعَّل (ثابت في الخادم)؛ أي قيمة غير `false` تُعامَل كأنها مفعّلة لكن الواجهة لا تُظهر أي إجراء ترحيل في الحالتين. */
  postingEnabled: boolean;
  requirements: string[];
}

const obj = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const int = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null);
const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

export function readReadiness(raw: unknown): ReadinessItem {
  const item = obj(raw);
  const pool = obj(item.pool);
  const readiness = (READINESS as readonly string[]).includes(item.readiness as string) ? (item.readiness as Readiness) : 'needs_review';
  return {
    readiness,
    blockers: strings(item.blockers),
    reviewReasons: strings(item.review_reasons),
    overdue: item.overdue === true,
    ageHours: Math.max(0, int(item.age_hours) ?? 0),
    availableMilliliters: int(pool.available_milliliters),
    cumulativeMilliliters: int(pool.cumulative_milliliters),
  };
}

function readRow(raw: unknown): ReviewRow | null {
  const row = obj(raw);
  if (typeof row.id !== 'string' || typeof row.number !== 'string') return null;
  return {
    id: row.id,
    number: row.number,
    voucherNumber: text(row.voucher_number) ?? '',
    stationId: text(row.fuel_station_id) ?? '',
    quantityLiters: text(row.quantity_liters) ?? '',
    quantityMilliliters: int(row.quantity_milliliters) ?? 0,
    ownerName: text(obj(row.owner).name),
    tankerPlate: text(obj(row.tanker).plate_number),
    recordedAt: text(row.recorded_at),
    attachmentsCount: int(row.attachments_count),
    readiness: readReadiness(row.inventory_readiness),
  };
}

function readPool(raw: unknown): PoolSummary | null {
  const pool = obj(raw);
  if (typeof pool.warehouse_id !== 'string' || typeof pool.fuel_product_id !== 'string') return null;
  return {
    warehouseId: pool.warehouse_id,
    fuelProductId: pool.fuel_product_id,
    stockMilliliters: int(pool.stock_milliliters),
    costPoolMilliliters: int(pool.cost_pool_milliliters),
    quantityInSync: typeof pool.quantity_in_sync === 'boolean' ? pool.quantity_in_sync : null,
    pendingCount: int(pool.pending_count) ?? 0,
    pendingTotalMilliliters: int(pool.pending_total_milliliters) ?? 0,
    shortfallMilliliters: int(pool.shortfall_milliliters),
    costPoolValueMinor: int(pool.cost_pool_value_minor),
  };
}

export function readReview(payload: unknown): ReviewPage {
  const body = obj(payload);
  const meta = obj(body.meta);
  const summary = obj(meta.summary);
  const rows = (Array.isArray(body.data) ? body.data : []).map(readRow).filter((row): row is ReviewRow => row !== null);
  return {
    rows,
    pools: (Array.isArray(meta.pools) ? meta.pools : []).map(readPool).filter((pool): pool is PoolSummary => pool !== null),
    summary: { total: int(summary.total) ?? 0, ready: int(summary.ready) ?? 0, needsReview: int(summary.needs_review) ?? 0, blocked: int(summary.blocked) ?? 0, overdue: int(summary.overdue) ?? 0 },
    page: Math.max(1, int(meta.page) ?? 1),
    lastPage: Math.max(1, int(meta.last_page) ?? 1),
    total: int(meta.total) ?? rows.length,
    truncated: meta.truncated === true,
    postingEnabled: meta.posting_enabled !== false,
    requirements: strings(meta.reconciliation_requirements),
  };
}

const KNOWN_BLOCKERS = new Set<string>(BLOCKERS);
const KNOWN_REASONS = new Set<string>(REVIEW_REASONS);
export const isKnownBlocker = (code: string) => KNOWN_BLOCKERS.has(code);
export const isKnownReason = (code: string) => KNOWN_REASONS.has(code);

/** مللتر صحيح ⇒ لترات بثلاث منازل كنص بلا float (كالخادم). */
export function litersOf(milliliters: number | null): string {
  if (milliliters === null) return '—';
  const sign = milliliters < 0 ? '-' : '';
  const abs = Math.abs(milliliters);
  return `${sign}${Math.trunc(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
}
