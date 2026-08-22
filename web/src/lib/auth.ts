'use client';

import { api, setToken, clearToken, getToken } from './api';
import { isDemo } from './demo';

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

// تسجيل مؤسسة جديدة: ينشئ المستأجر + المالك + دليل الحسابات، ويعيد توكن الدخول.
export async function register(payload: RegisterPayload): Promise<AuthUser> {
  // كان هنا `disableDemo()` وحده: يمسح علم المعاينة **ويترك فرعها** في التخزين.
  // فالحساب الحقيقي الجديد كان يرث `nibras_active_branch = "br-1"` ويرسله في
  // كل طلب — وهو منشأ عطل الإنتاج. المسح الآن يشمل الاثنين معاً.
  clearSessionPreferences();
  const res = await api<{ token: string; user: AuthUser }>('/register', {
    method: 'POST',
    body: payload,
  });
  setToken(res.token);
  persistUser(res.user);
  return res.user;
}

export async function logout(): Promise<void> {
  try {
    await api('/logout', { method: 'POST' });
  } catch {
    // تجاهل أخطاء الشبكة عند الخروج
  }
  clearToken();
  clearSessionPreferences();
}

export function persistUser(user: AuthUser): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('user', JSON.stringify(user));
  const locale = user.preferences?.locale;
  if (locale) document.cookie = `locale=${locale}; path=/; max-age=31536000; samesite=lax`;
  const theme = user.preferences?.theme;
  if (theme) localStorage.setItem('theme', theme);
}

export function currentUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    // قيمة تالفة في localStorage — ننظّفها بدل انهيار العرض
    clearToken();
    return null;
  }
}

export function isAuthenticated(): boolean {
  return getToken() !== null || isDemo();
}
