import { isDemo } from './demo';
import { mockApi } from './mock-data';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

export function setToken(token: string): void {
  localStorage.setItem('token', token);
}

export function clearToken(): void {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('demo');
}

type Options = Omit<RequestInit, 'body'> & { body?: unknown };

export async function api<T = unknown>(path: string, options: Options = {}): Promise<T> {
  // وضع المعاينة: لا اتصال بأي خادم — البيانات من الموجّه الوهمي.
  if (isDemo()) {
    return mockApi<T>(path, options.method ?? 'GET', options.body);
  }

  const token = getToken();
  // الفرع النشط — يوسم به الخادمُ المستنداتِ وسطورَ قيدها (بلا ترويسة: الفرع الرئيسي).
  const branchId = typeof window !== 'undefined' ? localStorage.getItem('nibras_active_branch') : null;
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(branchId ? { 'X-Branch-Id': branchId } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    body: options.body !== undefined ? (isFormData ? options.body as FormData : JSON.stringify(options.body)) : undefined,
  });

  if (res.status === 401 && typeof window !== 'undefined') {
    clearToken();
    // جلسة منتهية: نعيد المستخدم لشاشة الدخول بدل واجهة «مصادَقة» كل نداء فيها يفشل
    if (!window.location.pathname.startsWith('/login')) {
      window.location.assign('/login');
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { message?: string }).message ?? 'حدث خطأ', body);
  }

  if (res.status === 204) return null as T;
  return res.json() as Promise<T>;
}
