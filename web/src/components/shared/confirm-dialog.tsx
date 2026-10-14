'use client';

import type { ReactNode } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * حوار تأكيد محايد للإجراءات الحسّاسة (INT-UX-5a): لا يعرف أي مساحة ترجمة. كل نصّ يصله خاصيةً،
 * فيستعمله مركز التكاملات وشاشات المطوّر بترجماتٍ مختلفة دون أن يتبع أحدهما الآخر.
 *
 * السلوك مطابق حرفياً لما كان في `components/developer/confirm-dialog.tsx` (الذي صار غلافاً رقيقاً
 * يمرّر ترجمات `developer.common`): يذكر الأثر بدقّة، والزرّ الهدّام وحده يحمل نبرة `danger`،
 * ويُعطَّل الزرّان أثناء التنفيذ.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  detail,
  confirmLabel,
  cancelLabel,
  busyLabel,
  danger = true,
  busy = false,
  children,
  confirmDisabled = false,
  hideClose = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  detail?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** نصّ الزرّ أثناء التنفيذ (مثل «جارٍ الحفظ…»). */
  busyLabel: string;
  danger?: boolean;
  busy?: boolean;
  /** محتوى إضافي بين الرسالة والأزرار (مثل حقل كتابة تأكيد). غيابه = الحوار القديم حرفياً. */
  children?: ReactNode;
  /** يعطّل زرّ التأكيد وحده (شرط لم يتحقق بعد). الافتراضي `false`. */
  confirmDisabled?: boolean;
  /** يُخفي زرّ الإغلاق العلوي (مثلاً أثناء التنفيذ). الافتراضي `false`. */
  hideClose?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} className="max-w-md" hideClose={hideClose}>
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-text">{message}</p>
        {detail ? <p dir="ltr" className="rounded border border-border bg-background px-3 py-2 font-mono text-xs text-muted [unicode-bidi:plaintext]">{detail}</p> : null}
        {children}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
          <Button type="button" variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy || confirmDisabled}>
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
