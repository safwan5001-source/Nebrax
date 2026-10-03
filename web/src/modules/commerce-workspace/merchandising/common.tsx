'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import type { WriteResult } from './client';

export type MessageKey = Parameters<typeof commerceWorkspaceMessage>[1];
export type T = (key: MessageKey) => string;

/** رسالة فشل الكتابة: نص الخادم لتعارض/تحقق (409/422)، وإلا العبارة العامة. */
export function writeFailureMessage(result: Extract<WriteResult<unknown>, { ok: false }>, t: T): string {
  return (result.status === 409 || result.status === 422) && result.message ? result.message : t('merchSaveFailed');
}

export type Field = {
  id: string;
  label: string;
  value: string;
  required?: boolean;
  /** يمنع التعديل (مثلاً معرّف بعد الإنشاء). */
  hint?: string;
  dir?: 'ltr' | 'rtl';
  options?: { value: string; label: string }[];
};

/**
 * حوار حقول نصية/اختيار عام للتسويق: يمنع الإرسال المزدوج، يعرض الخطأ داخل الحوار،
 * ولا يُغلق إلا بعد نجاح مؤكَّد من الخادم.
 */
export function FieldsDialog({
  title,
  fields,
  submitLabel,
  t,
  onClose,
  onSubmit,
}: {
  title: string;
  fields: Field[];
  submitLabel: string;
  t: T;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => Promise<string | null>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.id, f.value])));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const missing = fields.find((f) => f.required && (values[f.id] ?? '').trim() === '');
    if (missing) {
      setError(missing.id === 'key' ? t('merchFacetKeyRequired') : t('merchNameRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const failure = await onSubmit(values);
      if (failure) setError(failure);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={saving ? () => undefined : onClose} title={title}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        {fields.map((field) => (
          <div key={field.id} className="space-y-1.5">
            <Label htmlFor={`merch-field-${field.id}`}>{field.label}</Label>
            {field.options ? (
              <Select
                id={`merch-field-${field.id}`}
                value={values[field.id]}
                onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
              >
                {field.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id={`merch-field-${field.id}`}
                value={values[field.id]}
                dir={field.dir}
                aria-required={field.required}
                aria-invalid={error !== null && field.required && (values[field.id] ?? '').trim() === ''}
                onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
              />
            )}
            {field.hint ? <p className="text-xs text-muted">{field.hint}</p> : null}
          </div>
        ))}
        {error ? (
          <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t('merchCancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  t,
  onClose,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  t: T;
  onClose: () => void;
  onConfirm: () => Promise<string | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const failure = await onConfirm();
      if (failure) setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={busy ? () => undefined : onClose} title={title}>
      <div className="space-y-3">
        <p className="text-sm text-text">{message}</p>
        {error ? (
          <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t('merchCancel')}
          </Button>
          <Button type="button" variant="danger" onClick={() => void confirm()} disabled={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
