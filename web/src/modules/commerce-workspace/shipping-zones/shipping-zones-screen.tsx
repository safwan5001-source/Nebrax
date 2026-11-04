'use client';

import { useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { Info, MapPin, Plus, ShieldAlert } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { formatMinorRiyal, minorToRiyal } from '@/lib/money';
import { useCan } from '@/lib/use-can';
import { classifyError, useResource } from '../wholesale/use-resource';
import { createShippingZone, fetchShippingZones, updateShippingZone, zoneToPayload, type ShippingZone } from './api';
import { EMPTY_ZONE_FORM, ZONE_MATCH_TYPES, validateZoneForm, type ZoneFormErrors, type ZoneFormValues } from './form';
import { shippingZonesMessages, type ShippingZonesMessageKey } from './messages';

/**
 * رفض الخادم → مفتاح رسالة. الوحيد الذي يرفض بـ422 **بلا** `errors` هو فحص التكرار في المتحكّم
 * (`assertMatchValueFree`)؛ وكل رفض تحقق حقول يحمل `errors`.
 */
export function saveErrorKey(error: unknown): ShippingZonesMessageKey {
  const kind = classifyError(error);
  if (kind === 'forbidden') return 'error.forbidden';
  if (kind === 'not_found') return 'error.not_found';
  if (kind === 'validation') {
    const body = typeof error === 'object' && error !== null && 'body' in error ? (error as { body?: unknown }).body : undefined;
    const hasFieldErrors = !!body && typeof body === 'object' && 'errors' in body && (body as { errors?: unknown }).errors != null;

    return hasFieldErrors ? 'error.validation' : 'error.duplicate';
  }

  return 'error.generic';
}

/** Commerce → إعدادات المتجر → مناطق الشحن. بوابة الصلاحية أولاً (لا طلب بدون `commerce.manage`). */
export function ShippingZonesScreen() {
  const locale = useLocale();
  const { t } = shippingZonesMessages.forLocale(locale);
  const { can, hydrated } = useCan();

  let body;
  if (!hydrated) {
    body = <LoadingState variant="table" rows={3} label={t('loading')} />;
  } else if (!can('commerce.manage')) {
    body = <EmptyState icon={ShieldAlert} title={t('forbiddenTitle')} description={t('forbiddenBody')} />;
  } else {
    body = <ShippingZonesPanel />;
  }

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      {body}
    </div>
  );
}

