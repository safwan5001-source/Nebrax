'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { clearToken } from '@/lib/api';
import { clearSessionPreferences, notifyAuthSessionChanged } from '@/lib/auth';
import { enableDemo, isDemoPreviewEnabled } from '@/lib/demo';

/**
 * «دخول تجريبي» — يدخل وضع المعاينة المحلي (بيانات وهمية، بلا خادم ولا توكن) ويفتح لوحة التحكم.
 * يُرسم فقط في بناءٍ فُعِّل فيه `NEXT_PUBLIC_DEMO_PREVIEW=true` (انظر `isDemoPreviewEnabled`).
 * لا يمرّ عبر `login()` ولا `logout()` ولا يستدعي أي endpoint.
 */
export function DemoLoginButton() {
  const t = useTranslations('login');
  const router = useRouter();

  if (!isDemoPreviewEnabled()) return null;

  function start() {
    // جلسة حقيقية سابقة (توكن + مستخدم + فرع نشط) لا تبقى خلف المعاينة: تُمسح محلياً بدوال تنظيف الجلسة نفسها
    // التي يستعملها الخروج، **بلا** `logout()` فلا استدعاء لـ`/logout` ولا اتصال بالخادم (التوكن يبقى صالحاً هناك).
    // وإلا عاد التوكن حيّاً حين يُمسح علم المعاينة بلا خروج كامل.
    clearToken();
    clearSessionPreferences();
    enableDemo();
    notifyAuthSessionChanged();
    router.replace('/dashboard');
  }

  return (
    <div className="mt-6 border-t border-border pt-5">
      <Button type="button" variant="outline" className="h-12 w-full text-base" onClick={start}>
        {t('demo')}
      </Button>
      <p className="mt-2 text-center text-xs text-muted">{t('demo_hint')}</p>
    </div>
  );
}
