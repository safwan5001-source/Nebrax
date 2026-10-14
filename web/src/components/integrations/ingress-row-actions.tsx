'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { isDemo } from '@/lib/demo';
import type { IngressPoint } from '@/lib/signed-ingress';
import type { IngressManagement } from './use-ingress-management';
import { useIngressPermissions } from './use-ingress-permissions';

/**
 * أزرار صفّ نقطة الاستقبال (INT-UX-5b): «تدوير السر» و«تعطيل» فقط. كلٌّ منهما **غائب** (لا معطَّل) ما لم يمنحه
 * الخادم عبر قائمة الصلاحيات (`delivery_connector.manage`) والنقطة مهيّأة؛ نقطة معطّلة بلا أي زر. وضع المعاينة بلا أزرار.
 * القرار للعرض فقط — الخادم يبقى السلطة (403/404).
 */
export function IngressRowActions({ point, management }: { point: IngressPoint; management: IngressManagement }) {
  const t = useTranslations('integrationCenter.ingressManagement');
  const allowed = useIngressPermissions(point);
  if (isDemo() || (!allowed.rotate && !allowed.disable)) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="ingress-row-actions">
      {allowed.rotate ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 md:min-h-8"
          aria-label={t('actions.rotateFor', { storeId: point.storeId })}
          onClick={() => management.openRotate(point)}
          data-testid="ingress-rotate"
        >
          {t('actions.rotate')}
        </Button>
      ) : null}
      {allowed.disable ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 text-negative md:min-h-8"
          aria-label={t('actions.disableFor', { storeId: point.storeId })}
          onClick={() => management.openDisable(point)}
          data-testid="ingress-disable"
        >
          {t('actions.disable')}
        </Button>
      ) : null}
    </div>
  );
}

/** هل يظهر للمستخدم أي إجراء إدارة على أي نقطة (يحدّد عمود «الإجراءات» وملاحظة الإدارة). */
export function useCanManageIngress(): boolean {
  const allowed = useIngressPermissions({ status: 'configured' });
  return !isDemo() && allowed.rotate;
}
