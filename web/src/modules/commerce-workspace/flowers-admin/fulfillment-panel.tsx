'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Warehouse as WarehouseIcon } from 'lucide-react';
import { EmptyState, FormActions, FormAlert } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { failureText } from './failure-text';
import { saveFulfillment, type FulfillmentDocument, type FulfillmentWarehouse } from './fulfillment';
import { flowersAdminT } from './messages';
import { useUnsavedGuard } from './use-unsaved-guard';

const label = (w: FulfillmentWarehouse) => [w.name, w.code ? `(${w.code})` : null, w.city].filter(Boolean).join(' — ').replace(' — (', ' (');

/**
 * FLOWERS-H2-5 / ADR-20 — مخزن تنفيذ القناة. هو الشرط الذي يجعل الخادم قادراً على حساب «يصل اليوم» لكل منتج
 * (رصيد البيع يُقرأ من هذا المخزن). نعرض الحالة الفعلية فقط ولا نَعِد بتوفّر: الخادم يقرّره لكل منتج. الاختيار
 * من مخازن المستأجر النشطة (يستبدل التعيين القائم)؛ لا نقل مخزون ولا قيود.
 */
export function FulfillmentPanel({
  storeId,
  locale,
  document,
  onDocument,
}: {
  storeId: string;
  locale: string | undefined;
  document: FulfillmentDocument;
  onDocument: (next: FulfillmentDocument) => void;
}) {
  const t = useMemo(() => flowersAdminT(locale), [locale]);
  const { success: toastSuccess } = useToast();
  const [choice, setChoice] = useState(document.current?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = document.warehouses.filter((w) => w.isActive);
  const dirty = choice !== '' && choice !== (document.current?.id ?? '');
  useUnsavedGuard(dirty);
  const currentInactive = document.current !== null && !document.current.isActive;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    const result = await saveFulfillment(storeId, choice);
    setSaving(false);
    if (!result.ok) {
      setError(failureText(result, t));
      return;
    }
    toastSuccess(t('fulSaved'));
    onDocument(result.data);
    setChoice(result.data.current?.id ?? '');
  }

  return (
    <section aria-label={t('fulTab')} className="max-w-3xl space-y-4" data-fulfillment-panel>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-text">{t('fulTab')}</h2>
        <p className="text-xs leading-5 text-muted">{t('fulIntro')}</p>
      </div>

      {active.length === 0 && document.current === null ? (
        <EmptyState
          icon={WarehouseIcon}
          title={t('fulNoWarehousesTitle')}
          description={t('fulNoWarehousesDescription')}
          action={
            <Button asChild>
              <Link href="/warehouses/new">{t('fulCreateWarehouse')}</Link>
            </Button>
          }
        />
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="space-y-3 rounded border border-border bg-surface p-4">
            <p className="text-sm" data-fulfillment-current>
              <span className="text-muted">{t('fulCurrent')}: </span>
              <span className="font-medium text-text">{document.current ? label(document.current) : t('fulNone')}</span>
            </p>
            {currentInactive ? <FormAlert tone="warning">{t('fulCurrentInactive')}</FormAlert> : null}
            <div className="space-y-1.5">
              <Label htmlFor="ful-warehouse">{t('fulChoose')}</Label>
              <Select id="ful-warehouse" value={choice} disabled={saving} aria-describedby="ful-hint" onChange={(e) => { setChoice(e.target.value); setError(null); }}>
                {document.current === null ? <option value="">{t('fulChoosePlaceholder')}</option> : null}
                {currentInactive && document.current ? (
                  <option value={document.current.id} disabled>
                    {label(document.current)} — {t('fulInactive')}
                  </option>
                ) : null}
                {active.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {label(warehouse)}
                  </option>
                ))}
              </Select>
              <p id="ful-hint" className="text-xs leading-5 text-muted">{t('fulHint')}</p>
            </div>
          </div>

          {error ? <FormAlert tone="error">{error}</FormAlert> : null}

          <FormActions
            sticky={false}
            note={<span role="status">{dirty ? t('unsaved') : t('allSaved')}</span>}
            secondary={
              <Button type="button" variant="outline" disabled={!dirty || saving} onClick={() => { setChoice(document.current?.id ?? ''); setError(null); }}>
                {t('discard')}
              </Button>
            }
            primary={
              <Button type="submit" disabled={!dirty || saving}>
                {saving ? t('saving') : t('save')}
              </Button>
            }
          />
        </form>
      )}
    </section>
  );
}
