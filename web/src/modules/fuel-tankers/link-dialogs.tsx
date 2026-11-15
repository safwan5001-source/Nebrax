'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DialogError } from '@/components/fuel-stations/dialog-error';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { classifyError, fieldErrors, serverMessage } from './access';
import { CUSTOMER_LOOKUP_LIMIT, createLink, endLink, listCustomers } from './client';
import { DialogFooter, Field } from './fields';
import { buildEndPayload, buildLinkPayload, EMPTY_LINK_FORM, LIMITS, linkPhase, validateEnd, validateLink, type LinkForm } from './form-logic';
import type { CustomerOption, OwnerCompanyLink, TankerOwner } from './types';

const SERVER_FIELD: Record<string, string> = { partner_id: 'partner', valid_from: 'validFrom', valid_to: 'validTo' };

/**
 * ربط شركة (عميل رسمي في أَوْج) بصاحب صهريج من تاريخ وحتى تاريخ اختياري. **لا يُنشئ طرفاً ولا يغيّر العميل ولا يعيد نسب أي عملية سابقة.**
 * الشركات المرتبطة حالياً (نشطة أو مُجدولة) تُعرض معطّلة بسببها بدل إخفائها؛ والتحقق النهائي (النوع، النشاط، التداخل) في الخادم.
 */
export function LinkDialog({ open, owner, links, onClose, onSaved }: {
  open: boolean; owner: TankerOwner; links: OwnerCompanyLink[]; onClose: () => void; onSaved: (link: OwnerCompanyLink) => void;
}) {
  const t = useTranslations('fuelTankers');
  const [form, setForm] = useState<LinkForm>(EMPTY_LINK_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [customers, setCustomers] = useState<{ options: CustomerOption[]; truncated: boolean } | null>(null);
  const [lookup, setLookup] = useState<'idle' | 'loading' | 'error'>('idle');

  const loadCustomers = useCallback(async () => {
    setLookup('loading');
    try {
      setCustomers(await listCustomers());
      setLookup('idle');
    } catch {
      setLookup('error');
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_LINK_FORM);
    setErrors({});
    setFormError(null);
    setBusy(false);
    void loadCustomers();
  }, [open, loadCustomers]);

  const linked = useMemo(() => new Set(links.filter((link) => linkPhase(link) !== 'ended').map((link) => link.partner_id)), [links]);
  const options = useMemo<ComboOption[]>(
    () => (customers?.options ?? []).map((customer) => ({
      value: customer.id,
      label: customer.name,
      sub: customer.code ?? undefined,
      disabled: linked.has(customer.id),
      hint: linked.has(customer.id) ? t('link.alreadyLinked') : undefined,
    })),
    [customers, linked, t],
  );
  const set = <K extends keyof LinkForm>(key: K, value: LinkForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const codes = validateLink(form);
    if (Object.keys(codes).length > 0) {
      setErrors(Object.fromEntries(Object.entries(codes).map(([field, code]) => [field, t(`errors.${code}`, { max: LIMITS.linkNote })])));
      return;
    }
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      onSaved(await createLink(owner.id, buildLinkPayload(form)));
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
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={t('link.createTitle', { name: owner.name })}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <p className="rounded-md bg-primary-soft px-3 py-2 text-xs text-text">{t('link.rule')}</p>
        <Field id="tanker-link-partner" label={t('link.company')} required error={errors.partner}
          hint={customers?.truncated ? t('link.lookupTruncated', { count: CUSTOMER_LOOKUP_LIMIT }) : undefined}>
          <Combobox
            id="tanker-link-partner"
            value={form.partnerId}
            onChange={(value) => set('partnerId', value)}
            options={options}
            disabled={lookup === 'loading'}
            placeholder={lookup === 'loading' ? t('link.lookupLoading') : t('link.selectCompany')}
            searchPlaceholder={t('link.searchCompany')}
            emptyText={t('link.noCompanies')}
          />
        </Field>
        {lookup === 'error' ? (
          <div className="flex items-center justify-between gap-2 rounded-md bg-negative/10 px-3 py-2 text-sm text-negative" role="alert">
            <span>{t('link.lookupFailed')}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadCustomers()}>{t('common.retry')}</Button>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="tanker-link-from" label={t('link.validFrom')} hint={t('link.validFromHint')} error={errors.validFrom}>
            <Input type="date" dir="ltr" className="num text-start" value={form.validFrom} onChange={(e) => set('validFrom', e.target.value)} />
          </Field>
          <Field id="tanker-link-to" label={t('link.validTo')} hint={t('link.validToHint')} error={errors.validTo}>
            <Input type="date" dir="ltr" className="num text-start" value={form.validTo} min={form.validFrom || undefined} onChange={(e) => set('validTo', e.target.value)} />
          </Field>
        </div>
        <Field id="tanker-link-note" label={t('link.note')} error={errors.note}>
          <Textarea value={form.note} onChange={(e) => set('note', e.target.value)} />
        </Field>
        <DialogError message={formError} />
        <DialogFooter busy={busy} disabled={lookup === 'loading'} cancelLabel={t('common.cancel')} submitLabel={t('link.create')} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** إنهاء ربط مفتوح بتاريخ (الفراغ = اليوم بحكم الخادم) وسبب اختياري. **لا رجعة**: المنتهي لا يُعاد فتحه ولا يُحذف ولا يُعدَّل تاريخ نهايته. */
export function EndLinkDialog({ open, ownerId, link, onClose, onSaved }: {
  open: boolean; ownerId: string; link: OwnerCompanyLink | null; onClose: () => void; onSaved: (link: OwnerCompanyLink) => void;
}) {
  const t = useTranslations('fuelTankers');
  const [validTo, setValidTo] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValidTo('');
    setReason('');
    setErrors({});
    setFormError(null);
    setBusy(false);
  }, [open, link]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || link === null) return;
    const codes = validateEnd(validTo, link, reason);
    if (Object.keys(codes).length > 0) {
      setErrors(Object.fromEntries(Object.entries(codes).map(([field, code]) => [field, t(`errors.${code}`, { max: LIMITS.reason })])));
      return;
    }
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      onSaved(await endLink(ownerId, link.id, buildEndPayload(validTo, reason)));
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
    <Dialog open={open && link !== null} onClose={() => { if (!busy) onClose(); }} title={t('link.endTitle', { name: link?.partner?.name ?? '—' })}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-text">{t('link.endWarning')}</p>
        <Field id="tanker-link-end-date" label={t('link.endDate')} hint={t('link.endDateHint')} error={errors.validTo}>
          <Input type="date" dir="ltr" className="num text-start" value={validTo} min={link?.valid_from} onChange={(e) => setValidTo(e.target.value)} />
        </Field>
        <Field id="tanker-link-end-reason" label={t('link.endReason')} error={errors.reason}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogError message={formError} />
        <DialogFooter busy={busy} cancelLabel={t('common.cancel')} submitLabel={t('link.end')} onCancel={onClose} />
      </form>
    </Dialog>
  );
}
