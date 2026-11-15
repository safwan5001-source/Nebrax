'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

/** حقل نموذج موحّد: تسمية فوق الحقل، تلميح، ورسالة خطأ مرتبطة بـ`aria-describedby` (لا لون وحده). */
export function Field({ id, label, error, hint, required, children }: {
  id: string; label: string; error?: string | null; hint?: string; required?: boolean; children: React.ReactNode;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true" className="ms-1 text-negative">*</span> : null}
      </Label>
      {React.isValidElement(children) ? React.cloneElement(children as React.ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>, { id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined }) : children}
      {hint ? <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p> : null}
      {error ? <p id={`${id}-error`} role="alert" className="text-xs text-negative">{error}</p> : null}
    </div>
  );
}

/** أزرار تذييل الحوار: إلغاء + حفظ؛ الحفظ معطّل أثناء الإرسال (لا إرسال مكرر). */
export function DialogFooter({ busy, submitLabel, cancelLabel, onCancel, disabled = false }: {
  busy: boolean; submitLabel: string; cancelLabel: string; onCancel: () => void; disabled?: boolean;
}) {
  return (
    <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
      <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
      <Button type="submit" disabled={busy || disabled}>{submitLabel}</Button>
    </div>
  );
}
