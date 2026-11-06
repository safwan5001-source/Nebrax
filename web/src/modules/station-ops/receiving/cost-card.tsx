'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { parseMoney } from '../cash';
import { ConfirmDialog, NumberField, PrimaryButton, SecondaryButton } from '../write-ui';
import { useReceivingAccess } from './data';
import { Cost, FailureNotice, type AnyFailure } from './parts';
import { receivingGet, deliveryPath, recordCost } from './receiving-client';
import { deliveryResponse, type Delivery } from './schemas';

/**
 * FUEL-B5.1 — بطاقة «تكلفة الاستلام». ثلاث حالات بحسب ما يعيده الخادم وما يملكه المستخدم (والخادم يفرض كل ذلك):
 *  - **لا يملك رؤية التكلفة**: حالة فقط («مسجَّلة»/«بانتظار المالية») — لا مبلغ ولا حقل.
 *  - **يرى ولا يسجّل**: المبلغ فقط.
 *  - **يسجّل** (`fuel.delivery.cost.record` أو `fuel_stations.manage` **و** `products.view_cost`) والاستلام مسودة: حقل هللات/ريال + تأكيد يردّد المبلغ.
 * تسجيل التكلفة لا يُحرّك مخزوناً ولا قيداً — الأثر عند الاعتماد وحده (تُقال في البطاقة). بعد الاعتماد: مقفلة.
 */
export function CostCard({ delivery, branchId, compact = false, onSaved }: { delivery: Delivery; branchId?: string | null; compact?: boolean; onSaved: (delivery: Delivery) => void }) {
  const t = useTranslations('stationOps');
  const access = useReceivingAccess();
  const [value, setValue] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<AnyFailure | null>(null);
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);

  const draft = delivery.status === 'draft';
  const recorded = delivery.cost_recorded === true || (delivery.received_total_cost_minor !== null && delivery.received_total_cost_minor !== undefined);
  const amount = delivery.received_total_cost_minor; // undefined = لا صلاحية رؤية؛ null = لم تُسجَّل
  const parsed = parseMoney(value, { min: 1 });
  const error = attempted && !parsed.ok ? t(parsed.reason === 'empty' ? 'receiving.cost.required' : 'receiving.cost.invalid') : null;

  const refresh = async (): Promise<Delivery | null> => {
    try {
      return (await receivingGet(deliveryPath(delivery.id), deliveryResponse, { branchId })).data;
    } catch {
      return null;
    }
  };

  const save = async () => {
    if (inFlight.current || !parsed.ok) return; // قفل إرسال مكرر
    inFlight.current = true;
    setSaving(true);
    setFailure(null);
    try {
      const result = await recordCost(delivery.id, parsed.minor, { branchId });
      setConfirming(false);
      if (result.kind === 'ok') {
        setValue('');
        setAttempted(false);
        setSaved(true);
        onSaved(result.delivery);
      } else {
        setFailure(result);
        if (result.kind === 'rejected' && result.code === 'cost_locked') { const fresh = await refresh(); if (fresh) onSaved(fresh); }
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const check = async () => {
    setChecking(true);
    const fresh = await refresh();
    setChecking(false);
    if (fresh) { onSaved(fresh); if (parsed.ok && fresh.received_total_cost_minor === parsed.minor) { setFailure(null); setSaved(true); setValue(''); } }
  };

  const status = recorded
    ? <span data-cost-state="recorded" className="font-semibold text-positive">{t('receiving.cost.recorded')}</span>
    : <span data-cost-state="missing" className="font-semibold text-warning">{t('receiving.cost.missing')}</span>;

  return (
    <div className="space-y-3" data-cost-card="">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted">{t('receiving.cost.state')}</span>
        {status}
      </div>

      {access.seeCost && typeof amount === 'number' ? (
        <div className="flex items-center justify-between gap-3 text-sm"><span className="text-muted">{t('receiving.field.cost')}</span><span className="text-base font-semibold text-text"><Cost minor={amount} /></span></div>
      ) : null}

      {!access.seeCost ? <p className="text-sm leading-6 text-muted">{recorded ? t('receiving.cost.blindRecorded') : t('receiving.cost.blindMissing')}</p> : null}

      {!draft ? (
        <p className="flex items-start gap-2 text-sm leading-6 text-muted"><Lock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />{t('receiving.cost.locked')}</p>
      ) : access.recordCost ? (
        <div className="space-y-3">
          <NumberField
            label={recorded ? t('receiving.cost.correctLabel') : t('receiving.cost.label')}
            value={value}
            onChange={(next) => { setValue(next); setFailure(null); setSaved(false); }}
            suffix={t('receiving.currency')}
            hint={compact ? undefined : t('receiving.cost.hint')}
            error={error}
            disabled={saving}
            testId="rcv-cost-input"
          />
          {saved ? <p role="status" data-cost-saved="" className="text-sm font-medium text-positive">{t('receiving.cost.saved')}</p> : null}
          {failure ? <FailureNotice failure={failure} onCheck={() => void check()} checking={checking} /> : null}
          <PrimaryButton data-cost-save="" disabled={saving} onClick={() => { setAttempted(true); if (parsed.ok) setConfirming(true); }}>{t('receiving.cost.save')}</PrimaryButton>
        </div>
      ) : (
        <p className="text-sm leading-6 text-muted">{t('receiving.cost.noPermission')}</p>
      )}

      <ConfirmDialog open={confirming} title={t('receiving.cost.confirmTitle')} onClose={() => setConfirming(false)} busy={saving}>
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted">{t('receiving.cost.confirmBody')}</p>
          <p className="text-center text-2xl font-bold text-text" data-cost-echo="">{parsed.ok ? <Cost minor={parsed.minor} /> : null}</p>
          <div className="grid grid-cols-2 gap-2.5">
            <SecondaryButton onClick={() => setConfirming(false)} disabled={saving}>{t('receiving.cost.back')}</SecondaryButton>
            <PrimaryButton data-cost-confirm="" disabled={saving} aria-busy={saving} onClick={() => void save()}>{saving ? t('receiving.cost.saving') : t('receiving.cost.confirm')}</PrimaryButton>
          </div>
        </div>
      </ConfirmDialog>
    </div>
  );
}
