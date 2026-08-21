'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarClock, FileClock, Plus, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { platformApi } from '@/lib/platform-api';

const PLANS = ['free', 'basic', 'pro', 'enterprise'] as const;
const ACTIVE_STATUSES = ['active', 'trial'];
type Action = 'transition' | 'cancel' | 'expire';

export interface ContractSubscription {
  id: string;
  plan: string;
  status: string;
  monthly_amount: string;
  currency: string;
  starts_on: string | null;
  ends_on: string | null;
  external_reference?: string | null;
  price_version_id?: string | null;
  price_effective_on?: string | null;
}

interface ContractEvent {
  id: string;
  action: string;
  from_plan: string | null;
  to_plan: string | null;
  from_monthly_amount_minor: number | null;
  to_monthly_amount_minor: number | null;
  effective_on: string | null;
  reason: string | null;
  created_at: string | null;
}

interface Props {
  tenantId: string;
  subscriptions: ContractSubscription[];
  onChanged: () => Promise<void>;
}

export function ContractManagementCard({ tenantId, subscriptions, onChanged }: Props) {
  const t = useTranslations('platformTenants');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState('basic');
  const [status, setStatus] = useState('active');
  const [startsOn, setStartsOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [action, setAction] = useState<{ type: Action; subscription: ContractSubscription } | null>(null);
  const [effectiveOn, setEffectiveOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [nextPlan, setNextPlan] = useState('basic');
  const [actionReference, setActionReference] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [events, setEvents] = useState<ContractEvent[] | null>(null);
  const [eventsFor, setEventsFor] = useState<ContractSubscription | null>(null);

  function resetMessages(): void {
    setError(null);
    setNotice(null);
  }

  async function createContract(): Promise<void> {
    setSaving(true);
    resetMessages();
    try {
      await platformApi(`/platform/tenants/${tenantId}/subscriptions`, {
        method: 'POST',
        body: { plan, currency: 'SAR', status, starts_on: startsOn, external_reference: reference || null, reason: reason || null },
      });
      setReference('');
      setReason('');
      await onChanged();
      setNotice(t('contractCreated'));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('contractActionFailed'));
    } finally {
      setSaving(false);
    }
  }

  function openAction(type: Action, subscription: ContractSubscription): void {
    resetMessages();
    setAction({ type, subscription });
    setEffectiveOn(new Date().toISOString().slice(0, 10));
    setNextPlan(subscription.plan);
    setActionReference('');
    setActionReason('');
  }

  async function submitAction(): Promise<void> {
    if (!action) return;
    if (action.type === 'cancel' && !window.confirm(t('confirmCancelContract'))) return;
    if (action.type === 'expire' && !window.confirm(t('confirmExpireContract'))) return;

    setSaving(true);
    resetMessages();
    try {
      if (action.type === 'transition') {
        await platformApi(`/platform/subscriptions/${action.subscription.id}/transition`, {
          method: 'POST',
          body: { plan: nextPlan, currency: 'SAR', effective_on: effectiveOn, external_reference: actionReference || null, reason: actionReason || null },
        });
      } else {
        await platformApi(`/platform/subscriptions/${action.subscription.id}/${action.type}`, {
          method: 'POST', body: { effective_on: effectiveOn, reason: actionReason || null },
        });
      }
      await onChanged();
      setAction(null);
      setNotice(action.type === 'transition' ? t('transitionCreated') : action.type === 'cancel' ? t('contractCancelled') : t('contractExpired'));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('contractActionFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function loadEvents(subscription: ContractSubscription): Promise<void> {
    resetMessages();
    setEventsFor(subscription);
    setEvents(null);
    try {
      const response = await platformApi<{ data: ContractEvent[] }>(`/platform/subscriptions/${subscription.id}/events`);
      setEvents(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('loadEventsFailed'));
      setEventsFor(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader><CardTitle>{t('contractManagement')}</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm leading-relaxed text-muted">{t('contractNotice')}</p>
          {error && <p className="text-sm text-negative" role="alert">{error}</p>}
          {notice && <p className="text-sm text-positive" role="status">{notice}</p>}
          <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1.5 text-sm font-medium text-text"><span>{t('plan')}</span><Select value={plan} onChange={(event) => setPlan(event.target.value)}>{PLANS.map((item) => <option key={item} value={item}>{item}</option>)}</Select></label>
            <label className="space-y-1.5 text-sm font-medium text-text"><span>{t('contractStatus')}</span><Select value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">{t('statusActive')}</option><option value="trial">{t('statusTrial')}</option></Select></label>
            <label className="space-y-1.5 text-sm font-medium text-text"><span>{t('startsOn')}</span><Input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label>
            <label className="space-y-1.5 text-sm font-medium text-text"><span>{t('contractReference')}</span><Input value={reference} onChange={(event) => setReference(event.target.value)} /></label>
            <label className="space-y-1.5 text-sm font-medium text-text sm:col-span-2"><span>{t('reason')}</span><Input value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          </div>
          <Button onClick={createContract} disabled={saving || !startsOn}><Plus className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />{saving ? t('saving') : t('createContract')}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('subscriptionHistory')}</CardTitle></CardHeader>
        <CardContent>
          {subscriptions.length === 0 ? <p className="text-sm text-muted">{t('noSubscriptionHistory')}</p> : <>
            <div className="hidden overflow-x-auto lg:block"><Table><THead><TR><TH>{t('plan')}</TH><TH>{t('status')}</TH><TH className="text-end">{t('monthlyAmount')}</TH><TH>{t('startsOn')}</TH><TH>{t('endsOn')}</TH><TH>{t('action')}</TH></TR></THead><TBody>{subscriptions.map((subscription) => <SubscriptionRow key={subscription.id} subscription={subscription} onAction={openAction} onEvents={loadEvents} t={t} />)}</TBody></Table></div>
            <div className="space-y-3 lg:hidden">{subscriptions.map((subscription) => <SubscriptionMobileCard key={subscription.id} subscription={subscription} onAction={openAction} onEvents={loadEvents} t={t} />)}</div>
          </>}
        </CardContent>
      </Card>

      <Dialog open={action !== null} onClose={() => !saving && setAction(null)} title={action ? action.type === 'transition' ? t('changeContract') : action.type === 'cancel' ? t('cancelContract') : t('expireContract') : t('changeContract')}>
        {action && <div className="space-y-4">
          {action.type === 'transition' && <label className="block space-y-1.5 text-sm font-medium text-text"><span>{t('plan')}</span><Select value={nextPlan} onChange={(event) => setNextPlan(event.target.value)}>{PLANS.map((item) => <option key={item} value={item}>{item}</option>)}</Select></label>}
          <label className="block space-y-1.5 text-sm font-medium text-text"><span>{t('effectiveOn')}</span><Input type="date" value={effectiveOn} onChange={(event) => setEffectiveOn(event.target.value)} /></label>
          {action.type === 'transition' && <label className="block space-y-1.5 text-sm font-medium text-text"><span>{t('contractReference')}</span><Input value={actionReference} onChange={(event) => setActionReference(event.target.value)} /></label>}
          <label className="block space-y-1.5 text-sm font-medium text-text"><span>{t('reason')}</span><Input value={actionReason} onChange={(event) => setActionReason(event.target.value)} /></label>
          <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setAction(null)} disabled={saving}>{t('close')}</Button><Button onClick={submitAction} disabled={saving || !effectiveOn}>{saving ? t('saving') : action.type === 'transition' ? t('transitionContract') : action.type === 'cancel' ? t('cancelContract') : t('expireContract')}</Button></div>
        </div>}
      </Dialog>

      <Dialog open={eventsFor !== null} onClose={() => setEventsFor(null)} title={t('contractEvents')}>
        {events === null ? <p className="text-sm text-muted">{t('saving')}</p> : events.length === 0 ? <p className="text-sm text-muted">{t('noContractEvents')}</p> : <div className="space-y-3">{events.map((event) => <div key={event.id} className="rounded border border-border p-3"><div className="flex items-center justify-between gap-3"><Badge tone="muted">{eventLabel(event.action, t)}</Badge><span className="num text-xs text-muted">{event.effective_on ?? '—'}</span></div><p className="mt-2 text-sm text-text">{event.from_plan ?? '—'} → {event.to_plan ?? '—'}</p>{event.reason && <p className="mt-1 text-xs text-muted">{event.reason}</p>}</div>)}</div>}
      </Dialog>
    </>
  );
}

function SubscriptionRow({ subscription, onAction, onEvents, t }: { subscription: ContractSubscription; onAction: (type: Action, subscription: ContractSubscription) => void; onEvents: (subscription: ContractSubscription) => void; t: (key: string) => string }) {
  const changeable = ACTIVE_STATUSES.includes(subscription.status);
  return <TR><TD className="font-medium">{subscription.plan}{subscription.price_effective_on && <p className="num mt-1 text-xs font-normal text-muted">{t('priceEffectiveOn')} {subscription.price_effective_on}</p>}</TD><TD><Badge tone="muted">{statusLabel(subscription.status, t)}</Badge></TD><TD className="num text-end">{formatRiyal(subscription.monthly_amount)}</TD><TD className="num text-muted">{subscription.starts_on ?? '—'}</TD><TD className="num text-muted">{subscription.ends_on ?? '—'}</TD><TD><ActionButtons subscription={subscription} changeable={changeable} onAction={onAction} onEvents={onEvents} t={t} /></TD></TR>;
}

function SubscriptionMobileCard({ subscription, onAction, onEvents, t }: { subscription: ContractSubscription; onAction: (type: Action, subscription: ContractSubscription) => void; onEvents: (subscription: ContractSubscription) => void; t: (key: string) => string }) {
  return <div className="rounded border border-border p-3"><div className="flex items-center justify-between gap-3"><div><p className="font-medium text-text">{subscription.plan}</p><p className="num mt-1 text-xs text-muted">{subscription.starts_on ?? '—'} · {subscription.ends_on ?? '—'}</p></div><div className="text-end"><Badge tone="muted">{statusLabel(subscription.status, t)}</Badge><p className="num mt-1 text-sm text-text">{formatRiyal(subscription.monthly_amount)}</p></div></div><div className="mt-3 border-t border-border pt-3"><ActionButtons subscription={subscription} changeable={ACTIVE_STATUSES.includes(subscription.status)} onAction={onAction} onEvents={onEvents} t={t} /></div></div>;
}

function ActionButtons({ subscription, changeable, onAction, onEvents, t }: { subscription: ContractSubscription; changeable: boolean; onAction: (type: Action, subscription: ContractSubscription) => void; onEvents: (subscription: ContractSubscription) => void; t: (key: string) => string }) {
  return <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => onEvents(subscription)}><FileClock className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />{t('viewEvents')}</Button>{changeable && <><Button size="sm" variant="outline" onClick={() => onAction('transition', subscription)}><CalendarClock className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />{t('changeContract')}</Button><Button size="sm" variant="outline" onClick={() => onAction('expire', subscription)}>{t('expireContract')}</Button><Button size="sm" variant="danger" onClick={() => onAction('cancel', subscription)}><XCircle className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />{t('cancelContract')}</Button></>}</div>;
}

function statusLabel(status: string, t: (key: string) => string): string {
  if (status === 'trial') return t('statusTrial');
  if (status === 'cancelled') return t('statusCancelled');
  if (status === 'expired') return t('statusExpired');
  return t('statusActive');
}

function eventLabel(action: string, t: (key: string) => string): string {
  if (action === 'upgraded') return t('event_upgraded');
  if (action === 'downgraded') return t('event_downgraded');
  if (action === 'cancelled') return t('event_cancelled');
  if (action === 'expired') return t('event_expired');
  return t('event_created');
}
