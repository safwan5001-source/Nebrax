'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DialogError } from '@/components/fuel-stations/dialog-error';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { classifyError, fieldErrors, serverMessage } from './access';
import { createTanker, updateTanker } from './client';
import { DialogFooter, Field } from './fields';
import { buildTankerPayload, EMPTY_TANKER_FORM, hasChanges, LIMITS, tankerFormFrom, validateTanker, type TankerForm } from './form-logic';
import { TANKER_STATUSES, type Tanker } from './types';

/** خريطة أسماء حقول الخادم إلى حقول النموذج. */
const SERVER_FIELD: Record<string, string> = { plate_number: 'plate', plate_country: 'country', capacity_milliliters: 'capacity' };

/**
 * إضافة/تعديل صهريج تابع لصاحب صهريج. السعة تُدخل **باللتر** وتُرسَل mL صحيحاً. المالك ثابت: يُرسَل عند الإنشاء فقط ولا يُعرض قابلاً للتغيير.
 * ليس مخزوناً ولا خزاناً افتراضياً — بيان رئيسي لتعريف الصهريج (لوحة وسعة اختيارية).
 */
export function TankerDialog({ open, ownerId, tanker, onClose, onSaved }: {
  open: boolean; ownerId: string; tanker?: Tanker; onClose: () => void; onSaved: (tanker: Tanker) => void;
}) {
  const t = useTranslations('fuelTankers');
  const [form, setForm] = useState<TankerForm>(EMPTY_TANKER_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = tanker !== undefined;
  const showNotes = !editing || tanker.notes !== undefined;

  useEffect(() => {
    if (!open) return;
    setForm(tanker ? tankerFormFrom(tanker) : EMPTY_TANKER_FORM);
    setErrors({});
    setFormError(null);
    setBusy(false);
  }, [open, tanker]);

  const set = <K extends keyof TankerForm>(key: K, value: TankerForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const codes = validateTanker(form);
    if (Object.keys(codes).length > 0) {
      const max: Record<string, number> = { plate: LIMITS.plate, country: LIMITS.country, notes: LIMITS.notes, reason: LIMITS.reason };
      setErrors(Object.fromEntries(Object.entries(codes).map(([field, code]) => [field, t(`errors.${code}`, { max: max[field] ?? 0 })])));
      return;
    }
    const payload = buildTankerPayload(form, ownerId, tanker);
    if (editing && !hasChanges(payload)) { onClose(); return; }
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const saved = tanker ? await updateTanker(tanker.id, payload) : await createTanker(payload);
      onSaved(saved);
    } catch (error) {
      const problem = classifyError(error, 'write');
      if (problem === 'validation') {
        const server = Object.fromEntries(Object.entries(fieldErrors(error)).map(([field, message]) => [SERVER_FIELD[field] ?? field, message]));
        setErrors(server);
        if (Object.keys(server).length === 0) setFormError(serverMessage(error) ?? t('errors.saveFailed'));
      } else if (problem === 'forbidden') setFormError(t('errors.forbidden'));
      else if (problem === 'not_found') setFormError(t('errors.notFoundOrClosed'));
      else setFormError(serverMessage(error) ?? t('errors.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={editing ? t('tanker.editTitle') : t('tanker.createTitle')}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field id="tanker-plate" label={t('tanker.plate')} required hint={t('tanker.plateHint')} error={errors.plate}>
          <Input dir="auto" value={form.plate} autoComplete="off" onChange={(e) => set('plate', e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="tanker-capacity" label={t('tanker.capacity')} hint={t('tanker.capacityHint')} error={errors.capacity}>
            <Input dir="ltr" inputMode="decimal" className="num text-start" value={form.capacityLiters} autoComplete="off" onChange={(e) => set('capacityLiters', e.target.value)} />
          </Field>
          <Field id="tanker-country" label={t('tanker.country')} hint={t('tanker.countryHint')} error={errors.country}>
            <Input dir="ltr" className="text-start uppercase" value={form.country} autoComplete="off" onChange={(e) => set('country', e.target.value)} />
          </Field>
        </div>
        <Field id="tanker-status" label={t('tanker.status')} error={errors.status}>
          <Select value={form.status} onChange={(e) => set('status', e.target.value as TankerForm['status'])}>
            {TANKER_STATUSES.map((status) => <option key={status} value={status}>{t(`status.${status}`)}</option>)}
          </Select>
        </Field>
        {showNotes ? (
          <Field id="tanker-notes" label={t('tanker.notes')} error={errors.notes}>
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        ) : null}
        {editing ? (
          <Field id="tanker-reason" label={t('common.reason')} hint={t('common.reasonHint')} error={errors.reason}>
            <Input value={form.reason} onChange={(e) => set('reason', e.target.value)} />
          </Field>
        ) : null}
        <DialogError message={formError} />
        <DialogFooter busy={busy} cancelLabel={t('common.cancel')} submitLabel={editing ? t('common.saveChanges') : t('tanker.create')} onCancel={onClose} />
      </form>
    </Dialog>
  );
}
