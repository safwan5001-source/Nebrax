'use client';

import { api, setToken, clearToken, getToken, hasApiStatus } from './api';
import { inStationApp, getStationToken, setStationToken, clearStationSession, activeUserKey, STATION_LOGIN_PATH, STATION_USER_KEY, STATION_USE_ERP_KEY } from './station-scope';
import { isDemo } from './demo';
import { applyAwjTheme, isAwjTheme, writeAwjThemePreference, type AwjTheme } from './awj-theme';
import { AUTH_SESSION_CHANGED_EVENT, USER_CHANGED_EVENT } from './user-events';

export { AUTH_SESSION_CHANGED_EVENT };

export function notifyAuthSessionChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions?: string[];
  employee_id?: string | null;
  tenant_id: string;
  /** STATION-PIN: جلسة تطبيق المحطات (رقم موظف + PIN) — مقيَّدة خادمياً بمسارات تشغيل المحطات، لا تفتح واجهات أَوْج الإدارية. */
  station_session?: boolean;
  /**
   * نطاق المستخدم نفسه من `/me` (AC-UX-11): **الفراغ = غير مقيَّد**. غيابُ الحقل = لم يُقرأ بعد (تخزين أقدم) لا «غير مقيَّد».
   * للعرض فقط — الخادم هو السلطة.
   */
  branch_ids?: string[];
  warehouse_ids?: string[];
  preferences?: { locale: 'ar' | 'en'; theme: 'system' | 'light' | 'dark'; appTheme?: AwjTheme };
}

/**
 * ═══════════════════════════════════════════════════════════════
 *  مسح تفضيلات الجلسة السابقة — يُستدعى عند كل دخول وخروج وعند الدخول التجريبي
 * ═══════════════════════════════════════════════════════════════
 *  الفرع النشط ووضع المعاينة يعيشان في `localStorage`، فيبقيان بعد تبديل
 *  الحساب. وقد تسبّب ذلك بعطل إنتاج حقيقي: متصفّح احتفظ بفرع المعاينة
 *  (`br-1`) بعد إنشاء حساب حقيقي، فصار يُرسَل في `X-Branch-Id` مع كل طلب.
 *
 *  المسح هنا لا يُغني عن تحصين الخادم (`SetBranch` يتجاهل ما ليس UUID) —
 *  الطبقتان معاً: الخادم لا ينهار، والعميل لا يرسل ما لا يخصّه أصلاً.
 */
export function clearSessionPreferences(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('nibras_active_branch');
  localStorage.removeItem('demo');
}

// الدخول بالبريد وكلمة المرور فقط — البريد فريد عالمياً فيُستنتَج منه المستأجر.
// `remember` يطلب توكن 30 يوماً بدل 7؛ المدة يفرضها الخادم (لا توكن دائم). كلمة المرور لا تُخزَّن أبداً.
export async function login(email: string, password: string, remember = false): Promise<AuthUser> {
  const res = await api<{ token: string; user: AuthUser }>('/login', {
    method: 'POST',
    body: remember ? { email, password, remember: true } : { email, password },
  });
  clearSessionPreferences(); // لا يرث الحسابُ الجديد فرعَ الحساب السابق
  setToken(res.token);
  persistUser(res.user);
  notifyAuthSessionChanged();
  return res.user;
}

export { STATION_LOGIN_PATH };
/** مدخل تطبيق المحطات بعد الدخول. */
export const STATION_HOME_PATH = '/fuel-stations/ops';

/**
 * STATION-PIN: دخول تطبيق المحطات برقم الموظف و PIN من 6 أرقام. المستأجر يُحسم في الخادم من مضيف الصفحة وحده (لا يُرسَل من هنا).
 * الجلسة الناتجة مقيَّدة خادمياً بمسارات المحطات، وتُخزَّن في **مفاتيح مستقلة** (`station_token`/`station_user`): لا تستبدل جلسة أَوْج المفتوحة
 * في المتصفح نفسه ولا تُمسّ بدخول/خروج ERP. الـPIN لا يُخزَّن ولا يُسجَّل، ولا يُمسح فرع أَوْج النشط ولا وضع المعاينة.
 */
export async function stationLogin(employeeNo: string, pin: string): Promise<AuthUser> {
  const res = await api<{ token: string; user: AuthUser }>('/station/login', {
    method: 'POST',
    body: { employee_no: employeeNo, pin },
  });
  clearStationSession(); // دخول موظف جديد يستبدل اعتماد المحطات السابق (جهاز مشترك) فقط
  setStationToken(res.token);
  const user = { ...res.user, station_session: true };
  writeUser(STATION_USER_KEY, user);
  notifyAuthSessionChanged();
  return user;
}

/**
 * موافقة صريحة على استعمال جلسة أَوْج الحالية داخل التطبيق (مدير دخل بالبريد). لا تنسخ التوكن ولا تغيّر جلسة أَوْج، وتُربط بمعرّف مستخدم أَوْج الحالي
 * (تبطل إن تغيّر المستخدم). دخول موظف بـPIN أو خروجه من التطبيق يمسحها (`clearStationSession`) فلا تتسرب إلى جلسة PIN ولا إلى تبديل الموظفين.
 */
