'use client';

import { useState } from 'react';
import { FormAlert } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { FlowersDialog } from './flowers-dialog';

/**
 * تأكيد فعلٍ متلف بصياغة واحدة: يشرح الأثر، يمنع الإرسال المزدوج، يعرض فشل الخادم داخل الحوار ولا يُغلق
 * إلا بنجاحٍ مؤكَّد. زرّ الإلغاء هو الأول بصرياً/بالتركيز الافتراضي منعاً للنقر العرضي على الحذف.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  busyLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  busyLabel: string;
  onClose: () => void;
  /** يعيد رسالة الفشل أو `null` عند النجاح (فيُغلق المستدعي الحوار). */
  onConfirm: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const failure = await onConfirm();
    setBusy(false);
    if (failure) setError(failure);
  }

  return (
    <FlowersDialog open onClose={busy ? () => undefined : onClose} title={title}>
      <div className="space-y-4">
        <div className="text-sm leading-6 text-text">{message}</div>
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" autoFocus onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button type="button" variant="danger" onClick={() => void confirm()} disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </FlowersDialog>
  );
}
