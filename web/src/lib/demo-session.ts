import { clearToken } from './api';
import { clearSessionPreferences, notifyAuthSessionChanged } from './auth';
import { enableDemo } from './demo';

/**
 * يبدأ جلسة المعاينة فوق أي جلسة حقيقية: يمسح التوكن والمستخدم والفرع النشط محلياً بدوال تنظيف الجلسة نفسها التي
 * يستعملها الخروج، ثم يفعّل المعاينة. **بلا** `logout()` فلا استدعاء لـ`/logout` ولا اتصال بالخادم (التوكن يبقى صالحاً
 * هناك). المسح قبل التفعيل كي لا يعود التوكن حيّاً حين يُمسح علم المعاينة بلا خروج كامل.
 *
 * مسار واحد يستعمله زر «دخول تجريبي» ومعالج اكتمال تسجيل دخول حقيقي متأخر في صفحة الدخول (انظر `login/page.tsx`).
 */
export function startDemoSession(): void {
  clearToken();
  clearSessionPreferences();
  enableDemo();
  notifyAuthSessionChanged();
}
