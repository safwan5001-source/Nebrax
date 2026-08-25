import { isDemo } from './demo';
import { mockApi } from './mock-data';
import { readDemoMediaFile } from './demo-product-store';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api';

export function resolveApiUrl(path: string, baseUrl = BASE_URL): string {
  if (/^https?:\/\//i.test(path)) return path;

  // تتجنب trim() تحوّل قيمة بيئة منسوخة مع سطر جديد إلى مسار `/api/api/...` في الإنتاج.
  const base = baseUrl.trim().replace(/\/+$/, '');
  let relativePath = path.trim().replace(/^\/+/, '');

  // Laravel media links are returned as `/api/...`, while NEXT_PUBLIC_API_URL
  // already ends with `/api`. Avoid producing `/api/api/...`.
  if (/\/api$/i.test(base) && /^api(?:\/|$)/i.test(relativePath)) {
    relativePath = relativePath.replace(/^api\/?/i, '');
  }

  return relativePath ? `${base}/${relativePath}` : base;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** يتعرف على أخطاء HTTP الفعلية وعلى محاكي المعاينة من دون كشف جسم الاستجابة. */
export function hasApiStatus(exception: unknown, status: number): boolean {
  return exception instanceof ApiError
    ? exception.status === status
    : typeof exception === 'object'
      && exception !== null
      && 'status' in exception
      && (exception as { status?: unknown }).status === status;
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

  const res = await fetch(resolveApiUrl(path), {
    ...options,
    headers,
    body: options.body !== undefined
      ? (isFormData || typeof options.body === 'string' ? options.body as BodyInit : JSON.stringify(options.body))
      : undefined,
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

/**
 * يجلب ملفاً خاصاً (صورة مثلاً) ويعيد رابط كائن محلي (`blob:`) لعرضه في
 * `<img src>` — لا `<img>` وحده يرسل ترويسة المصادقة. المستدعي مسؤول عن
 * `URL.revokeObjectURL` عند الاستغناء عن الرابط (تبديل الصورة أو الفكّ).
 */
export async function fetchImageUrl(path: string): Promise<string | null> {
  if (isDemo()) {
    const file = await readDemoMediaFile(path);
    return file ? URL.createObjectURL(file) : null;
  }

  const token = getToken();
  const branchId = typeof window !== 'undefined' ? localStorage.getItem('nibras_active_branch') : null;
  const res = await fetch(resolveApiUrl(path), {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(branchId ? { 'X-Branch-Id': branchId } : {}),
    },
  });

  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}

/** تنزيل ملف خاص من الـ API مع ترويسات المصادقة والفرع النشط. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  if (isDemo()) return;

  const token = getToken();
  const branchId = typeof window !== 'undefined' ? localStorage.getItem('nibras_active_branch') : null;
  const res = await fetch(resolveApiUrl(path), {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(branchId ? { 'X-Branch-Id': branchId } : {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { message?: string }).message ?? 'حدث خطأ', body);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fallbackName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
