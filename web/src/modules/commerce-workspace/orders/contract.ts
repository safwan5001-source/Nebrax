/**
 * COMMERCE-ORDERS-O1b — عقد واجهة طلبات المتجر للموظف (قراءة فقط).
 *
 * يطابق `GET commerce/orders[/{id}]` (O1a) حرفياً. لا يخترع حقلاً ولا قدرة: الضريبة والخصم غير موجودَين في
 * عقد الطلب فلا يُعرضان. الفرز والترقيم خادميان؛ هذا الملف نقيّ (بلا React) ليُختبر منفرداً.
 */

export type Money = { amount_minor: number; currency: string };

export type OrderPaymentSummary = {
  intent_id: string | null;
  method: string | null;
  status: string | null;
  payment_method_name: string | null;
  amount_minor: number | null;
  collected_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
};

export type OrderChannel = {
  sales_channel_id: string | null;
  sales_channel_name: string | null;
  sales_channel_type: string | null;
  storefront_id: string | null;
  storefront_name: string | null;
};

/** أسباب الإلغاء المعتمدة (ADR-28 D-9-R2) — تطابق قائمة الخادم حرفياً. */
export const CANCELLATION_REASONS = ['customer_request', 'out_of_stock', 'payment_issue', 'duplicate_order', 'fraud_suspected', 'other'] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];
export const CANCELLATION_NOTE_MAX = 500;

/** كتلة الإلغاء (O3a-1): القائمة بالحقائق الموجزة، والتفاصيل بالفاعل والملاحظة. حقول اختيارية: خادم أقدم لا يرسلها. */
export type OrderCancellation = {
  cancelled: boolean;
  at: string | null;
  reason: string | null;
  by?: { id: string; name: string | null } | null;
  note?: string | null;
};

/**
 * عقد قراءة إجراء الإلغاء (O3b) — **استرشادي**: غيابه ⇒ لا يُعرض الإجراء (بوابة مغلقة أو بلا صلاحية، ولا تُكشف أيّهما). حضوره ⇒ `available` ومانع
 * بسبب آمن إن وُجد. القرار النهائي لـAPI الإلغاء دائماً.
 */
export type CancelAction = { available: boolean; blocked_reason: string | null };

/**
 * COPS-H1-4/H1-5 — بُعد القبول (مستقل عن دورة الحياة والدفع والتنفيذ). `mode` لقطة الإنشاء (`auto`|`manual`)، و`effective_mode` ما يُنفَّذ الآن
 * (بوابة القبول مغلقة ⇒ `auto` مهما كانت اللقطة). `accepted_at` يوجد للقبول اليدوي فقط. حقول اختيارية: خادم أقدم لا يرسلها ⇒ لا بيانات قبول تُعرض.
 */
export type OrderAcceptance = {
  mode: string;
  effective_mode: string;
  accepted_at: string | null;
  by?: { id: string; name: string | null } | null;
};

/** حالة تشغيلية **مشتقّة للعرض فقط** (`CommerceOrderStatusProjector`) — لا تُستعمل شرطاً لإجراء؛ الإجراءات من `accept_action`/`reject_action`/`cancel_action`. */
export const OPERATIONAL_STATUSES = [
  'cancelled', 'draft', 'awaiting_payment', 'payment_cancelled', 'awaiting_acceptance', 'accepted',
  'preparing', 'ready', 'out_for_delivery', 'delivery_failed', 'returned_to_store', 'delivered', 'picked_up',
] as const;

/**
 * COPS-H2-3 — تنفيذ الطلب. الحالات والأنواع وأسباب الفشل تطابق الخادم حرفياً (H2-1). الإجراءات تأتي **من عقد القراءة وحده** (`fulfillment_actions`)
 * ولا يستنتجها المتصفح من الحالة؛ الخادم يحكم دائماً تحت الأقفال. التنفيذ تشغيلي: لا قيد ولا مخزون ولا تحصيل.
 */
export const FULFILLMENT_STATUSES = ['preparing', 'ready', 'out_for_delivery', 'delivery_failed', 'returned_to_store', 'delivered', 'picked_up'] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];
export const FULFILLMENT_STATUS_FILTERS = [...FULFILLMENT_STATUSES, 'not_started'] as const;
export const FULFILLMENT_ACTIONS = ['start', 'mark_ready', 'dispatch', 'deliver', 'fail', 'return', 'pickup'] as const;
export type FulfillmentActionName = (typeof FULFILLMENT_ACTIONS)[number];
export const FAILURE_REASONS = ['customer_unreachable', 'address_issue', 'recipient_absent', 'customer_refused', 'other'] as const;
export const FULFILLMENT_NOTE_MAX = 500;
export const FULFILLMENT_FIELD_MAX = 100;
export const FULFILLMENT_URL_MAX = 500;

