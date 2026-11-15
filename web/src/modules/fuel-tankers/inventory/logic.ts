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
  // PR-6B-0 (قراءة فقط): الفترة المقفلة، تعارض تسوية الوردية، غياب الحساب الوسيط.
  'period_locked', 'settlement_mode_conflict', 'clearing_account_missing',
  // PR-6B-1: الحساب الوسيط معيَّن لكن لم يعد صالحاً.
  'clearing_account_invalid',
] as const;
export const REVIEW_REASONS = ['capacity_overrun', 'insufficient_balance', 'overdue'] as const;
export const REQUIREMENTS = ['pool_quantity_equals_warehouse_stock', 'pool_value_equals_fuel_share_of_ledger_1140'] as const;

export interface ReadinessItem {
  readiness: Readiness;
  blockers: string[];
  reviewReasons: string[];
  overdue: boolean;
  /** PR-6B-1: سند تاريخي (قبل بدء الترحيل أو بدء غير محدد) — وسم عرض فقط. */
  historical: boolean;
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
  warehouseName: string | null;
  fuelProductId: string;
  fuelProductName: string | null;
  stockMilliliters: number | null;
  costPoolMilliliters: number | null;
  quantityInSync: boolean | null;
  /** يوجد في المخزن نفسه سندات معلّقة لمحطات أخرى (يُعلَن وجودها فقط؛ الكميات المعروضة لمحطات المراجع وحدها). */
  sharedWithOtherStations: boolean;
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
    historical: item.historical === true,
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
    warehouseName: text(pool.warehouse_name),
    fuelProductId: pool.fuel_product_id,
    fuelProductName: text(pool.fuel_product_name),
    stockMilliliters: int(pool.stock_milliliters),
    costPoolMilliliters: int(pool.cost_pool_milliliters),
    quantityInSync: typeof pool.quantity_in_sync === 'boolean' ? pool.quantity_in_sync : null,
    sharedWithOtherStations: pool.shared_with_other_stations === true,
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

// ───────────────────────── PR-6B-0: مطابقة الأستاذ (قراءة فقط) ─────────────────────────

/** رموز النتائج التي يُصدرها الخادم (`FuelInventoryLedgerReconciliation`)؛ غير المعروف يُعرض بنص عام. */
export const FINDINGS = [
  'pool_quantity_mismatch', 'stock_without_cost_pool', 'cost_pool_without_stock_record', 'state_not_derived_from_movements', 'open_cost_history',
  'value_difference', 'entry_amount_differs_from_movements', 'movements_without_journal', 'inventory_account_split_configured', 'inventory_account_split_in_ledger',
  'linked_entries_touch_unlisted_asset_accounts',
] as const;
export const isKnownFinding = (code: string) => (FINDINGS as readonly string[]).includes(code);
/** حدود الدقة المعلنة من الخادم (`data_quality.not_checked`) ومصادر حسابات المخزون المعروفة. */
export const LIMITS = ['price_and_average_correctness', 'manual_inventory_entries_not_linked_to_fuel_movements', 'non_fuel_lines_inside_linked_entries', 'tank_level_vs_book_stock'] as const;
export const ACCOUNT_SOURCES = ['role_current', 'system_default', 'history', 'station_override', 'station_override_history'] as const;
export const isKnownLimit = (code: string) => (LIMITS as readonly string[]).includes(code);
export const isKnownAccountSource = (code: string) => (ACCOUNT_SOURCES as readonly string[]).includes(code);

export interface ReconPool {
  warehouseName: string | null;
  fuelProductName: string | null;
  stockMilliliters: number | null;
  costPoolMilliliters: number | null;
  differenceMilliliters: number | null;
  findings: string[];
  /** يغيب لمن لا يملك `products.view_cost`. */
  valueMinor: number | null;
  stateVsMovementsValueMinor: number | null;
}

export interface ReconBranch {
  branchName: string | null;
  poolValueMinor: number;
  ledgerShareMinor: number;
  differenceMinor: number;
  inSync: boolean;
  causes: { entryAmountDiffers: number; reversedEntries: number; movementsWithoutJournal: number; stateVsMovements: number };
  unexplainedMinor: number;
  movementsWithoutJournalCount: number;
}

export interface ReconEntry { number: string; entryDate: string; source: string; movementDeltaMinor: number; ledgerNetMinor: number; differenceMinor: number }
export interface ReconAccount { code: string | null; name: string | null; sources: string[] }
export interface ReconFinding { code: string; severity: 'error' | 'warning'; count: number | null }

export type ValueScope = 'tenant_by_branch' | 'restricted_warehouse_scope' | 'hidden_no_cost_permission';

export interface Reconciliation {
  consistent: boolean;
  pools: ReconPool[];
  poolSummary: { pools: number; inSync: number; mismatched: number };
  valueScope: ValueScope;
  branches: ReconBranch[];
  entriesTotal: number;
  entries: ReconEntry[];
  accounts: ReconAccount[];
  /** أصول مسّتها قيود وقود ولا تنتمي للمجموعة المعلنة (المجموعة ناقصة). */
  unlistedAccounts: ReconAccount[];
  /** المراجع مقيَّد بفروع: دليل الأستاذ (عدّ قيود وحسابات) محجوب. */
  evidenceHidden: boolean;
  splitInLedger: boolean;
  stationOverrides: number;
  findings: ReconFinding[];
  notChecked: string[];
}

const VALUE_SCOPES: readonly ValueScope[] = ['tenant_by_branch', 'restricted_warehouse_scope', 'hidden_no_cost_permission'];

/** تحليل دفاعي: غياب حقل ⇒ قيمة آمنة؛ نطاق قيمة مجهول ⇒ «مخفي» (لا نفترض أن القيمة معروضة). الحالة «متطابقة» لا تُعلن إلا إن أعلنها الخادم وخلت النتائج. */
export function readReconciliation(payload: unknown): Reconciliation {
  const data = obj(obj(payload).data);
  const quantity = obj(data.quantity);
  const summary = obj(quantity.summary);
  const value = obj(data.value);
  const accounts = obj(data.inventory_accounts);
  const scope = VALUE_SCOPES.includes(data.value_scope as ValueScope) ? (data.value_scope as ValueScope) : 'hidden_no_cost_permission';
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const findings = list(data.findings).map((raw): ReconFinding | null => {
    const f = obj(raw);
    return typeof f.code === 'string' ? { code: f.code, severity: f.severity === 'error' ? 'error' : 'warning', count: int(f.count) } : null;
  }).filter((f): f is ReconFinding => f !== null);

  return {
    consistent: data.status === 'consistent' && findings.length === 0,
    pools: list(quantity.pools).map((raw): ReconPool => {
      const p = obj(raw);
      return {
        warehouseName: text(p.warehouse_name), fuelProductName: text(p.fuel_product_name), stockMilliliters: int(p.stock_milliliters), costPoolMilliliters: int(p.cost_pool_milliliters),
        differenceMilliliters: int(p.quantity_difference_milliliters), findings: strings(p.findings), valueMinor: int(p.cost_pool_value_minor), stateVsMovementsValueMinor: int(p.state_vs_movements_value_minor),
      };
    }),
    poolSummary: { pools: int(summary.pools) ?? 0, inSync: int(summary.in_sync) ?? 0, mismatched: int(summary.mismatched) ?? 0 },
    valueScope: scope,
    branches: list(value.branches).map((raw): ReconBranch => {
      const b = obj(raw);
      const c = obj(b.causes);
      return {
        branchName: text(b.branch_name), poolValueMinor: int(b.pool_value_minor) ?? 0, ledgerShareMinor: int(b.ledger_share_minor) ?? 0, differenceMinor: int(b.difference_minor) ?? 0,
        inSync: b.in_sync === true, unexplainedMinor: int(b.unexplained_minor) ?? 0, movementsWithoutJournalCount: int(b.movements_without_journal_count) ?? 0,
        causes: { entryAmountDiffers: int(c.entry_amount_differs_minor) ?? 0, reversedEntries: int(c.reversed_entries_minor) ?? 0, movementsWithoutJournal: int(c.movements_without_journal_minor) ?? 0, stateVsMovements: int(c.state_vs_movements_minor) ?? 0 },
      };
    }),
    entriesTotal: int(obj(value.entries_with_amount_difference).total) ?? 0,
    entries: list(obj(value.entries_with_amount_difference).sample).map((raw): ReconEntry => {
      const e = obj(raw);
      return { number: text(e.number) ?? '', entryDate: text(e.entry_date) ?? '', source: text(e.source) ?? '', movementDeltaMinor: int(e.movement_delta_minor) ?? 0, ledgerNetMinor: int(e.ledger_net_minor) ?? 0, differenceMinor: int(e.difference_minor) ?? 0 };
    }),
    accounts: list(accounts.accounts).map((raw): ReconAccount => { const a = obj(raw); return { code: text(a.code), name: text(a.name), sources: strings(a.sources) }; }),
    unlistedAccounts: list(accounts.unlisted_asset_accounts).map((raw): ReconAccount => { const a = obj(raw); return { code: text(a.code), name: text(a.name), sources: [] }; }),
    evidenceHidden: accounts.ledger_evidence_hidden_by_branch_scope === true,
    splitInLedger: accounts.split_in_ledger === true,
    stationOverrides: list(accounts.station_overrides).length,
    findings,
    notChecked: strings(obj(data.data_quality).not_checked),
  };
}
