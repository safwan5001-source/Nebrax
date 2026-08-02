'use client';

import { api, setToken, clearToken, getToken } from './api';
import { isDemo, disableDemo } from './demo';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  tenant_id: string;
}

// الدخول بالبريد وكلمة المرور فقط — البريد فريد عالمياً فيُستنتَج منه المستأجر.
export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await api<{ token: string; user: AuthUser }>('/login', {
    method: 'POST',
    body: { email, password },
  });
  setToken(res.token);
  localStorage.setItem('user', JSON.stringify(res.user));
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
  disableDemo(); // تسجيل حقيقي — نخرج من وضع المعاينة إن كان مفعّلاً
  const res = await api<{ token: string; user: AuthUser }>('/register', {
    method: 'POST',
    body: payload,
  });
  setToken(res.token);
  localStorage.setItem('user', JSON.stringify(res.user));
  return res.user;
}

export async function logout(): Promise<void> {
  try {
    await api('/logout', { method: 'POST' });
  } catch {
    // تجاهل أخطاء الشبكة عند الخروج
  }
  clearToken();
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