export function continueStationWithErpSession(): void {
  let userId: string | null = null;
  try {
    userId = (JSON.parse(localStorage.getItem('user') ?? 'null') as { id?: string } | null)?.id ?? null;
  } catch {
    userId = null;
  }
  if (userId === null || localStorage.getItem('token') === null) return;
  localStorage.setItem(STATION_USE_ERP_KEY, userId);
  notifyAuthSessionChanged();
}

/** هل توجد جلسة أَوْج صالحة الشكل في المتصفح يمكن عرض «المتابعة بها»؟ (اسم للعرض فقط). */
export function erpSessionHint(): { name: string } | null {
  if (typeof window === 'undefined' || localStorage.getItem('token') === null || isDemo()) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem('user') ?? 'null') as AuthUser | null;
    return parsed && typeof parsed.name === 'string' ? { name: parsed.name } : null;
  } catch {
    return null;
  }
}

/** هل المستخدم الفعّال في النطاق الحالي جلسة تطبيق المحطات (رقم موظف + PIN)؟ للعرض فقط — التقييد الحقيقي في الخادم. */
export function isStationSession(): boolean {
  return inStationApp() && getStationToken() !== null && currentUser()?.station_session === true;
}

export interface RegisterPayload {
  company_name: string;
  slug: string;
  email: string;
  password: string;
  phone?: string | null;
  name?: string | null;
  vat_number?: string | null;
}

export interface RegisterTenant {
  id: string;
  name: string;
  slug: string;
  account_number?: string | null;
  support_number?: string | null;
}

export interface RegisterResult {
  user: AuthUser;
  tenant: RegisterTenant;
  /**
   * رمز انتقال أحادي الاستخدام قصير الأجل (دقيقتان) لاستبداله بتوكن دخول
   * عبر `POST /auth/handoff` بعد الانتقال إلى نطاق المستأجر الفعلي — انظر
   * `TENANT-PROVISIONING-E2E-1`. `null` فقط إذا فشل الخادم في إصداره (لا
   * يمنع نجاح التسجيل نفسه)؛ حينها يبقى المستخدم على النطاق الحالي.
   */
  handoffCode: string | null;
}

// تسجيل مؤسسة جديدة: ينشئ المستأجر + المالك + دليل الحسابات، ويعيد توكن الدخول.
export async function register(payload: RegisterPayload): Promise<RegisterResult> {
  // كان هنا `disableDemo()` وحده: يمسح علم المعاينة **ويترك فرعها** في التخزين.
  // فالحساب الحقيقي الجديد كان يرث `nibras_active_branch = "br-1"` ويرسله في
  // كل طلب — وهو منشأ عطل الإنتاج. المسح الآن يشمل الاثنين معاً.
  clearSessionPreferences();
  const res = await api<{ token: string; user: AuthUser; tenant: RegisterTenant; handoff?: { code?: string | null } }>(
    '/register',
    { method: 'POST', body: payload },
  );
  setToken(res.token);
  persistUser(res.user);
  notifyAuthSessionChanged();
  return { user: res.user, tenant: res.tenant, handoffCode: res.handoff?.code ?? null };
}

/** وجهة الهبوط بعد دخول موثَّق: الخدمة الذاتية بلا صلاحيات على شاشات الإدارة — بوابتها المخصَّصة. */
export function landingPathFor(role: string | undefined): string {
  return role === 'self_service' ? '/me' : '/dashboard';
}

export type SessionCheck =
  | { status: 'valid'; user: AuthUser }
  | { status: 'invalid' } // 401: رفضه الخادم (انتهاء/إبطال) — مسحته طبقة `api`
  | { status: 'superseded' } // تغيّر التوكن/الوضع أثناء الطلب (دخول/خروج/استبدال): النتيجة قديمة، لا تُستعمل ولا تُحفظ
  | { status: 'unavailable' }; // شبكة/5xx/403 سياقي: لا حكم، ولا يُمسّ التوكن

/**
 * يتحقق من التوكن المحفوظ عبر `/me` (الخادم هو السلطة؛ المستخدم المخزَّن لا يُصدَّق وحده).
 * فشل مؤقت (انقطاع شبكة، 5xx، سياق مستأجر مختلف) لا يمسح بيانات الاعتماد الصالحة.
 */
export async function checkStoredSession(): Promise<SessionCheck> {
  const sentToken = getToken();
  if (sentToken === null || isDemo()) return { status: 'invalid' };
  // الجلسة التي بدأ بها الفحص ما زالت هي الحالية؟ (دخول/خروج/استبدال أو بدء معاينة أثناء الانتظار يُبطلها)
  const stillCurrent = () => getToken() === sentToken && !isDemo();
  try {
    const res = await api<{ user?: AuthUser }>('/me');
    if (!stillCurrent()) return { status: 'superseded' };
    if (!res?.user || typeof res.user.role !== 'string') return { status: 'unavailable' };
    persistUser(res.user, { applyDisplayPreferences: false });
    return { status: 'valid', user: res.user };
  } catch (error) {
    // 401 للتوكن الحالي تمسحه طبقة `api` نفسها (التوكن صار null): ذلك «غير صالح» لا «استُبدل». استبدال بتوكن آخر أو معاينة = superseded.
    const clearedByThis401 = hasApiStatus(error, 401) && getToken() === null && !isDemo();
    if (!stillCurrent() && !clearedByThis401) return { status: 'superseded' };
    return hasApiStatus(error, 401) ? { status: 'invalid' } : { status: 'unavailable' };
  }
}

