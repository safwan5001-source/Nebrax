import { deliveryPlatformPresentations } from '@/lib/delivery-platform-registry';
import { COMMUNICATIONS_CATALOG_HREF } from '@/lib/communications-providers';

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

export type IntegrationCategoryKey = 'delivery' | 'ecommerce' | 'payments' | 'shipping' | 'communications';

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
  // AWJ-COMMS-UX-01: تُلحَق في النهاية كي لا تتحرك مواضع البطاقات المعتمدة. كتالوج وصفي ثابت بلا قراءة خادم.
  { key: 'communications', href: COMMUNICATIONS_CATALOG_HREF },
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

/** كـ`rows` لكن أي عنصر غير كائن يُفسد الحمولة كلها (`null`) بدل أن يُهمَل بصمت. للقارئين الصارمين في INT-UX-2. */
function strictRows(payload: unknown): Record<string, unknown>[] | null {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  if (!data.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row))) return null;
  return data as Record<string, unknown>[];
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

/**
 * إعداد ملف منصة الإسناد اليدوي (إنشاء/تعديل) يتطلب `company.manage` على الخادم (`POST/PUT /delivery-platforms`).
 * القراءة وحدها `invoices.view`، فمن لا يملك هذه الصلاحية لا يُعرض عليه رابط إعداد لا يستطيع إكماله.
 */
export const PROFILE_MANAGE_PERMISSION = 'company.manage';
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
  /** حقل دليل وُجد في الحمولة لكن بصيغة غير مقبولة: يُخفى ولا يُعرض، ولا يمسّ أي حالة جاهزية. */
  evidenceMalformed: boolean;
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
  const list = strictRows(payload);
  if (list === null) return null;
  const known = new Set(deliveryPlatformKeys());
  const result = new Map<string, 'set' | 'disabled'>();
  for (const row of list) {
    // مفتاح غير نصّي أو مفقود = صف مشوّه (لا منصة مجهولة): القراءة كلها غير مقروءة. المفاتيح النصّية المجهولة فقط تُتجاهل.
    if (typeof row.platform_key !== 'string') return null;
    if (!known.has(row.platform_key)) continue;
    // صف لمنصة معروفة بلا علم منطقي صالح = انحراف في عقد الـAPI: القراءة كلها غير مقروءة، لا «غير مهيأة».
    if (typeof row.is_active !== 'boolean') return null;
    // ملف مفعّل واحد يكفي؛ المعطّل لا يُلغي مفعّلاً آخر لنفس المنصة.
    if (row.is_active === true) result.set(row.platform_key, 'set');
    else if (!result.has(row.platform_key)) result.set(row.platform_key, 'disabled');
  }
  return result;
}

const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * معرّف ملف الإسناد اليدوي **المفعّل** لكل منصة معروفة (INT-UX-5c): يحتاجه الإنشاء لأن الخادم يطلب `delivery_platform_profile_id`.
 * القراءة صارمة كـ`readManualStatuses`: حمولة منحرفة ⇒ `null`. منصة بلا ملف مفعّل لا تظهر في الخريطة.
 */
export function readActiveProfileIds(payload: unknown): Map<string, string> | null {
  const list = strictRows(payload);
  if (list === null) return null;
  const known = new Set(deliveryPlatformKeys());
  const result = new Map<string, string>();
  for (const row of list) {
    if (typeof row.platform_key !== 'string') return null;
    if (!known.has(row.platform_key)) continue;
    if (typeof row.is_active !== 'boolean') return null;
    if (row.is_active !== true || result.has(row.platform_key)) continue;
    if (typeof row.id !== 'string' || !PROFILE_ID_PATTERN.test(row.id)) return null;
    result.set(row.platform_key, row.id);
  }
  return result;
}

/** القيم التقنية التي يُرجعها الخادم (`DeliveryProviderReadiness::TECHNICAL_STATUSES`). */
const TECHNICAL_VALUES: ReadonlySet<string> = new Set(['READY', 'BLOCKED', 'OWNER_GATE']);
const EVIDENCE_REF_PATTERN = /^[^\u0000-\u001f\u007f]{1,300}$/;

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * حقل دليل داخلي اختياري (للمالك/المدير فقط). الغياب (`undefined`/`null`) صالح: هكذا تصل الاستجابة العامة.
 * الحاضر يجب أن يطابق صيغته المعروفة، وإلا يُخفى (`value: null`) ويُعلَّم مشوّهاً. الحقل وصفيّ فقط:
 * تشويهه لا يُسقط قراءة الجاهزية ولا يغيّر حالة أي منصة.
 */
function evidenceField(raw: unknown, valid: (text: string) => boolean): { value: string | null; malformed: boolean } {
  if (raw === undefined || raw === null) return { value: null, malformed: false };
  return typeof raw === 'string' && valid(raw) ? { value: raw, malformed: false } : { value: null, malformed: true };
}

/**
 * صفوف `GET /delivery-platforms/readiness`. الخادم يُرجع المنصات الست دائماً؛ لذا حمولة
 * ينقص فيها صفّ معروف، أو يحمل صفٌّ معروف `ux_state` غير نصّي أو علماً غير منطقي، تعود
 * `null` (قراءة فاشلة بشعار إعادة المحاولة) لا خريطة جزئية تبدو ناجحة. تكرار مفتاح معروف مرفوض كذلك. صفوف المنصات
 * المجهولة تُتجاهل. حقول الدليل الاختيارية لا تدخل في هذا الحكم: تشويهها يُخفيها ويُعلَّم بـ`evidenceMalformed` فقط.
 */
export function readReadinessRows(payload: unknown): Map<string, ReadinessRow> | null {
  const list = strictRows(payload);
  if (list === null) return null;
  const known = new Set(deliveryPlatformKeys());
  const result = new Map<string, ReadinessRow>();
  for (const row of list) {
    // مفتاح غير نصّي أو مفقود = صف مشوّه (لا منصة مجهولة): القراءة كلها غير مقروءة. المفاتيح النصّية المجهولة فقط تُتجاهل.
    if (typeof row.platform_key !== 'string') return null;
    if (!known.has(row.platform_key)) continue;
    if (typeof row.ux_state !== 'string' || typeof row.connect_enabled !== 'boolean' || typeof row.sync_enabled !== 'boolean') return null;
    // صفّان لمنصة واحدة: ترتيبهما كان سيحدّد الحالة المعروضة، فالحمولة غير موثوقة.
    if (result.has(row.platform_key)) return null;
    const technical = evidenceField(row.technical, (text) => TECHNICAL_VALUES.has(text));
    const evidenceDate = evidenceField(row.evidence_date, isCalendarDate);
    const evidenceRef = evidenceField(row.evidence_ref, (text) => text.trim() === text && EVIDENCE_REF_PATTERN.test(text));
    result.set(row.platform_key, {
      platformKey: row.platform_key,
      uxState: row.ux_state,
      connectEnabled: row.connect_enabled,
      syncEnabled: row.sync_enabled,
      technical: technical.value,
      evidenceDate: evidenceDate.value,
      evidenceRef: evidenceRef.value,
      evidenceMalformed: technical.malformed || evidenceDate.malformed || evidenceRef.malformed,
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
