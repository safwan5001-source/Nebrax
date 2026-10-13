import { deliveryPlatformPresentations } from '@/lib/delivery-platform-registry';

/**
 * مركز التكاملات (INT-UX-1) — منطق نقيّ لا يلمس الشبكة ولا الواجهة.
 *
 * طبقة حقيقة فوق منظومات قائمة، لا مالكة لها (DLV-INTEGRATIONS-UX-DESIGN-1 AD-1):
 * ملفات المنصات وصندوق التوصيل ونقطة البيع تبقى حيث هي. هذا الملف يعرّف
 * البطاقات الأربع وترتيبها، ويقرأ حمولتين قائمتين بعد التحقق من شكلهما:
 *  - `GET /delivery-platforms` ← الخطوة A (إسناد يدوي في نقطة البيع، لكل مستأجر).
 *  - `GET /delivery-platforms/readiness` ← الخطوة B (جاهزية التكامل الأصلي، INT-READY-1).
 * أي شكل غير متوقع يعود `null` («تعذّرت القراءة»)، لا صفراً: الصفر ادّعاء، والفشل
 * ليس ادّعاءً. وبهذا لا يتحوّل خطأ جلب إلى جملة مضلّلة مثل «لا تكاملات متاحة».
 */

export type IntegrationCategoryKey = 'delivery' | 'ecommerce' | 'payments' | 'shipping';

export interface IntegrationCategory {
  key: IntegrationCategoryKey;
  /** وجهة موجودة فعلاً، أو `null` لفئة مستقبلية خاملة (لا رابط ولا مسار). */
  href: string | null;
}

/** كتالوج منصات التوصيل داخل المركز (INT-UX-2). شاشة الإعداد القديمة `/delivery-platforms` تبقى كما هي. */
export const DELIVERY_CATALOG_HREF = '/integrations/delivery-platforms';

/**
 * الترتيب هو ترتيب التصوّر المعتمد (RTL: منصات التوصيل ثم المتاجر في الصف الأول،
 * وبوابات الدفع ثم الشحن في الثاني). منصات التوصيل تدخل كتالوجها داخل المركز
 * (INT-UX-2)؛ كان مدخلها `/delivery-platforms` في INT-UX-1 قبل وجود الكتالوج.
 */
export const INTEGRATION_CATEGORIES: readonly IntegrationCategory[] = [
  { key: 'delivery', href: DELIVERY_CATALOG_HREF },
  { key: 'ecommerce', href: null },
  { key: 'payments', href: null },
  { key: 'shipping', href: null },
];

/** حالة بوابة الدخول إلى منصات التوصيل. */
export type DeliveryAccess = 'checking' | 'allowed' | 'denied' | 'app_off';

export const DELIVERY_PERMISSION = 'invoices.view';
export const DELIVERY_APPLICATION_KEY = 'sales.pos';

/** قراءة `GET /applications/nav-state`: خريطة مفاتيح → ظاهر؟ فشل القراءة لا يحجب شيئاً. */
export function isApplicationHidden(payload: unknown, key: string): boolean {
  const data = (payload as { data?: unknown } | null)?.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return false;
  return (data as Record<string, unknown>)[key] === false;
}

export interface DeliverySummary {
  /** منصات مفعّلة للإسناد اليدوي من الست، أو `null` إن تعذّرت القراءة. */
  setUp: number | null;
  total: number;
  /** منصات تكاملها الأصلي متاح فعلاً (`READY_TO_CONNECT`)، أو `null` إن تعذّرت القراءة. */
  nativeAvailable: number | null;
}

function rows(payload: unknown): Record<string, unknown>[] | null {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  return data.filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object' && !Array.isArray(row));
}

/** عدد المنصات الست المفعّلة. مفتاح خارج السجلّ لا يُحتسب. */
export function readSetUpCount(payload: unknown): number | null {
  const list = rows(payload);
  if (list === null) return null;
  const known = new Set(deliveryPlatformPresentations().map((platform) => platform.key));
  const active = new Set<string>();
  for (const row of list) {
    if (typeof row.platform_key === 'string' && known.has(row.platform_key) && row.is_active === true) {
      active.add(row.platform_key);
    }
  }
  return active.size;
}

