'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { ShieldAlert } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/lib/use-can';
import { useUnsavedGuard } from '../flowers-admin/use-unsaved-guard';
import { classifyError, useResource } from '../wholesale/use-resource';
import { fetchOrderPolicies, saveHoldMinutes, type OrderPolicies } from './api';
import { HOLD_DEFAULT_MINUTES, validateHoldMinutes } from './form';
import { orderPoliciesMessages, type OrderPoliciesMessageKey } from './messages';

export function saveErrorKey(error: unknown): OrderPoliciesMessageKey {
  const kind = classifyError(error);
  if (kind === 'forbidden') return 'error.forbidden';
  if (kind === 'validation') return 'error.validation';

  return 'error.generic';
}

/** Commerce → إعدادات المتجر → سياسات الطلب الإلكتروني. القراءة تتطلب `invoices.view` (كالخادم)، والتحرير `company.manage`. */
export function OrderPoliciesScreen() {
  const locale = useLocale();
  const { t } = orderPoliciesMessages.forLocale(locale);
  const { can, hydrated } = useCan();

  let body;
  if (!hydrated) {
    body = <LoadingState variant="cards" rows={2} label={t('loading')} />;
  } else if (!can('invoices.view')) {
    body = <EmptyState icon={ShieldAlert} title={t('forbiddenTitle')} description={t('forbiddenBody')} />;
  } else {
    body = <Policies canEdit={can('company.manage')} />;
  }

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      {body}
    </div>
  );
}

function Policies({ canEdit }: { canEdit: boolean }) {
  const locale = useLocale();
  const { t } = orderPoliciesMessages.forLocale(locale);
  const { state, reload } = useResource(fetchOrderPolicies, []);

  if (state.status === 'loading') return <LoadingState variant="cards" rows={2} label={t('loading')} />;
  if (state.status === 'error') return <ErrorState message={t('loadError')} onRetry={reload} />;

  return <PoliciesView initial={state.data} canEdit={canEdit} />;
}

function PoliciesView({ initial, canEdit }: { initial: OrderPolicies; canEdit: boolean }) {
  const locale = useLocale();
  const { t, label } = orderPoliciesMessages.forLocale(locale);
  const { success } = useToast();
  const [saved, setSaved] = useState<OrderPolicies>(initial);
  const [text, setText] = useState(String(initial.holdMinutes));
  const [fieldError, setFieldError] = useState<OrderPoliciesMessageKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<OrderPoliciesMessageKey | null>(null);

  const dirty = text.trim() !== String(saved.holdMinutes);
  useUnsavedGuard(dirty);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const result = validateHoldMinutes(text);
    if (!result.ok) {
      setFieldError(`error.${result.error}` as OrderPoliciesMessageKey);
      return;
    }
    setFieldError(null);
    setServerError(null);
    setSaving(true);
    try {
      const next = await saveHoldMinutes(result.minutes);
      setSaved(next);
      setText(String(next.holdMinutes));
      success(t('saved'));
    } catch (error) {
      setServerError(saveErrorKey(error));
    } finally {
      setSaving(false);
    }
  }

  const readonlyRows: { key: OrderPoliciesMessageKey; value: string }[] = [
    { key: 'invoiceTrigger', value: label('invoiceTrigger', saved.invoiceTrigger) },
    { key: 'priceTaxMode', value: saved.priceTaxMode === null ? t('priceTaxMode.unset') : label('priceTaxMode', saved.priceTaxMode) },
    { key: 'partnerPolicy', value: label('partnerPolicy', saved.partnerPolicy) },
  ];

  return (
    <div className="space-y-4">
      <form onSubmit={save} noValidate className="space-y-3 rounded border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text">{t('holdTitle')}</h2>
        <p className="text-sm text-muted">{t('holdHint')}</p>
        <div className="max-w-xs space-y-1">
          <Label htmlFor="op-hold">{t('holdLabel')}</Label>
          <Input
            id="op-hold"
            dir="ltr"
            inputMode="numeric"
            value={text}
            disabled={!canEdit || saving}
            onChange={(e) => {
              setText(e.target.value);
              setFieldError(null);
              setServerError(null);
            }}
            aria-invalid={fieldError !== null}
          />
          <p className="text-xs text-muted">{t('holdDefault', { minutes: HOLD_DEFAULT_MINUTES })} · {t('holdApplies')}</p>
          {fieldError ? (
            <p role="alert" className="text-xs text-negative">
              {t(fieldError)}
            </p>
          ) : null}
        </div>
        {serverError ? (
          <p role="alert" className="text-sm text-negative">
            {t(serverError)}
          </p>
        ) : null}
        {canEdit ? (
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={!dirty || saving}>
              {saving ? t('saving') : t('save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!dirty || saving}
              onClick={() => {
                setText(String(saved.holdMinutes));
                setFieldError(null);
                setServerError(null);
              }}
            >
              {t('discard')}
            </Button>
            {dirty ? <span className="text-xs text-warning">{t('unsaved')}</span> : null}
          </div>
        ) : null}
      </form>

      <section className="space-y-2 rounded border border-border bg-surface p-4" aria-label={t('readonlyTitle')}>
        <h2 className="text-sm font-semibold text-text">{t('readonlyTitle')}</h2>
        <p className="text-sm text-muted">{t('readonlyHint')}</p>
        <dl className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {readonlyRows.map((row) => (
            <div key={row.key} className="contents">
              <dt className="text-sm text-muted">{t(row.key)}</dt>
              <dd className="text-sm font-medium text-text" data-testid={`readonly-${row.key}`}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
