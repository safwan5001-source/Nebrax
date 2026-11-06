'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, CircleCheck, CircleDashed, ShieldCheck } from 'lucide-react';
import { useStationOps } from '../context';
import { useStationAssets } from '../data';
import { PageMasthead, ScreenBody } from '../masthead';
import { StationOpsError } from '../read-client';
import { ErrorState, LoadingBlock } from '../state-views';
import { ConfirmDialog, PrimaryButton, SecondaryButton, SectionCard } from '../write-ui';
import { Badge } from '../admin/ui';
import { useDelivery, useReceivingAccess } from './data';
import { AttachmentsPanel } from './attachments-panel';
import { CostCard } from './cost-card';
import { DocumentActions } from './document-actions';
import { Cost, FailureNotice, Liters, RECEIVING_BASE, StatusBadge, VarianceText, deliveryTitle, when, type AnyFailure } from './parts';
import { approveDelivery, deliveryPath, receivingGet } from './receiving-client';
import { deliveryResponse, type Delivery } from './schemas';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-end text-sm text-text">{children}</dd>
    </div>
  );
}

function Readings({ delivery }: { delivery: Delivery }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const r = delivery.readings;
  const pairs: Array<['physical' | 'atg', NonNullable<typeof r>['before_physical'], NonNullable<typeof r>['after_physical']]> = r
    ? [['physical', r.before_physical, r.after_physical], ['atg', r.before_atg, r.after_atg]]
    : [];
  const shown = pairs.filter(([, before, after]) => before || after);
  if (shown.length === 0) return <p className="text-sm text-muted">{t('receiving.detail.noReadings')}</p>;
  return (
    <div className="space-y-4">
      {shown.map(([type, before, after]) => {
        const b = before?.quantity_milliliters;
        const a = after?.quantity_milliliters;
        const gain = b !== undefined && a !== undefined ? a - b : null;
        return (
          <div key={type}>
          <p className="pb-1 text-sm font-semibold text-text">{t(`receiving.readingType.${type}`)}</p>
          <dl className="divide-y divide-border">
            <Row label={t('receiving.detail.before')}><Liters ml={b} /> {before?.measured_at ? <span className="num text-xs text-muted">· {when(before.measured_at, locale)}</span> : null}</Row>
            <Row label={t('receiving.detail.after')}><Liters ml={a} /> {after?.measured_at ? <span className="num text-xs text-muted">· {when(after.measured_at, locale)}</span> : null}</Row>
            <Row label={t('receiving.detail.tankGain')}><Liters ml={gain} /></Row>
            {gain !== null ? <Row label={t('receiving.detail.gainVsReceived')}><VarianceText ml={gain - delivery.received_milliliters} /></Row> : null}
          </dl>
          </div>
        );
      })}
    </div>
  );
}

/** جاهزية الاعتماد كما يراها الخادم (إرشاد فقط — القرار النهائي للخادم عند الضغط): تكلفة مسجَّلة + دليل مستند (رقم سند أو مرفق). */
export function readiness(delivery: Delivery, attachmentCount: number): { cost: boolean; document: boolean; ready: boolean } {
  const cost = delivery.cost_recorded === true || typeof delivery.received_total_cost_minor === 'number';
  const document = (delivery.delivery_note_number ?? '').trim() !== '' || attachmentCount > 0;
  return { cost, document, ready: cost && document };
}