/**
 * عدد المزوّدين المتاحين للتكامل الأصلي. يعتمد `ux_state` العام وحده؛ لا يقرأ
 * `technical` ولا مرجع الدليل (للمالك/المدير فقط)، ولا يفترض غياب حقل = جاهزية.
 * حمولة بلا `ux_state` صالحة لأي صف ⇒ `null` (لا نخمّن «لا شيء متاح»).
 */
export function readNativeAvailableCount(payload: unknown): number | null {
  const list = rows(payload);
  if (list === null || list.length === 0) return null;
  if (!list.every((row) => typeof row.ux_state === 'string')) return null;
  return list.filter((row) => row.ux_state === 'READY_TO_CONNECT').length;
}

export function deliverySummary(profiles: unknown, readiness: unknown): DeliverySummary {
  return {
    setUp: readSetUpCount(profiles),
    total: deliveryPlatformPresentations().length,
    nativeAvailable: readNativeAvailableCount(readiness),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INT-UX-2 — سُلّم القدرات الأربع (A/B/C/D) لكل منصة.
//
// أربع حقائق مستقلة بمصادر مستقلة (DLV-INTEGRATIONS-UX-DESIGN-1 §3). لا تُدمج في شارة
// واحدة، ولا يُشتق أي منها من آخر. القراءة الفاشلة أو غير المفهومة تعود «تعذّرت القراءة»
// ولا تُعامَل أبداً كنجاح ولا كـ«لا يوجد»: الفشل المغلق هو القاعدة.
// ─────────────────────────────────────────────────────────────────────────────

export const HUB_VIEW_PERMISSION = 'delivery_hub.view';
export const DELIVERY_REPORT_PERMISSION = 'reports.view';
export const DELIVERY_CONNECTOR_VIEW_PERMISSION = 'delivery_connector.view';

/** منصة معروفة في السجلّ المركزي؟ (مفتاح الواجهة يُتحقَّق منه قبل أي طلب). */
export function isKnownDeliveryPlatform(key: string): boolean {
  return deliveryPlatformPresentations().some((platform) => platform.key === key);
}

/** مفاتيح المنصات الست بترتيب السجلّ المركزي (نفس ترتيب نقطة الجاهزية). */
export function deliveryPlatformKeys(): string[] {
  return deliveryPlatformPresentations().map((platform) => platform.key);
}

export type ManualAttributionStatus = 'unset' | 'set' | 'disabled' | 'unreadable';
export type NativeStatus = 'unavailable' | 'pending' | 'available' | 'unreadable';
/** الخطوتان C وD: لا مصدر بيانات لهما اليوم، فتُشتقّان من B فقط ولا تُقرآن من أي مكان. */
export type DownstreamStatus = 'blocked' | 'no_data' | 'unreadable';

export interface ReadinessRow {
  platformKey: string;
  uxState: string;
  connectEnabled: boolean;
  syncEnabled: boolean;
  /** حقول داخلية يرسلها الخادم لمن يملك `delivery_connector.view` فقط. */
  technical: string | null;
  evidenceDate: string | null;
  evidenceRef: string | null;
}

export interface DeliveryLadder {
  platformKey: string;
  a: ManualAttributionStatus;
  b: NativeStatus;
  c: DownstreamStatus;
  d: DownstreamStatus;
}

/**
 * حالة الإسناد اليدوي لكل منصة من `GET /delivery-platforms`. غياب ملف المنصة يعني
 * «غير مهيأة» (`unset`) — قراءة ناجحة بنتيجة صريحة — أما حمولة غير مقروءة، أو صف معروف بعلم غير منطقي، فتعود `null`.
 */
export function readManualStatuses(payload: unknown): Map<string, 'set' | 'disabled'> | null {
  const list = rows(payload);
  if (list === null) return null;
  const known = new Set(deliveryPlatformKeys());
  const result = new Map<string, 'set' | 'disabled'>();
  for (const row of list) {
    if (typeof row.platform_key !== 'string' || !known.has(row.platform_key)) continue;
    // صف لمنصة معروفة بلا علم منطقي صالح = انحراف في عقد الـAPI: القراءة كلها غير مقروءة، لا «غير مهيأة».
    if (typeof row.is_active !== 'boolean') return null;
    // ملف مفعّل واحد يكفي؛ المعطّل لا يُلغي مفعّلاً آخر لنفس المنصة.
    if (row.is_active === true) result.set(row.platform_key, 'set');
    else if (!result.has(row.platform_key)) result.set(row.platform_key, 'disabled');
  }
  return result;
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * صفوف `GET /delivery-platforms/readiness`. الخادم يُرجع المنصات الست دائماً؛ لذا حمولة
 * ينقص فيها صفّ معروف، أو يحمل صفٌّ معروف `ux_state` غير نصّي أو علماً غير منطقي، تعود
 * `null` (قراءة فاشلة بشعار إعادة المحاولة) لا خريطة جزئية تبدو ناجحة. تكرار مفتاح معروف مرفوض كذلك. صفوف المنصات
 * المجهولة تُتجاهل.
 */
export function readReadinessRows(payload: unknown): Map<string, ReadinessRow> | null {
  const list = rows(payload);
  if (list === null) return null;
  const known = new Set(deliveryPlatformKeys());
  const result = new Map<string, ReadinessRow>();
  for (const row of list) {
    if (typeof row.platform_key !== 'string' || !known.has(row.platform_key)) continue;
    if (typeof row.ux_state !== 'string' || typeof row.connect_enabled !== 'boolean' || typeof row.sync_enabled !== 'boolean') return null;
    // صفّان لمنصة واحدة: ترتيبهما كان سيحدّد الحالة المعروضة، فالحمولة غير موثوقة.
    if (result.has(row.platform_key)) return null;
    result.set(row.platform_key, {
      platformKey: row.platform_key,
      uxState: row.ux_state,
      connectEnabled: row.connect_enabled,
      syncEnabled: row.sync_enabled,
      technical: nullableText(row.technical),
      evidenceDate: nullableText(row.evidence_date),
      evidenceRef: nullableText(row.evidence_ref),
    });
  }
  return known.size === result.size ? result : null;
}

/**
 * الخطوة B من صف الجاهزية، فشلاً مغلقاً: `available` تتطلب `READY_TO_CONNECT` **و**
 * `connect_enabled=true` معاً؛ وأي تناقض (حالة غير جاهزة مع علم مفعّل، أو مزامنة بلا ربط،
 * أو `ux_state` لا نعرفه) ⇒ `unreadable`، لا نخمّن أنه جاهز ولا أنه غير جاهز.
 */
export function nativeStatusOf(row: ReadinessRow | null | undefined): NativeStatus {
  if (!row) return 'unreadable';
  if (row.syncEnabled && !row.connectEnabled) return 'unreadable';
  switch (row.uxState) {
    case 'NOT_SUPPORTED':
      return row.connectEnabled ? 'unreadable' : 'unavailable';
    case 'AWAITING_PROVIDER_APPROVAL':
      return row.connectEnabled ? 'unreadable' : 'pending';
    case 'READY_TO_CONNECT':
      return row.connectEnabled ? 'available' : 'unreadable';
    default:
      return 'unreadable';
  }
}

/** سُلّم منصة واحدة. `manual`/`readiness` = `null` تعني أن قراءتها فشلت كلياً. */
export function deliveryLadder(
  platformKey: string,
  manual: Map<string, 'set' | 'disabled'> | null,
  readiness: Map<string, ReadinessRow> | null,
): DeliveryLadder {
  const a: ManualAttributionStatus = manual === null ? 'unreadable' : manual.get(platformKey) === 'set' ? 'set' : manual.get(platformKey) === 'disabled' ? 'disabled' : 'unset';
  const b = nativeStatusOf(readiness?.get(platformKey));
  // C وD لا مصدر لهما: لا نموذج اتصال في النظام. لا نقرأهما ولا نخترع لهما قيمة.
  const downstream: DownstreamStatus = b === 'available' ? 'no_data' : b === 'unreadable' ? 'unreadable' : 'blocked';
  return { platformKey, a, b, c: downstream, d: downstream };
}
