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

/**
 * الترتيب هو ترتيب التصوّر المعتمد (RTL: منصات التوصيل ثم المتاجر في الصف الأول،
 * وبوابات الدفع ثم الشحن في الثاني). منصات التوصيل تدخل **القسم القائم**
 * `/delivery-platforms` — لا مسار مكرر، ولا مسار `/integrations/*` قبل INT-UX-2.
 */
export const INTEGRATION_CATEGORIES: readonly IntegrationCategory[] = [
  { key: 'delivery', href: '/delivery-platforms' },
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
