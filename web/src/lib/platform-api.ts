'use client';

import { ApiError, type DownloadOutcome } from './api';
import { isDemo } from './demo';
import { handleDocumentOperationsDemo } from './document-operations-demo';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api';
const PLATFORM_TOKEN_KEY = 'platform_token';
const PLATFORM_ADMINISTRATOR_KEY = 'platform_administrator';

type Options = Omit<RequestInit, 'body'> & { body?: unknown };

export function getPlatformToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(PLATFORM_TOKEN_KEY);
}

export function setPlatformToken(token: string): void {
  localStorage.setItem(PLATFORM_TOKEN_KEY, token);
}

export function clearPlatformSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(PLATFORM_TOKEN_KEY);
  localStorage.removeItem(PLATFORM_ADMINISTRATOR_KEY);
}

export function setPlatformAdministrator(payload: unknown): void {
  localStorage.setItem(PLATFORM_ADMINISTRATOR_KEY, JSON.stringify(payload));
}

export function getPlatformAdministrator<T>(): T | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(PLATFORM_ADMINISTRATOR_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    clearPlatformSession();
    return null;
  }
}

/**
 * عميل مساحة تشغيل المنصة فقط.
 *
 * لا يستخدم جلسة ERP العادية ولا يرسل `X-Branch-Id`، كي لا تختلط لوحة المنصة
 * بسياق مستأجر أو فرع نشط في المتصفح نفسه.
 */
export async function platformApi<T = unknown>(path: string, options: Options = {}): Promise<T> {
  if (isDemo()) {
    const demo = handleDocumentOperationsDemo(path, options.method ?? 'GET', options.body);
    if (demo.handled) {
      if (demo.error) throw demo.error;
      return demo.response as T;
    }
  }
  const token = getPlatformToken();
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    body: options.body !== undefined
      ? (isFormData || typeof options.body === 'string' ? options.body as BodyInit : JSON.stringify(options.body))
      : undefined,
  });

  if (response.status === 401 && typeof window !== 'undefined') {
    clearPlatformSession();
    if (!window.location.pathname.startsWith('/platform/login')) {
      window.location.assign('/platform/login');
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, (body as { message?: string }).message ?? 'حدث خطأ', body);
  }

  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
}

/** تنزيل خاص ضمن جلسة منصة الإدارة، منفصل صراحةً عن توكن tenant. */
export async function platformDownloadFile(path: string, fallbackName: string): Promise<DownloadOutcome> {
  if (isDemo()) return 'demo-unavailable';

  const token = getPlatformToken();
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, (body as { message?: string }).message ?? 'حدث خطأ', body);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fallbackName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  return 'downloaded';
}