export type FulfillmentActionItem = { action: string; available: boolean; blocked_reason: string | null };

/** كتلة تنفيذ الموظف (داخلية: الناقل/التتبع/الساعي/سبب الفشل) — تغيب حين لا صف. */
export type OrderFulfillment = {
  status: string;
  type: string;
  version: number;
  warehouse: { id: string | null; name: string | null };
  carrier: { name: string | null; tracking_number: string | null; tracking_url: string | null };
  courier: { name: string | null; phone: string | null };
  delivery_attempts: number;
  last_failure: { reason: string; note: string | null; at: string | null } | null;
  timestamps: Record<string, string | null>;
};

/** عقدا قراءة إجراءَي القبول والرفض (استرشاديان، كـ`CancelAction`): غيابهما ⇒ لا إجراء (بوابة مغلقة أو صلاحية ناقصة، ولا يُكشف أيّهما). */
export type AcceptAction = { available: boolean; blocked_reason: string | null };
export type RejectAction = { available: boolean; blocked_reason: string | null };

/** سبب الرفض المخزَّن في كتلة الإلغاء (ADR-29 §2.2): إلغاء بسبب `merchant_rejected`. */
export const REJECTION_REASON = 'merchant_rejected';
export const REJECTION_NOTE_MAX = 500;

export type OrderSummary = {
  id: string;
  number: string;
  status: string;
  /** `draft|confirmed|cancelled` مشتقّة (O3a-1). غائبة من خادم أقدم ⇒ يُستعمل `status`. */
  lifecycle_status?: string;
  operational_status?: string;
  acceptance?: OrderAcceptance;
  /** موجز التنفيذ في القائمة — يغيب حين لا صف. */
  fulfillment?: { status: string; type: string };
  cancellation?: OrderCancellation;
  created_at: string | null;
  confirmed_at: string | null;
  total: Money;
  items_count: number;
  delivery_method: string | null;
  customer: { name: string | null; phone: string | null };
  channel: OrderChannel;
  payment: OrderPaymentSummary;
};

export type OrderAddress = Record<string, string | null>;

export type OrderLine = {
  id: string;
  parent_line_id: string | null;
  product_id: string | null;
  product_variant_id: string | null;
  product_name: string;
  variant: string | null;
  unit_name: string | null;
  quantity: number;
  unit_price: Money;
  line_total: Money;
  personalization: { key: string; label: string; label_en: string | null; value: string | null; value_label: string | null }[];
};

export type OrderAttempt = {
  id: string;
  capture_status: string;
  amount: Money;
  captured: Money;
  review_reasons: string[];
  captured_at: string | null;
  created_at: string | null;
};

export type OrderDetail = Omit<OrderSummary, 'fulfillment'> & {
  /** كتلة التنفيذ الكاملة — تغيب حين لا صف. حقائق مخزَّنة تُقرأ دائماً (مهما كان وضع بوابة التنفيذ). */
  fulfillment?: OrderFulfillment;
  /** الإجراءات التالية الصالحة (استرشادي): تغيب حين البوابة مغلقة أو تنقص `commerce.orders.manage`. فارغة ⇒ لا إجراء (مكتمل/ملغى). */
  fulfillment_actions?: FulfillmentActionItem[];
  cancel_action?: CancelAction;
  accept_action?: AcceptAction;
  reject_action?: RejectAction;
  partner_id: string | null;
  delivery_amount: Money;
  contact: {
    name: string | null;
    company: string | null;
    email: string | null;
    phone: string | null;
    vat_number: string | null;
    cr_number: string | null;
  };
  shipping_address: OrderAddress | null;
  billing_address: OrderAddress | null;
  gift: {
    recipient_name: string | null;
    recipient_phone: string | null;
    sender_display_name: string | null;
    hide_sender: boolean;
    message: string | null;
  } | null;
  schedule: {
    method: string | null;
    date: string | null;
    slot: { label: string | null; label_en: string | null; start_time: string | null; end_time: string | null };
    timezone: string | null;
  } | null;
  items: OrderLine[];
  payment: OrderPaymentSummary & { collection_note: string | null; attempts: OrderAttempt[] };
  accounting:
    | { posted: false }
    | { posted: true; invoice_id: string; payment_id: string; accounting_date: string | null; amount: Money };
};

export type OrdersMeta = { current_page: number; per_page: number; total: number; last_page: number };

