'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { setActiveBranchId } from '@/lib/branch';
import { enableDemo, isDemoPreviewEnabled } from '@/lib/demo';

/**
 * «دخول تجريبي» — يدخل وضع المعاينة المحلي (بيانات وهمية، بلا خادم ولا توكن) ويفتح لوحة التحكم.
 * يُرسم فقط في بناءٍ فُعِّل فيه `NEXT_PUBLIC_DEMO_PREVIEW=true` (انظر `isDemoPreviewEnabled`).
 * لا يمرّ عبر `login()` ولا يستدعي أي endpoint.
 */
export function DemoLoginButton() {
  const t = useTranslations('login');
  const router = useRouter();

  if (!isDemoPreviewEnabled()) return null;

  function start() {
    // فرعٌ نشط متبقٍّ من حساب حقيقي لا يخصّ بيانات المعاينة (انظر clearSessionPreferences في auth.ts).
    setActiveBranchId(null);
    enableDemo();
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
