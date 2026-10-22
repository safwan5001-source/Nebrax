'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { isDemoPreviewEnabled } from '@/lib/demo';
import { startDemoSession } from '@/lib/demo-session';

interface DemoLoginButtonProps {
  /** يعطّل الدخول التجريبي (مثلاً أثناء تسجيل دخول حقيقي معلّق) — لا يبدأ شيء ولا يُستدعى `onStart`. */
  disabled?: boolean;
  /** يُستدعى متزامناً قبل بدء جلسة المعاينة، لتقفل الصفحة نموذج الدخول الحقيقي. */
  onStart?: () => void;
}

/**
 * «دخول تجريبي» — يدخل وضع المعاينة المحلي (بيانات وهمية، بلا خادم ولا توكن) ويفتح لوحة التحكم.
 * يُرسم فقط في بناءٍ فُعِّل فيه `NEXT_PUBLIC_DEMO_PREVIEW=true` (انظر `isDemoPreviewEnabled`).
 * لا يمرّ عبر `login()` ولا `logout()` ولا يستدعي أي endpoint؛ وأي جلسة حقيقية سابقة تُمسح محلياً (`startDemoSession`).
 */
export function DemoLoginButton({ disabled = false, onStart }: DemoLoginButtonProps = {}) {
  const t = useTranslations('login');
  const router = useRouter();

  if (!isDemoPreviewEnabled()) return null;

  function start() {
    if (disabled) return;
    onStart?.();
    startDemoSession();
    router.replace('/dashboard');
  }

  return (
    <div className="mt-6 border-t border-border pt-5">
      <Button type="button" variant="outline" className="h-12 w-full text-base" disabled={disabled} onClick={start}>
        {t('demo')}
      </Button>
      <p className="mt-2 text-center text-xs text-muted">{t('demo_hint')}</p>
    </div>
  );
}