/** حدود الخادم (O1a): per_page ≤ 50، q بين 2 و100 حرف، فرز بقائمة بيضاء. */
export const ORDERS_MAX_PER_PAGE = 50;
export const ORDERS_DEFAULT_PER_PAGE = 20;
export const ORDERS_PER_PAGE_OPTIONS = [20, 50];
export const ORDERS_SORT_COLUMNS = ['created_at', 'total', 'number'] as const;
export const ORDERS_Q_MIN = 2;
export const ORDERS_Q_MAX = 100;

/** مرشّح حالة القبول (H1-5) — يطابق `acceptance_status` في الخادم حرفياً؛ بُعد مستقل عن حالة الدفع والدورة. */
export const ACCEPTANCE_STATUSES = ['awaiting_acceptance', 'accepted', 'auto'] as const;

export const PAYMENT_STATUSES = ['pending', 'awaiting_collection', 'collected', 'paid', 'cancelled'] as const;
export const PAYMENT_METHODS = ['cod', 'pay_on_pickup', 'online'] as const;
export const DELIVERY_METHODS = ['standard', 'pickup'] as const;

/** `all` = كل المتاجر؛ غيابها مع متجر محسوم = المتجر النشط. */
export type OrdersListState = {
  q: string;
  scopeAll: boolean;
  salesChannelId: string;
  paymentStatus: string;
  paymentMethod: string;
  deliveryMethod: string;
  acceptanceStatus: string;
  fulfillmentStatus: string;
  from: string;
  to: string;
  /** `-created_at` | `created_at` | `-total` ... */
  sort: string;
  page: number;
  perPage: number;
};

export const DEFAULT_ORDERS_STATE: OrdersListState = {
  q: '',
  scopeAll: false,
  salesChannelId: '',
  paymentStatus: '',
  paymentMethod: '',
  deliveryMethod: '',
  acceptanceStatus: '',
  fulfillmentStatus: '',
  from: '',
  to: '',
  sort: '-created_at',
  page: 1,
  perPage: ORDERS_DEFAULT_PER_PAGE,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | '' {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : '';
}

/** يقرأ الحالة من الرابط؛ أي قيمة خارج القوائم المسموحة تسقط إلى الافتراضي (لا تصل إلى الخادم أبداً). */
export function parseOrdersState(params: URLSearchParams): OrdersListState {
  const sortRaw = params.get('sort') ?? '';
  const sortKey = sortRaw.replace(/^-/, '');
  const page = Number.parseInt(params.get('page') ?? '1', 10);
  const perPage = Number.parseInt(params.get('per_page') ?? '', 10);
  const channel = params.get('channel') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  return {
    q: (params.get('q') ?? '').slice(0, ORDERS_Q_MAX),
    scopeAll: params.get('scope') === 'all',
    salesChannelId: UUID.test(channel) ? channel : '',
    paymentStatus: oneOf(params.get('payment_status'), PAYMENT_STATUSES),
    paymentMethod: oneOf(params.get('payment_method'), PAYMENT_METHODS),
    deliveryMethod: oneOf(params.get('delivery_method'), DELIVERY_METHODS),
    acceptanceStatus: oneOf(params.get('acceptance_status'), ACCEPTANCE_STATUSES),
    fulfillmentStatus: oneOf(params.get('fulfillment_status'), FULFILLMENT_STATUS_FILTERS),
    from: DATE.test(from) ? from : '',
    to: DATE.test(to) ? to : '',
    sort: (ORDERS_SORT_COLUMNS as readonly string[]).includes(sortKey) ? sortRaw : DEFAULT_ORDERS_STATE.sort,
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 100000) : 1,
    perPage: ORDERS_PER_PAGE_OPTIONS.includes(perPage) ? perPage : ORDERS_DEFAULT_PER_PAGE,
  };
}

/** معاملات الرابط المرئي (تُحفظ للعودة من التفاصيل). لا تتضمن `store` — يملكه سياق المتجر. */
export function serializeOrdersState(state: OrdersListState): URLSearchParams {
  const p = new URLSearchParams();
  if (state.q.trim()) p.set('q', state.q.trim());
  if (state.scopeAll) p.set('scope', 'all');
  if (state.salesChannelId) p.set('channel', state.salesChannelId);
  if (state.paymentStatus) p.set('payment_status', state.paymentStatus);
  if (state.paymentMethod) p.set('payment_method', state.paymentMethod);
  if (state.deliveryMethod) p.set('delivery_method', state.deliveryMethod);
  if (state.acceptanceStatus) p.set('acceptance_status', state.acceptanceStatus);
  if (state.fulfillmentStatus) p.set('fulfillment_status', state.fulfillmentStatus);
  if (state.from) p.set('from', state.from);
  if (state.to) p.set('to', state.to);
  if (state.sort !== DEFAULT_ORDERS_STATE.sort) p.set('sort', state.sort);
  if (state.page > 1) p.set('page', String(state.page));
  if (state.perPage !== ORDERS_DEFAULT_PER_PAGE) p.set('per_page', String(state.perPage));
  return p;
}

