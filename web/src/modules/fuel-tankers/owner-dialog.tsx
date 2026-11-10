'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DialogError } from '@/components/fuel-stations/dialog-error';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { classifyError, fieldErrors, serverMessage } from './access';
import { createOwner, updateOwner } from './client';
import { DialogFooter, Field } from './fields';
import { buildOwnerPayload, EMPTY_OWNER_FORM, hasChanges, LIMITS, ownerFormFrom, validateOwner, type OwnerForm } from './form-logic';
import { TANKER_STATUSES, type TankerOwner } from './types';

/**
 * إضافة/تعديل ملف صاحب الصهريج. الهاتف والملاحظات يظهران فقط حين يملكهما المستخدم (في التعديل: الخادم أرسلهما، أي مدير؛ في الإضافة: النموذج
 * لا يُفتح إلا لمن يملك الإدارة). `tenant_id` و`partner_id` لا يدخلان الحمولة أبداً.
 */
export function OwnerDialog({ open, owner, onClose, onSaved }: {
  open: boolean; owner?: TankerOwner; onClose: () => void; onSaved: (owner: TankerOwner) => void;
}) {
  const t = useTranslations('fuelTankers');
  const [form, setForm] = useState<OwnerForm>(EMPTY_OWNER_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = owner !== undefined;
  const showSensitive = !editing || owner.phone !== undefined;

  useEffect(() => {
    if (!open) return;
    setForm(owner ? ownerFormFrom(owner) : EMPTY_OWNER_FORM);
    setErrors({});
    setFormError(null);
    setBusy(false);
  }, [open, owner]);

  const set = <K extends keyof OwnerForm>(key: K, value: OwnerForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const codes = validateOwner(form);
    if (Object.keys(codes).length > 0) {
      setErrors(Object.fromEntries(Object.entries(codes).map(([field, code]) => [field, t(`errors.${code}`, { max: LIMITS[field as keyof typeof LIMITS] ?? 0 })])));
      return;
    }
    const payload = buildOwnerPayload(form, owner);
    if (editing && !hasChanges(payload)) { onClose(); return; }
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const saved = owner ? await updateOwner(owner.id, payload) : await createOwner(payload);
      onSaved(saved);
    } catch (error) {
      const problem = classifyError(error, 'write');
      if (problem === 'validation') {
        const server = fieldErrors(error);
        setErrors(server);
        if (Object.keys(server).length === 0) setFormError(serverMessage(error) ?? t('errors.saveFailed'));
      } else if (problem === 'forbidden') setFormError(t('errors.forbidden'));
      else if (problem === 'not_found') setFormError(t('errors.notFoundOrClosed'));
      else setFormError(t('errors.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={editing ? t('owner.editTitle') : t('owner.createTitle')}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field id="tanker-owner-name" label={t('owner.name')} required error={errors.name}>
          <Input value={form.name} autoComplete="off" onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field id="tanker-owner-code" label={t('owner.code')} hint={t('owner.codeHint')} error={errors.code}>
          <Input dir="ltr" className="num text-start" value={form.code} autoComplete="off" onChange={(e) => set('code', e.target.value)} />
        </Field>
        {showSensitive ? (
          <>
            <Field id="tanker-owner-phone" label={t('owner.phone')} error={errors.phone}>
              <Input dir="ltr" inputMode="tel" className="num text-start" value={form.phone} autoComplete="off" onChange={(e) => set('phone', e.target.value)} />
            </Field>
            <Field id="tanker-owner-notes" label={t('owner.notes')} error={errors.notes}>
              <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </>
        ) : null}
        <Field id="tanker-owner-status" label={t('owner.status')} hint={t('owner.statusHint')} error={errors.status}>
          <Select value={form.status} onChange={(e) => set('status', e.target.value as OwnerForm['status'])}>
            {TANKER_STATUSES.map((status) => <option key={status} value={status}>{t(`status.${status}`)}</option>)}
          </Select>
        </Field>
        {editing ? (
          <Field id="tanker-owner-reason" label={t('common.reason')} hint={t('common.reasonHint')} error={errors.reason}>
            <Input value={form.reason} onChange={(e) => set('reason', e.target.value)} />
          </Field>
        ) : null}
        <DialogError message={formError} />
        <DialogFooter busy={busy} cancelLabel={t('common.cancel')} submitLabel={editing ? t('common.saveChanges') : t('owner.create')} onCancel={onClose} />
      </form>
    </Dialog>
  );
}
