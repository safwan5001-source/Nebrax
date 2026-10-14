'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SecretRevealDialog } from '@/components/shared/secret-reveal-dialog';
import { TypedConfirmationField } from '@/components/shared/typed-confirmation-field';
import { IngressCreateDialog } from './ingress-create-dialog';
import type { IngressManagement } from './use-ingress-management';

/**
 * طبقة حوارات إدارة نقطة الاستقبال (INT-UX-5b): تأكيد التدوير، وتأكيد التعطيل بكتابة معرّف المتجر، وكشف السرّ الجديد
 * لمرة واحدة بقفل الإغلاق، وإشعار النتيجة. تُعرض في اللوحة خارج فروع القراءة/التحميل كي لا تختفي مع إعادة جلب القائمة.
 *
 * النصوص كلها من قاموس `integrationCenter.ingressManagement`؛ لا نصّ خادم يُعرض أبداً. ولا يوجد هنا زرّ «إعادة محاولة»:
 * النتيجة المجهولة تُعاد قراءة القائمة بعدها ويقرّر المستخدم من الحالة الحقيقية.
 */
export function IngressManagementLayer({ management, platformName }: { management: IngressManagement; platformName: string }) {
  const t = useTranslations('integrationCenter.ingressManagement');
  const { dialog, busy, reveal, notice } = management;
  // حقل التأكيد مربوط بالحوار المفتوح: حوار جديد (أو نقطة أخرى) يبدأ فارغاً في الرسم نفسه، ولا يبقى منه شيء بعد الإغلاق.
  const dialogKey = dialog ? `${dialog.kind}:${dialog.point.id}` : '';
  const [typedState, setTypedState] = useState({ key: '', value: '' });
  const typed = typedState.key === dialogKey ? typedState.value : '';
  const setTyped = (value: string) => setTypedState({ key: dialogKey, value });
  useEffect(() => {
    if (dialogKey === '') setTypedState({ key: '', value: '' });
  }, [dialogKey]);

  const rotating = dialog?.kind === 'rotate' ? dialog.point : null;
  const disabling = dialog?.kind === 'disable' ? dialog.point : null;

  return (
    <>
      {notice ? (
        <div
          role={notice.kind === 'error' || notice.kind === 'createLost' || notice.kind === 'createUnconfirmed' ? 'alert' : 'status'}
          className={`flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-2 text-sm ${notice.kind === 'error' ? 'text-negative' : 'text-text'}`}
          data-testid="ingress-management-notice"
          data-kind={notice.kind}
        >
          <span>
            {notice.kind === 'error' ? t(`errors.${notice.messageKey}`) : t(`notices.${notice.kind}`, { storeId: notice.storeId })}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={management.dismissNotice}>{t('notices.dismiss')}</Button>
        </div>
      ) : null}

      {management.createOpen ? (
        <IngressCreateDialog
          platformName={platformName}
          busy={busy}
          error={management.createError}
          isBlocked={management.isCreateBlocked}
          onCancel={management.cancelCreate}
          onSubmit={management.confirmCreate}
        />
      ) : null}

      <ConfirmDialog
        open={rotating !== null}
        onClose={management.cancel}
        onConfirm={management.confirmRotate}
        title={t('rotate.title')}
        message={t('rotate.message')}
        detail={rotating?.storeId}
        confirmLabel={t('rotate.confirm')}
        cancelLabel={t('common.cancel')}
        busyLabel={t('rotate.busy')}
        danger
        busy={busy}
        hideClose={busy}
      />

      <ConfirmDialog
        open={disabling !== null}
        onClose={management.cancel}
        onConfirm={() => management.confirmDisable(typed)}
        title={t('disable.title')}
        message={t('disable.message')}
        confirmLabel={t('disable.confirm')}
        cancelLabel={t('common.cancel')}
        busyLabel={t('disable.busy')}
        danger
        busy={busy}
        hideClose={busy}
        confirmDisabled={disabling === null || typed !== disabling.storeId}
      >
        {disabling ? (
          <TypedConfirmationField
            value={typed}
            onChange={setTyped}
            label={t('disable.typedLabel')}
            expected={disabling.storeId}
            disabled={busy}
          />
        ) : null}
      </ConfirmDialog>

      {reveal ? (
        <SecretRevealDialog
          open
          onClose={management.closeReveal}
          title={t('secret.title')}
          secret={reveal.value}
          description={t(reveal.kind === 'created' ? 'secret.descriptionCreated' : 'secret.description', { storeId: reveal.storeId })}
          requireConfirmToClose
          labels={{
            warning: t('secret.warning'),
            copied: t('secret.copied'),
            confirm: t('secret.confirm'),
            confirmHint: t('secret.confirmHint'),
            reveal: t('secret.reveal'),
            hide: t('secret.hide'),
            copy: t('secret.copy'),
          }}
        />
      ) : null}
    </>
  );
}
