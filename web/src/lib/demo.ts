// وضع المعاينة (Demo) — يعمل بالكامل ببيانات وهمية محلية دون أي اتصال بالخادم.
// التفعيل من زر «دخول تجريبي» في شاشة الدخول؛ يُخزَّن العلم في localStorage.

import type { AuthUser } from './auth';

const DEMO_KEY = 'demo';

export function isDemo(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(DEMO_KEY) === 'true';
}

export function enableDemo(): void {
  localStorage.setItem(DEMO_KEY, 'true');
  localStorage.setItem('user', JSON.stringify(DEMO_USER));
}

export function disableDemo(): void {
  localStorage.removeItem(DEMO_KEY);
}

export const DEMO_USER: AuthUser = {
  id: 'demo-user',
  name: 'مستخدم المعاينة',
  email: 'demo@nibras.test',
  role: 'owner',
  tenant_id: 'demo-tenant',
};