function Detail({ initial }: { initial: Delivery }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const { viewer, stations } = useStationOps();
  const access = useReceivingAccess();
  const [delivery, setDelivery] = useState<Delivery>(initial);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<AnyFailure | null>(null);
  const [justApproved, setJustApproved] = useState(false);
  const inFlight = useRef(false);

  const station = stations.status === 'success' ? (stations.data.find((row) => row.id === delivery.station_id) ?? null) : null;
  const assets = useStationAssets(station);
  const productName = assets.state.status === 'success' ? (assets.state.data.products.find((row) => row.id === delivery.fuel_product_id)?.name ?? null) : null;
  const draft = delivery.status === 'draft';
  const mine = delivery.created_by === viewer.id;

  /** قراءة حالة الاستلام الحقيقية من الخادم — لا إعادة إرسال. يعيد السجل أو null إن تعذّرت. */
  const refresh = async (): Promise<Delivery | null> => {
    try {
      const fresh = (await receivingGet(deliveryPath(delivery.id), deliveryResponse, { branchId: station?.branch_id })).data;
      setDelivery(fresh);
      return fresh;
    } catch {
      return null;
    }
  };

  const attachmentCount = delivery.attachments?.length ?? delivery.attachments_count ?? 0;
  const ready = readiness(delivery, attachmentCount);

  const confirm = async () => {
    if (inFlight.current) return; // قفل إرسال مكرر
    inFlight.current = true;
    setSaving(true);
    setFailure(null);
    try {
      // المعتمِد الذي يرى التكلفة يرسل ما راجعه: تغيّرت بعد مراجعته ⇒ 409 بلا أثر (لا يعتمد قيمة لم يرها).
      const expected = access.seeCost && typeof delivery.received_total_cost_minor === 'number' && delivery.received_total_cost_minor > 0 ? { expected_total_cost_minor: delivery.received_total_cost_minor } : {};
      const body = { ...(reason.trim() === '' ? {} : { reason: reason.trim().slice(0, 1000) }), ...expected };
      const result = await approveDelivery(delivery.id, body, { branchId: station?.branch_id });
      setConfirming(false);
      if (result.kind === 'ok') {
        setDelivery(result.delivery);
        setJustApproved(true);
        setReason('');
        return;
      }
      setFailure(result);
      // رفض «معتمد سابقاً»: الحالة تغيّرت عند غيرنا — نقرأها فوراً فتظهر كما هي.
      if (result.kind === 'rejected' && ['already_approved', 'cost_changed', 'cost_required', 'document_required'].includes(result.code)) await refresh();
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const check = async () => {
    setChecking(true);
    const fresh = await refresh();
    setChecking(false);
    if (fresh?.status === 'approved') { setFailure(null); setJustApproved(true); }
  };

  const title = deliveryTitle(delivery, t('receiving.untitled'));

  return (
    <>
      <PageMasthead title={title} subtitle={delivery.supplier?.name ?? undefined} backHref={RECEIVING_BASE} backLabel={t('receiving.title')} />
      <ScreenBody>
        <section className="flex flex-wrap items-center gap-2 rounded-[14px] border border-border bg-surface p-4">
          <StatusBadge status={delivery.status} />
          {station ? <Badge tone="neutral">{station.name}</Badge> : null}
          <span className="num text-xs text-muted">{when(delivery.received_at ?? delivery.created_at, locale)}</span>
        </section>

        {justApproved && delivery.status === 'approved' ? (
          <div role="status" data-approved-success="" className="flex items-start gap-3 rounded-[14px] border border-border bg-[color:var(--fo-positive-tint)] p-3.5 text-sm leading-6 text-positive">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.9} />
            <div><p className="font-semibold">{t('receiving.approve.doneTitle')}</p><p>{t('receiving.approve.doneBody')}</p></div>
          </div>
        ) : null}

        {failure ? <FailureNotice failure={failure} onCheck={() => void check()} checking={checking} /> : null}

        <SectionCard title={t('receiving.detail.deliveryTitle')} id="rcv-delivery-h">
          <dl className="divide-y divide-border">
            <Row label={t('receiving.field.supplier')}>{delivery.supplier?.name ?? '—'}</Row>
            <Row label={t('receiving.field.tank')}>{delivery.tank?.name ?? '—'}{productName ? <span className="text-muted"> · {productName}</span> : null}</Row>
            <Row label={t('receiving.field.warehouse')}>{delivery.warehouse?.name ?? '—'}</Row>
            <Row label={t('receiving.field.deliveryNote')}>{delivery.delivery_note_number || <span className="text-muted">{t('receiving.detail.none')}</span>}</Row>
            <Row label={t('receiving.field.purchaseRef')}>{delivery.purchase_reference || <span className="text-muted">{t('receiving.detail.none')}</span>}</Row>
            {delivery.tanker_identifier ? <Row label={t('receiving.field.tanker')}>{delivery.tanker_identifier}</Row> : null}
            {delivery.driver_name ? <Row label={t('receiving.field.driver')}>{delivery.driver_name}</Row> : null}
            {delivery.notes ? <Row label={t('receiving.field.notes')}>{delivery.notes}</Row> : null}
          </dl>
        </SectionCard>

        <SectionCard title={t('receiving.detail.quantitiesTitle')} id="rcv-qty-h">
          <dl className="divide-y divide-border">
            <Row label={t('receiving.field.dispatched')}><Liters ml={delivery.dispatched_milliliters} /></Row>
            <Row label={t('receiving.field.received')}><Liters ml={delivery.received_milliliters} /></Row>
            <Row label={t('receiving.detail.transitVariance')}><VarianceText ml={delivery.transit_variance_milliliters} /></Row>
          </dl>
        </SectionCard>

        <SectionCard title={t('receiving.cost.title')} id="rcv-cost-h">
          <CostCard delivery={delivery} branchId={station?.branch_id} onSaved={(fresh) => setDelivery(fresh)} />
        </SectionCard>

        <SectionCard title={t('receiving.attach.title')} id="rcv-att-h">
          <AttachmentsPanel
            deliveryId={delivery.id}
            branchId={station?.branch_id}
            attachments={delivery.attachments ?? []}
            canUpload={access.attach && draft}
            canDelete={access.attach && draft}
            onChanged={async () => { await refresh(); }}
          />
        </SectionCard>

        <SectionCard title={t('receiving.detail.readingsTitle')} id="rcv-read-h"><Readings delivery={delivery} /></SectionCard>

        {delivery.status === 'approved' ? (
          <SectionCard title={t('receiving.detail.approvedTitle')} id="rcv-appr-h">
            <dl className="divide-y divide-border">
              <Row label={t('receiving.detail.approvedAt')}><span className="num">{when(delivery.approved_at, locale)}</span></Row>
              <Row label={t('receiving.detail.approvedBy')}>{delivery.approved_by === viewer.id ? t('receiving.detail.you') : t('receiving.detail.another')}</Row>
            </dl>
            <p className="mt-3 text-sm leading-6 text-muted">{t('receiving.detail.approvedEffect')}</p>
          </SectionCard>
        ) : null}

        <SectionCard title={t('receiving.docs.title')} id="rcv-docs-h">
          <DocumentActions target={{ kind: 'receipt', deliveryId: delivery.id, reference: `FD-${delivery.id.slice(0, 8).toUpperCase()}` }} branchId={station?.branch_id} />
        </SectionCard>

        {draft ? (
          <SectionCard title={t('receiving.approve.title')} id="rcv-approve-h">
            <p className="flex items-start gap-2 text-sm leading-6 text-muted"><ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />{t('receiving.approve.effect')}</p>
            <ul className="mt-3 space-y-1.5 text-sm" data-readiness="">
              {([['cost', ready.cost], ['document', ready.document]] as const).map(([key, ok]) => (
                <li key={key} data-ready-item={key} data-ok={ok ? 'true' : 'false'} className={ok ? 'flex items-center gap-2 text-positive' : 'flex items-center gap-2 text-warning'}>
                  {ok ? <CircleCheck aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.9} /> : <CircleDashed aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.9} />}
                  {t(`receiving.ready.${key}_${ok ? 'ok' : 'missing'}`)}
                </li>
              ))}
            </ul>
            {access.approve && mine ? <p role="note" data-creator-hint="" className="mt-3 rounded-[12px] bg-[color:var(--fo-warning-tint)] p-3 text-sm leading-6 text-warning">{t('receiving.approve.creatorHint')}</p> : null}
            {access.approve ? (
              <div className="mt-4"><PrimaryButton data-approve-action="" disabled={saving || !ready.ready} onClick={() => setConfirming(true)}>{t('receiving.approve.action')}</PrimaryButton>
                {!ready.ready ? <p className="mt-2 text-xs leading-5 text-muted" data-not-ready="">{t('receiving.ready.blocked')}</p> : null}</div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-muted">{t('receiving.approve.noPermission')}</p>
            )}
          </SectionCard>
        ) : null}
      </ScreenBody>

      <ConfirmDialog open={confirming} title={t('receiving.approve.confirmTitle')} onClose={() => setConfirming(false)} busy={saving}>
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted">{t('receiving.approve.confirmBody')}</p>
          <dl className="divide-y divide-border rounded-[12px] border border-border px-3">
            <Row label={t('receiving.field.supplier')}>{delivery.supplier?.name ?? '—'}</Row>
            <Row label={t('receiving.field.received')}><Liters ml={delivery.received_milliliters} /></Row>
            {typeof delivery.received_total_cost_minor === 'number' ? <Row label={t('receiving.field.cost')}><Cost minor={delivery.received_total_cost_minor} /></Row> : null}
          </dl>
          <div>
            <label htmlFor="rcv-approve-reason" className="block text-sm font-medium text-text">{t('receiving.approve.reason')}</label>
            <textarea id="rcv-approve-reason" value={reason} maxLength={1000} rows={2} disabled={saving} onChange={(event) => setReason(event.target.value)} className="mt-1.5 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface p-3 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <SecondaryButton onClick={() => setConfirming(false)} disabled={saving}>{t('receiving.approve.back')}</SecondaryButton>
            <PrimaryButton data-confirm-approve="" onClick={() => void confirm()} disabled={saving} aria-busy={saving}>{saving ? t('receiving.approve.saving') : t('receiving.approve.confirm')}</PrimaryButton>
          </div>
        </div>
      </ConfirmDialog>
    </>
  );
}

export function ReceivingDetailScreen({ id }: { id: string }) {
  const t = useTranslations('stationOps');
  const delivery = useDelivery(id);
  const head = <PageMasthead title={t('receiving.title')} backHref={RECEIVING_BASE} backLabel={t('receiving.title')} />;
  if (delivery.state.status === 'error') return <>{head}<ScreenBody><ErrorState error={delivery.state.error instanceof StationOpsError ? delivery.state.error : new StationOpsError('server')} onRetry={delivery.reload} /></ScreenBody></>;
  if (delivery.state.status !== 'success') return <>{head}<ScreenBody><LoadingBlock rows={4} /></ScreenBody></>;
  return <Detail key={delivery.state.data.id} initial={delivery.state.data} />;
}
