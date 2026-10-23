// وضع المعاينة (Demo) — يعمل بالكامل ببيانات وهمية محلية دون أي اتصال بالخادم.
// التفعيل من زر «دخول تجريبي» في شاشة الدخول؛ يُخزَّن العلم في localStorage.

import type { AuthUser } from './auth';

const DEMO_KEY = 'demo';

/**
 * هل يُعرض زر «دخول تجريبي»؟ مفتاح بناء: `NEXT_PUBLIC_DEMO_PREVIEW=true` يُدمج وقت البناء، فيلزم
 * إعادة نشر بعد أي تغيير. التفعيل لمعاينات Vercel وحدها ولا يوضع في Railway. عند غياب المتغيّر
 * لا يستبدله Next وقت البناء (يبقى قراءةً من `process.env` في المتصفح وتعيد `undefined`)، فالنتيجة
 * `false` والزر لا يُرسم أبداً — لكن كوده يُشحن خاملاً، فالضمان سلوكي لا حذف كود.
 * المقارنة صارمة بـ`'true'` فلا يفعّلها `1` ولا `TRUE`. لا يمسّ هذا `isDemo()`.
 */
export function isDemoPreviewEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_PREVIEW === 'true';
}

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
  // مستخدم المعاينة مالك، فصلاحياته كاملة كما يعيدها الخادم لدور المالك. من دون
  // هذه القائمة تسقط كل شاشة تقرأ `permissions` إلى «لا صلاحية» في وضع المعاينة.
  permissions: ['*'],
  tenant_id: 'demo-tenant',
};
