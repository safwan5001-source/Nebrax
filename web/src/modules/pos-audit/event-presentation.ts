import { formatRiyal } from '@/lib/money';
import { isTechnicalFieldPath, valuesEqual } from '@/lib/technical-data';

export type JsonRecord = Record<string, unknown>;

export interface AuditEventLike {
  type: string;
  amount: string | null;
  reason_code: string | null;
  reason_note: string | null;
  source?: string;
  trust_level?: string;
  created_at: string | null;
  cart_id: string | null;
  correlation_id: string | null;
  branch_id?: string | null;
  pos_session_id?: string;
  payload: JsonRecord;
  actor?: { id: string; name: string } | null;
  performed_by_user?: { id: string; name: string } | null;
  approved_by_user?: { id: string; name: string } | null;
  session?: { id: string; number: string; device?: { id: string; name: string; code: string | null } | null } | null;
}

export interface SummaryRow {
  /** مفتاح ترجمة تحت posAudit.summaryFields.* أو نص جاهز عبر value فقط. */
  field: string;
  value: string;
  mono?: boolean;
}

export interface DiffRow {
  field: string;
  before: string;
  after: string;
  /** مسار تقني خام — للعرض الاحتياطي عند غياب ترجمة. */
  path: string;
}

const MONEY_LEAVES = new Set([
  'unit_price',
  'discount',
  'amount',
  'counted_balance',
  'expected_balance',
  'difference',
  'applied_credit_amount',
  'cash_refund_amount',
]);

/** يستخرج client_observed / server_observed إن وُجد، وإلا الحمولة كاملة. */
export function observedPayload(payload: JsonRecord): JsonRecord {
  const clientObserved = payload.client_observed;
  if (clientObserved && typeof clientObserved === 'object' && !Array.isArray(clientObserved)) {
    return clientObserved as JsonRecord;
  }
  const serverObserved = payload.server_observed;
  if (serverObserved && typeof serverObserved === 'object' && !Array.isArray(serverObserved)) {
    return serverObserved as JsonRecord;
  }
  return payload;
}

export function asRecord(value: unknown): JsonRecord | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonRecord;
  return null;
}

function leafName(path: string): string {
  return path.split('.').pop() ?? path;
}

function formatLeafValue(
  path: string,
  value: unknown,
  formatMoneyMinor: (minor: string | number) => string,
  formatStatus?: (status: string) => string,
): string {
  if (value === null || value === undefined) return '—';
  const leaf = leafName(path);
  if (leaf === 'status' && typeof value === 'string') {
    return formatStatus ? formatStatus(value) : value;
  }
  if (MONEY_LEAVES.has(leaf) && (typeof value === 'number' || typeof value === 'string')) {
    return formatMoneyMinor(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  if (Array.isArray(value)) return String(value.length);
  return JSON.stringify(value);
}

/** يحوّل هللة (minor) إلى نص عرض بالريال — حمولات before/after تُحفظ بالهللات. */
export function formatPayloadMoney(minor: string | number): string {
  const n = Number(minor);
  if (!Number.isFinite(n)) return '—';
  return formatRiyal(n / 100);
}

/** يجمع أوراق قابلة للمقارنة؛ يتخطّى المعرّفات التقنية من طبقة الـ diff البشرية. */
export function collectComparableLeaves(value: unknown, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (value === undefined) return out;

  if (value === null || typeof value !== 'object') {
    if (prefix && !isTechnicalFieldPath(prefix)) out.set(prefix, value);
    return out;
  }

  if (Array.isArray(value)) {
    if (prefix && !isTechnicalFieldPath(prefix)) out.set(prefix, value.length);
    return out;
  }

  const record = value as JsonRecord;
  for (const [key, child] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isTechnicalFieldPath(path)) continue;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      const nested = collectComparableLeaves(child, path);
      nested.forEach((v, k) => out.set(k, v));
    } else if (Array.isArray(child)) {
      out.set(path, child.length);
    } else {
      out.set(path, child);
    }
  }
  return out;
}

/**
 * يبني فروقاً للحقول المتغيّرة فقط.
 * ترتيب المفاتيح لا يُعدّ تغيّراً. الحقول غير المعروفة تظهر بمسارها الخام (fallback آمن).
 */
export function buildEventDiff(
  before: unknown,
  after: unknown,
  options?: {
    formatMoneyMinor?: (minor: string | number) => string;
    formatStatus?: (status: string) => string;
  },
): DiffRow[] {
  const formatMoneyMinor = options?.formatMoneyMinor ?? formatPayloadMoney;
  if (before === undefined && after === undefined) return [];
  if (valuesEqual(before ?? null, after ?? null)) return [];

  const beforeLeaves = collectComparableLeaves(before ?? null);
  const afterLeaves = collectComparableLeaves(after ?? null);
  const paths = new Set([...beforeLeaves.keys(), ...afterLeaves.keys()]);
  const rows: DiffRow[] = [];

  for (const path of [...paths].sort()) {
    const leftPresent = beforeLeaves.has(path);
    const rightPresent = afterLeaves.has(path);
    // تغيّر شكلي (حقل متداخل اختفى لأن after بلا نفس الحاوية) لا يُعرض كفرق بشري.
    if (path.includes('.') && leftPresent !== rightPresent) continue;
    const left = leftPresent ? beforeLeaves.get(path) : undefined;
    const right = rightPresent ? afterLeaves.get(path) : undefined;
    if (valuesEqual(left ?? null, right ?? null)) continue;
    const leaf = leafName(path);
    rows.push({
      path,
      field: leaf,
      before: left === undefined ? '—' : formatLeafValue(path, left, formatMoneyMinor, options?.formatStatus),
      after: right === undefined ? '—' : formatLeafValue(path, right, formatMoneyMinor, options?.formatStatus),
    });
  }
  return rows;
}