/**
 * استعلام API. `storefrontId` يأتي من المتجر النشط حين لا يكون النطاق «كل المتاجر»؛ `storefront_id` و
 * `sales_channel_id` مفتاحان مستقلان ولا يُستنتج أحدهما من الآخر. نصّ البحث أقصر من الحد الأدنى لا يُرسَل.
 */
export function buildOrdersQuery(state: OrdersListState, storefrontId: string | null): URLSearchParams {
  const p = new URLSearchParams();
  const q = state.q.trim();
  if (q.length >= ORDERS_Q_MIN) p.set('q', q.slice(0, ORDERS_Q_MAX));
  if (!state.scopeAll && storefrontId) p.set('storefront_id', storefrontId);
  if (state.salesChannelId) p.set('sales_channel_id', state.salesChannelId);
  if (state.paymentStatus) p.set('payment_status', state.paymentStatus);
  if (state.paymentMethod) p.set('payment_method', state.paymentMethod);
  if (state.deliveryMethod) p.set('delivery_method', state.deliveryMethod);
  if (state.acceptanceStatus) p.set('acceptance_status', state.acceptanceStatus);
  if (state.fulfillmentStatus) p.set('fulfillment_status', state.fulfillmentStatus);
  if (state.from) p.set('from', state.from);
  if (state.to && (!state.from || state.to >= state.from)) p.set('to', state.to);
  p.set('sort', state.sort.replace(/^-/, ''));
  p.set('direction', state.sort.startsWith('-') ? 'desc' : 'asc');
  p.set('page', String(state.page));
  p.set('per_page', String(Math.min(state.perPage, ORDERS_MAX_PER_PAGE)));
  return p;
}

export type OrdersErrorKind = 'forbidden' | 'not_found' | 'validation' | 'network' | 'unknown';

export function classifyOrdersError(error: unknown): OrdersErrorKind {
  const status = typeof error === 'object' && error !== null && 'status' in error ? (error as { status?: unknown }).status : undefined;
  if (status === 403 || status === 401) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 422) return 'validation';
  if (typeof status === 'number') return 'unknown';
  return 'network';
}

/** هللات ← نص ريال؛ عملة غير SAR تُعرض برمزها دون افتراض تحويل. */
export function moneyParts(money: Money | null | undefined): { minor: number; currency: string } | null {
  if (!money || !Number.isFinite(money.amount_minor)) return null;
  return { minor: money.amount_minor, currency: money.currency };
}

/** هل الطلب بلا أثر محاسبي؟ (لتنبيه التفاصيل) — `collected` وحدها ليست قيداً. */
export function needsAccountingWarning(order: Pick<OrderDetail, 'accounting' | 'payment'>): boolean {
  return order.accounting.posted === false;
}

/** حالة دورة الحياة المعروضة: المشتقّة من الخادم إن وُجدت وإلا `status` الخام. */
export function lifecycleOf(order: Pick<OrderSummary, 'status' | 'lifecycle_status'>): string {
  return order.lifecycle_status ?? order.status;
}

/**
 * شارة القبول للعرض: **مشتقّة من حقائق القبول** لا من الدفع. `null` ⇒ لا شارة (لا بيانات قبول من خادم أقدم، أو حالة لا تخص القبول مثل
 * طلب بانتظار الدفع الإلكتروني أو ملغى بسبب غير الرفض). الترتيب: رفض التاجر ← قبول يدوي ← بانتظار القبول ← قبول تلقائي.
 */
export type AcceptanceBadgeKind = 'rejected' | 'accepted' | 'awaiting' | 'auto';

export function acceptanceBadgeOf(order: Pick<OrderSummary, 'acceptance' | 'operational_status' | 'cancellation'>): AcceptanceBadgeKind | null {
  if (order.cancellation?.cancelled && order.cancellation.reason === REJECTION_REASON) return 'rejected';
  const acceptance = order.acceptance;
  if (!acceptance) return null;
  if (acceptance.accepted_at) return 'accepted';
  if (order.operational_status === 'awaiting_acceptance') return 'awaiting';
  if (order.operational_status === 'accepted' && acceptance.effective_mode === 'auto') return 'auto';

  return null;
}
