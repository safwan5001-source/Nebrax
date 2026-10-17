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
  saveSettings: vi.fn(),
  fetchAuditEvents: vi.fn(),
};

export function canWith(permissions: string[]) {
  return (permission: string) => permissions.includes('*') || permissions.includes(permission);
}

export function resetSession(permissions: string[] = ['*']) {
  session.user = { id: 'u1', tenant_id: 't1', role: 'owner', permissions };
  session.pathname = '/dashboard';
  session.push.mockReset();
  Object.values(api).forEach((fn) => fn.mockReset());
}
