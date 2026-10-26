/**
 * AWJ-STORE-CTX-1 — مصدر واحد لسياق المتجر النشط في مساحة التجارة.
 *
 * السبب الجذري الذي يعالجه: كان الاختيار حالةَ React في الذاكرة فقط، فأيّ تحميل كامل للمستند (تحديث، رابط مباشر،
 * تبويب جديد، أو تنقّل صلب كـ«تطبيق الثيم» في البنّاء) يُعيد المزوّد إلى `stores[0]` — والقائمة مرتّبة بالاسم من
 * الخادم، فيصير «زهور الرشد» نشطاً بدل «زهور طيبة» دون أن يختاره أحد.
 *
 * ترتيب الحسم (أول ما يتوفّر يحكم، ولا سقوط صامت بينها):
 *   1. `?store=` في الرابط — رابط مباشر أو تبويب جديد من رابط يحمل المتجر.
 *   2. ذاكرة **هذا التبويب** (`sessionStorage`) — تحديث الصفحة أو تنقّل صلب داخل التبويب نفسه.
 *   3. لا سياق إطلاقاً (أول دخول للتبويب): متجرٌ وحيد يُختار تلقائياً؛ وأكثر من متجر ⇒ `needs_selection`
 *      (AWJ-STORE-CTX-2، قرار المالك): لا متجر افتراضي — يختار المستخدم صراحةً.
 *
 * طلبٌ صريح (1 أو 2) لمتجر غير موجود في قائمة المستأجر الحالي يصير `invalid`: لا متجر نشط، ولا قراءة ولا حفظ،
 * حتى يختار المستخدم متجراً صراحةً. لا `localStorage` ولا مستمع `storage`: تبويبٌ لا يغيّر متجر تبويب آخر.
 *
 * هذا سياق عرضٍ لا سلطة: الخادم يحسم المستأجر من `TenantContext` ويتحقق من ملكية `{id}` في كل مسار.
 */

import type { CommerceStoreCatalog } from './stores';

export const ACTIVE_STORE_QUERY_PARAM = 'store';
export const ACTIVE_STORE_SESSION_KEY = 'awj-commerce-active-store';

export type ActiveStoreRequestSource = 'url' | 'session' | 'user';
export type ActiveStoreRequest = { id: string; source: ActiveStoreRequestSource } | null;

export type ActiveStoreResolution =
  | { status: 'pending'; storeId: null }
  | { status: 'ready'; storeId: string }
  | { status: 'invalid'; storeId: null; requestedId: string }
  | { status: 'needs_selection'; storeId: null };

/**
 * صفحات على مستوى المستأجر لا تقرأ المتجر النشط (قائمة المتاجر، المنتجات المنشورة، التصنيفات، التكاملات): تبقى
 * متاحة بلا متجر محسوم. أي صفحة غيرها — وكل صفحة جديدة افتراضياً — محجوبة حتى يُحسم المتجر.
 */
export const STORE_AGNOSTIC_COMMERCE_PATHS = [
  '/commerce/stores',
  '/commerce/published-products',
  '/commerce/merchandising',
  '/commerce/integrations',
  // الطلبات تدعم «كل المتاجر» صراحةً (مرشِّح المتجر داخل الصفحة)، فلا تُحجب بانتظار اختيار متجر.
  '/commerce/orders',
] as const;

export function isStoreAgnosticCommercePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return STORE_AGNOSTIC_COMMERCE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** معرّف معقول الشكل فقط؛ أي قيمة أخرى في الرابط/الذاكرة تُعامَل كأنها غير موجودة لا كطلب. */
function normalizeId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id !== '' && id.length <= 64 && /^[A-Za-z0-9-]+$/.test(id) ? id : null;
}

export function resolveActiveStore(
  catalog: CommerceStoreCatalog,
  request: ActiveStoreRequest,
): ActiveStoreResolution {
  if (catalog.status !== 'ready') return { status: 'pending', storeId: null };
  if (request) {
    return catalog.stores.some((store) => store.id === request.id)
      ? { status: 'ready', storeId: request.id }
      : { status: 'invalid', storeId: null, requestedId: request.id };
  }
  if (catalog.stores.length === 1) return { status: 'ready', storeId: catalog.stores[0].id };
  return catalog.stores.length > 1 ? { status: 'needs_selection', storeId: null } : { status: 'pending', storeId: null };
}

export function readStoreParam(search: string): string | null {
  return normalizeId(new URLSearchParams(search).get(ACTIVE_STORE_QUERY_PARAM));
}

/** يُقرأ مرة واحدة عند تركيب المزوّد (تحميل المستند)، لا عند كل تنقّل داخل التطبيق. */
export function readInitialStoreRequest(): ActiveStoreRequest {
  if (typeof window === 'undefined') return null;
  const fromUrl = readStoreParam(window.location.search);
  if (fromUrl) return { id: fromUrl, source: 'url' };
  try {
    const fromSession = normalizeId(window.sessionStorage.getItem(ACTIVE_STORE_SESSION_KEY));
    if (fromSession) return { id: fromSession, source: 'session' };
  } catch {
    // ذاكرة التبويب اختيارية؛ غيابها يعني «لا سياق» فقط.
  }
  return null;
}

export function rememberActiveStore(storeId: string): void {
  try {
    window.sessionStorage.setItem(ACTIVE_STORE_SESSION_KEY, storeId);
  } catch {
    // أفضل جهد: الرابط يحمل المتجر أيضاً.
  }
}

export function withStoreParam(href: string, storeId: string | null | undefined): string {
  if (!storeId) return href;
  const [pathAndQuery, hash = ''] = href.split('#', 2);
  const [path, query = ''] = pathAndQuery.split('?', 2);
  const params = new URLSearchParams(query);
  params.set(ACTIVE_STORE_QUERY_PARAM, storeId);
  return `${path}?${params.toString()}${hash ? `#${hash}` : ''}`;
}

/**
 * يُبقي `?store=` في شريط العنوان مطابقاً للمتجر النشط (بلا إدخال جديد في السجلّ)، فيصمد السياق أمام التحديث
 * ونسخ الرابط وفتحه في تبويب آخر. يحافظ على بقية معاملات الاستعلام (`version`، `previewTheme`، ...).
 */
export function syncStoreParamInUrl(storeId: string): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (url.searchParams.get(ACTIVE_STORE_QUERY_PARAM) === storeId) return;
  url.searchParams.set(ACTIVE_STORE_QUERY_PARAM, storeId);
  // `null` (كبقية الشاشات) لا `history.state`: Next.js يرقّع `replaceState` ويُزامن موجّهه مع الرابط الجديد فقط حين
  // لا تحمل البيانات حالته الداخلية؛ وإلا أعاد لاحقاً كتابة الرابط القانوني القديم فأسقط `?store=`.
  window.history.replaceState(null, '', url.toString());
}
