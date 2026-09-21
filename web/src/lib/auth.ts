'use client';

import { api, setToken, clearToken, getToken } from './api';
import { isDemo } from './demo';

/** تغيّر جلسة المصادقة: يمسح المستهلكون الذاكرة المقيدة بالهوية السابقة. */
export const AUTH_SESSION_CHANGED_EVENT = 'nibras:auth-session-changed';

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
  preferences?: { locale: 'ar' | 'en'; theme: 'system' | 'light' | 'dark' };
}

/**
 * ═══════════════════════════════════════════════════════════════
 *  مسح تفضيلات الجلسة السابقة — يُستدعى عند كل دخول وخروج
 * ═══════════════════════════════════════════════════════════════
 *  الفرع النشط ووضع المعاينة يعيشان في `localStorage`، فيبقيان بعد تبديل
 *  الحساب. وقد تسبّب ذلك بعطل إنتاج حقيقي: متصفّح احتفظ بفرع المعاينة
 *  (`br-1`) بعد إنشاء حساب حقيقي، فصار يُرسَل في `X-Branch-Id` مع كل طلب.
 *
 *  المسح هنا لا يُغني عن تحصين الخادم (`SetBranch` يتجاهل ما ليس UUID) —
 *  الطبقتان معاً: الخادم لا ينهار، والعميل لا يرسل ما لا يخصّه أصلاً.
 */
function clearSessionPreferences(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('nibras_active_branch');
  localStorage.removeItem('demo');
}

// الدخول بالبريد وكلمة المرور فقط — البريد فريد عالمياً فيُستنتَج منه المستأجر.
export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await api<{ token: string; user: AuthUser }>('/login', {
    method: 'POST',
    body: { email, password },
  });
  clearSessionPreferences(); // لا يرث الحسابُ الجديد فرعَ الحساب السابق
  setToken(res.token);
  persistUser(res.user);
  notifyAuthSessionChanged();
  return res.user;
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

export async function logout(): Promise<void> {
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

export function persistUser(user: AuthUser): void {
  if (typeof window === 'undefined') return;
  const raw = JSON.stringify(user);
  localStorage.setItem('user', raw);
  cachedUserRaw = raw;
  cachedUser = user;
  const locale = user.preferences?.locale;
  if (locale) document.cookie = `locale=${locale}; path=/; max-age=31536000; samesite=lax`;
  const theme = user.preferences?.theme;
  if (theme) localStorage.setItem('theme', theme);
}

/**
 * يعيد نفس مرجع المستخدم ما دامت قيمة `localStorage` نفسها لم تتغير.
 * هذا مهم لمستدعي React الذين يضعون `permissions` أو دوال مشتقة منها ضمن
 * dependency arrays؛ إعادة `JSON.parse` في كل render كانت تنشئ مصفوفة جديدة
 * وتعيد تشغيل effects بلا نهاية (ظهر إنتاجياً في POS Audit كحلقة طلبات API).
 */
export function currentUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('user');
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