function ShippingZonesPanel() {
  const locale = useLocale();
  const { t, label } = shippingZonesMessages.forLocale(locale);
  const { success: toastSuccess, error: toastError } = useToast();
  const { state, reload } = useResource(fetchShippingZones, []);

  const [editing, setEditing] = useState<ShippingZone | 'new' | null>(null);
  const [confirming, setConfirming] = useState<ShippingZone | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const busy = useRef(false);

  async function setActive(zone: ShippingZone, isActive: boolean) {
    if (busy.current) return;
    busy.current = true;
    setBusyId(zone.id);
    try {
      await updateShippingZone(zone.id, zoneToPayload(zone, { is_active: isActive }));
      toastSuccess(t(isActive ? 'activateOk' : 'deactivateOk'));
      setConfirming(null);
      reload();
    } catch (error) {
      toastError(t(saveErrorKey(error)));
      setConfirming(null);
    } finally {
      busy.current = false;
      setBusyId(null);
    }
  }

  if (state.status === 'loading') return <LoadingState variant="table" rows={4} label={t('loading')} />;
  if (state.status === 'error') return <ErrorState message={t('loadError')} onRetry={reload} />;

  const zones = state.data;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded border border-border bg-surface p-3 text-sm text-muted" role="note">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>{t('scopeNote')}</p>
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('add')}
        </Button>
      </div>

      {zones.length === 0 ? (
        <EmptyState icon={MapPin} title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <div className="overflow-x-auto rounded border border-border bg-surface">
          <Table>
            <THead>
              <TR>
                <TH>{t('colName')}</TH>
                <TH>{t('colMatchType')}</TH>
                <TH>{t('colMatchValue')}</TH>
                <TH>{t('colRate')}</TH>
                <TH>{t('colStatus')}</TH>
                <TH>{t('colActions')}</TH>
              </TR>
            </THead>
            <TBody>
              {zones.map((zone) => (
                <TR key={zone.id}>
                  <TD className="font-medium text-text">{zone.name}</TD>
                  <TD>{label('matchType', zone.matchType)}</TD>
                  <TD>{zone.matchValue}</TD>
                  <TD>
                    <span dir="ltr">{zone.rateMinor === 0 ? t('rateFree') : formatMinorRiyal(zone.rateMinor)}</span>
                  </TD>
                  <TD>
                    <Badge tone={zone.isActive ? 'positive' : 'muted'}>{t(zone.isActive ? 'status.active' : 'status.inactive')}</Badge>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setEditing(zone)} disabled={busyId === zone.id}>
                        {t('edit')}
                      </Button>
                      {zone.isActive ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(zone)} disabled={busyId === zone.id}>
                          {t('deactivate')}
                        </Button>
                      ) : (
                        <Button type="button" variant="ghost" size="sm" onClick={() => void setActive(zone, true)} disabled={busyId === zone.id}>
                          {t('activate')}
                        </Button>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted">{t('noDeleteNote')}</p>

      {editing !== null ? (
        <ZoneDialog
          key={editing === 'new' ? 'new' : editing.id}
          zone={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toastSuccess(t('saveOk'));
            reload();
          }}
        />
      ) : null}

      <Dialog open={confirming !== null} onClose={() => (busyId ? undefined : setConfirming(null))} title={t('deactivateTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-muted">{t('deactivateBody')}</p>
          {confirming ? <p className="text-sm font-medium text-text">{confirming.name}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirming(null)} disabled={busyId !== null}>
              {t('cancel')}
            </Button>
            <Button type="button" variant="danger" onClick={() => confirming && void setActive(confirming, false)} disabled={busyId !== null}>
              {t('deactivateConfirm')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function ZoneDialog({ zone, onClose, onSaved }: { zone: ShippingZone | null; onClose: () => void; onSaved: () => void }) {
  const locale = useLocale();
  const { t } = shippingZonesMessages.forLocale(locale);
  const [values, setValues] = useState<ZoneFormValues>(
    zone
      ? { name: zone.name, matchType: zone.matchType, matchValue: zone.matchValue, rate: minorToRiyal(zone.rateMinor), isActive: zone.isActive }
      : EMPTY_ZONE_FORM,
  );
  const [errors, setErrors] = useState<ZoneFormErrors>({});
  const [serverError, setServerError] = useState<ShippingZonesMessageKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const submitting = useRef(false);

  const set = <K extends keyof ZoneFormValues>(key: K, value: ZoneFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setServerError(null);
  };

  async function submit(event: React.FormEvent, confirmed = false) {
    event.preventDefault();
    if (submitting.current) return;
    const result = validateZoneForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    // تعطيل منطقة نشطة من نموذج التعديل يمرّ بالتأكيد نفسه الذي في إجراء الصف (أثره على نوافذ التوصيل المقيَّدة).
    if (zone?.isActive && !result.payload.is_active && !confirmed) {
      setConfirmingDeactivate(true);
      return;
    }
    setConfirmingDeactivate(false);
    submitting.current = true;
    setSaving(true);
    setServerError(null);
    try {
      if (zone) await updateShippingZone(zone.id, result.payload);
      else await createShippingZone(result.payload);
      onSaved();
    } catch (error) {
      setServerError(saveErrorKey(error));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={() => (saving ? undefined : onClose())} title={t(zone ? 'editTitle' : 'createTitle')}>
      <form onSubmit={(event) => void submit(event)} noValidate className="space-y-4">
        <Field id="sz-name" label={t('fieldName')} error={errors.name ? t(errors.name) : null}>
          <Input id="sz-name" value={values.name} maxLength={300} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} />
        </Field>
        <Field id="sz-type" label={t('fieldMatchType')}>
          <Select id="sz-type" value={values.matchType} onChange={(e) => set('matchType', e.target.value === 'region' ? 'region' : 'city')}>
            {ZONE_MATCH_TYPES.map((type) => (
              <option key={type} value={type}>
                {shippingZonesMessages.forLocale(locale).label('matchType', type)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="sz-value" label={t('fieldMatchValue')} hint={t('fieldMatchValueHint')} error={errors.matchValue ? t(errors.matchValue) : null}>
          <Input id="sz-value" value={values.matchValue} maxLength={300} onChange={(e) => set('matchValue', e.target.value)} aria-invalid={!!errors.matchValue} />
        </Field>
        <Field id="sz-rate" label={t('fieldRate')} hint={t('fieldRateHint')} error={errors.rate ? t(errors.rate) : null}>
          <Input
            id="sz-rate"
            dir="ltr"
            inputMode="decimal"
            value={values.rate}
            onChange={(e) => set('rate', e.target.value)}
            aria-invalid={!!errors.rate}
          />
        </Field>
        <div className="flex items-start justify-between gap-3 rounded border border-border p-3">
          <div>
            <Label htmlFor="sz-active">{t('fieldActive')}</Label>
            <p className="text-xs text-muted">{t('fieldActiveHint')}</p>
          </div>
          <Switch id="sz-active" checked={values.isActive} onCheckedChange={(checked) => set('isActive', checked)} />
        </div>

        {serverError ? (
          <p role="alert" className="text-sm text-negative">
            {t(serverError)}
          </p>
        ) : null}

        {confirmingDeactivate ? (
          <div role="alertdialog" aria-label={t('deactivateTitle')} className="space-y-3 rounded border border-negative/40 bg-negative/5 p-3">
            <p className="text-sm font-medium text-text">{t('deactivateTitle')}</p>
            <p className="text-sm text-muted">{t('deactivateBody')}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmingDeactivate(false)} disabled={saving}>
                {t('cancel')}
              </Button>
              <Button type="button" variant="danger" onClick={(event) => void submit(event as unknown as React.FormEvent, true)} disabled={saving}>
                {saving ? t('saving') : t('deactivateConfirm')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('saving') : t('save')}
            </Button>
          </div>
        )}
      </form>
    </Dialog>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-negative">
          {error}
        </p>
      ) : null}
    </div>
  );
}