export async function logout(): Promise<void> {
  if (inStationApp()) {
    // خروج التطبيق: يُبطل توكن المحطات في الخادم ويمسح اعتماد المحطات وحده. إن كان الاستعمال بموافقة جلسة أَوْج (لا توكن محطات)
    // فلا طلب خروج للخادم: تُسحب الموافقة فقط وتبقى جلسة أَوْج قائمة.
    if (getStationToken() !== null) {
      try {
        await api('/logout', { method: 'POST' });
      } catch {
        // تجاهل أخطاء الشبكة: الجهاز يُمسح دائماً (جهاز مشترك)، والتوكن ينتهي وحده
      }
    }
    clearStationSession();
    notifyAuthSessionChanged();
    return;
  }
  try {
    await api('/logout', { method: 'POST' });
  } catch {
    // تجاهل أخطاء الشبكة عند الخروج
  }
  clearToken();
  clearSessionPreferences();
  notifyAuthSessionChanged();
}

let cachedUserRaw: string | null = null;
let cachedUser: AuthUser | null = null;

/**
 * `applyDisplayPreferences` (الافتراضي true) يطبّق لغة الحساب ووضعه وسمته على هذا الجهاز —
 * صحيح عند الدخول وعند حفظ التفضيلات صراحةً. تحديثُ بيانات المستخدم في الخلفية (مثل
 * إعادة قراءة `/me` في صفحة الإعدادات أو بعد تغيير البريد) يمرّر false، وإلا ألغى
 * بصمتٍ لغةً أو وضعاً اختاره المستخدم من الشريط العلوي (ERP-UX-026).
 */
export function persistUser(user: AuthUser, options: { applyDisplayPreferences?: boolean } = {}): void {
  writeUser(activeUserKey(), user, options);
}

/** يكتب المستخدم في مفتاح نطاقه (`user` لأَوْج، `station_user` للمحطات) ويطبّق التفضيلات عند الطلب. */
function writeUser(key: string, user: AuthUser, options: { applyDisplayPreferences?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  const raw = JSON.stringify(user);
  localStorage.setItem(key, raw);
  cachedUserRaw = raw;
  cachedUser = user;
  window.dispatchEvent(new Event(USER_CHANGED_EVENT));
  if (options.applyDisplayPreferences === false) return;
  const locale = user.preferences?.locale;
  if (locale) document.cookie = `locale=${locale}; path=/; max-age=31536000; samesite=lax`;
  const theme = user.preferences?.theme;
  if (theme) localStorage.setItem('theme', theme);
  // AWJ v3 theme (Default/Ink/Core, Horizon 3) — same sync-on-login pattern as Light/Dark
  // above: seeds localStorage from the server preference so the NEXT pre-paint picks
  // it up, and applies it to the current page immediately (it is a separate axis from
  // data-awj-ui, so this never enables the v3 gate — see src/lib/awj-theme.ts).
  const appTheme = user.preferences?.appTheme;
  if (isAwjTheme(appTheme)) {
    writeAwjThemePreference(appTheme);
    applyAwjTheme(appTheme);
  }
}

/**
 * يعيد نفس مرجع المستخدم ما دامت قيمة `localStorage` نفسها لم تتغير.
 * هذا مهم لمستدعي React الذين يضعون `permissions` أو دوال مشتقة منها ضمن
 * dependency arrays؛ إعادة `JSON.parse` في كل render كانت تنشئ مصفوفة جديدة
 * وتعيد تشغيل effects بلا نهاية (ظهر إنتاجياً في POS Audit كحلقة طلبات API).
 */
export function currentUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  // داخل تطبيق المحطات بلا اعتماد فعّال (لا توكن محطات ولا موافقة استعمال أَوْج) لا مستخدم — لا تُقرأ هوية أَوْج ضمناً.
  if (inStationApp() && getToken() === null) return null;
  const raw = localStorage.getItem(activeUserKey());
  if (!raw) {
    cachedUserRaw = null;
    cachedUser = null;
    return null;
  }
  if (raw === cachedUserRaw && cachedUser) return cachedUser;
  try {
    const parsed = JSON.parse(raw) as AuthUser;
    cachedUserRaw = raw;
    cachedUser = parsed;
    return parsed;
  } catch {
    // قيمة تالفة في localStorage — ننظّفها بدل انهيار العرض
    cachedUserRaw = null;
    cachedUser = null;
    clearToken();
    return null;
  }
}

export function isAuthenticated(): boolean {
  return getToken() !== null || isDemo();
}
