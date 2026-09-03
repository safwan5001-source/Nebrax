'use client';

import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * حوار تأكيد موحّد للإجراءات الحسّاسة (إبطال مفتاح، تعطيل عميل، حذف Webhook، تدوير سرّ).
 * يذكر الأثر بدقّة (§42/§9)، والزرّ الهدّام يحمل نبرة `danger` للإجراء الهدّام وحده.
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
    <Dialog open={open} onClose={onClose} title={title} className="max-w-md">
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-text">{message}</p>
        {detail ? <p dir="ltr" className="rounded border border-border bg-background px-3 py-2 font-mono text-xs text-muted [unicode-bidi:plaintext]">{detail}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{tc('cancel')}</Button>
          <Button type="button" variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {busy ? tc('saving') : confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
