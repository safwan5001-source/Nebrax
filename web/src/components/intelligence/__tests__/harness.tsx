import { vi } from 'vitest';

/** عدّة مشتركة لاختبارات واجهة الذكاء: مستخدم/صلاحيات قابلة للتبديل ومسار وهمي. */
export const session = {
  user: { id: 'u1', tenant_id: 't1', role: 'owner', permissions: ['*'] } as { id: string; tenant_id: string; role: string; permissions: string[] } | null,
  pathname: '/dashboard',
  push: vi.fn(),
};

export const api = {
  fetchStatus: vi.fn(),
  sendMessage: vi.fn(),
  runTool: vi.fn(),
  readDocument: vi.fn(),
  saveSettings: vi.fn(),
  fetchAuditEvents: vi.fn(),
};

export function canWith(permissions: string[]) {
  return (permission: string) => permissions.includes('*') || permissions.includes(permission);
}

/**
 * مؤشر غير لمسي ثابت: دالة عادية لا `vi.fn` — فلا يمسحها `mockReset` ولا تتسرّب حالتها من ملفات أخرى في العملية
 * المشتركة (singleFork)، ويعتمد عليها `Dialog` و`AssistantPanel` عند قراءة `pointer: coarse`.
 */
export function stubFinePointer() {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

export function resetSession(permissions: string[] = ['*']) {
  stubFinePointer();
  session.user = { id: 'u1', tenant_id: 't1', role: 'owner', permissions };
  session.pathname = '/dashboard';
  session.push.mockReset();
  Object.values(api).forEach((fn) => fn.mockReset());
}
