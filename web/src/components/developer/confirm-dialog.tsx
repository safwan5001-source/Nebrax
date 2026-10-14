'use client';

import { useTranslations } from 'next-intl';
import { ConfirmDialog as NeutralConfirmDialog } from '@/components/shared/confirm-dialog';

/**
 * حوار تأكيد موحّد للإجراءات الحسّاسة في شاشات المطوّر (إبطال مفتاح، تعطيل عميل، حذف Webhook، تدوير سرّ).
 * غلافٌ رقيق على المكوّن المحايد `components/shared/confirm-dialog` يربطه بترجمات `developer.common`
 * (INT-UX-5a): الاسم والمسار والخاصيات والمظهر كما كانت، فلا يتغيّر أي مستدعٍ.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  detail,
  confirmLabel,
  danger = true,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  detail?: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
}) {
  const tc = useTranslations('developer.common');
  return (
    <NeutralConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title={title}
      message={message}
      detail={detail}
      confirmLabel={confirmLabel}
      cancelLabel={tc('cancel')}
      busyLabel={tc('saving')}
      danger={danger}
      busy={busy}
    />
  );
}