function itemFromObserved(observed: JsonRecord): JsonRecord | null {
  const direct = asRecord(observed.item);
  if (direct) return direct;
  const before = asRecord(observed.before);
  const fromBefore = before ? asRecord(before.item) : null;
  if (fromBefore) return fromBefore;
  const after = asRecord(observed.after);
  return after ? asRecord(after.item) : null;
}

function customerLabel(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  if (typeof record.name === 'string' && record.name) return record.name;
  return null;
}

/**
 * ملخص تشغيلي من بيانات الحدث الموجودة فقط — بلا اختلاق.
 */
export function buildEventSummaryRows(
  event: AuditEventLike,
  options: {
    /** تنسيق عمود amount القادم من الـ API بالريال. */
    formatAmount?: (riyal: string | number) => string;
    /** تنسيق مبالغ الحمولة المحفوظة بالهللات. */
    formatMoneyMinor?: (minor: string | number) => string;
    formatDate: (value: string | null) => string;
    statusLabel?: (status: string) => string;
  },
): SummaryRow[] {
  const formatAmount = options.formatAmount ?? ((riyal) => formatRiyal(riyal));
  const formatMoneyMinor = options.formatMoneyMinor ?? formatPayloadMoney;
  const observed = observedPayload(event.payload);
  const rows: SummaryRow[] = [];
  const item = itemFromObserved(observed) ?? asRecord(event.payload.item);

  if (item) {
    if (typeof item.description === 'string' && item.description) {
      rows.push({ field: 'product', value: item.description });
    }
    if (item.quantity !== undefined && item.quantity !== null) {
      rows.push({ field: 'quantity', value: String(item.quantity), mono: true });
    }
    if (item.unit_price !== undefined && item.unit_price !== null) {
      rows.push({ field: 'price', value: formatMoneyMinor(item.unit_price as string | number), mono: true });
    }
    if (item.discount !== undefined && item.discount !== null && Number(item.discount) !== 0) {
      rows.push({ field: 'discount', value: formatMoneyMinor(item.discount as string | number), mono: true });
    }
  }

  const reason = event.reason_note ?? event.reason_code;
  if (reason) rows.push({ field: 'reason', value: reason });

  const performer = event.performed_by_user?.name ?? event.actor?.name;
  if (performer) rows.push({ field: 'performedBy', value: performer });

  if (event.approved_by_user?.name) {
    rows.push({ field: 'approvedBy', value: event.approved_by_user.name });
  }

  if (event.session?.number) {
    rows.push({ field: 'session', value: event.session.number, mono: true });
  }

  if (event.amount) {
    rows.push({ field: 'amount', value: formatAmount(event.amount), mono: true });
  }

  if (event.created_at) {
    rows.push({ field: 'time', value: options.formatDate(event.created_at) });
  }

  const before = asRecord(observed.before);
  const after = asRecord(observed.after);
  const beforeStatus = before && typeof before.status === 'string' ? before.status : null;
  const afterStatus = after && typeof after.status === 'string' ? after.status : null;
  if (beforeStatus || afterStatus) {
    const label = options.statusLabel ?? ((s) => s);
    const left = beforeStatus ? label(beforeStatus) : '—';
    const right = afterStatus ? label(afterStatus) : '—';
    if (left !== right) rows.push({ field: 'change', value: `${left} → ${right}` });
  }

  const beforeCustomer = customerLabel(before?.customer) ?? customerLabel(observed.customer);
  const afterCustomer = customerLabel(after?.customer);
  if (beforeCustomer || afterCustomer) {
    if (beforeCustomer && afterCustomer && beforeCustomer !== afterCustomer) {
      rows.push({ field: 'customer', value: `${beforeCustomer} → ${afterCustomer}` });
    } else {
      rows.push({ field: 'customer', value: afterCustomer ?? beforeCustomer ?? '—' });
    }
  }

  return rows;
}

export function eventReference(payload: JsonRecord): string | null {
  const observed = observedPayload(payload);
  for (const key of [
    'invoice_number',
    'invoice_id',
    'held_sale_id',
    'return_id',
    'exchange_id',
    'cash_movement_id',
    'approval_id',
    'return_number',
  ]) {
    const value = observed[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

/** حمولة التفاصيل التقنية الكاملة — دون حذف أي دليل. */
export function buildTechnicalEvidence(event: AuditEventLike): JsonRecord {
  return {
    id: (event as { id?: string }).id ?? null,
    cart_id: event.cart_id,
    correlation_id: event.correlation_id,
    pos_session_id: event.pos_session_id ?? null,
    branch_id: event.branch_id ?? null,
    source: event.source ?? null,
    trust_level: event.trust_level ?? null,
    payload: event.payload,
  };
}
