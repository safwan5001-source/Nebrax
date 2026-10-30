'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Percent, Plus } from 'lucide-react';
import { EmptyState, FormAlert, MobileRecordItem } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Switch } from '@/components/ui/switch';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/formatting';
import { useCan } from '@/lib/use-can';
import { withStoreParam } from '@/modules/commerce-workspace/active-store';
import { formatOrderMoney } from '@/modules/commerce-workspace/orders/order-display';
import { useWholesaleChannel } from '../../channel-context';
import { ResourceBoundary } from '../../components/resource-boundary';
import { SectionPage } from '../../components/section-page';
import { StatCard } from '../../components/stat-card';
import { UnavailablePanel } from '../../components/unavailable-panel';
import { WHOLESALE_BASE } from '../../nav';
import { useResource } from '../../use-resource';
import { deleteWorkspaceOffer, loadOffers, updateWorkspaceOffer, type LoadedOffers, type WorkspaceOffer } from './api';
import { OfferFormDialog } from './offer-form-dialog';
import { offersMessages } from './messages';

export function OffersSection() {
  const { t } = offersMessages.forLocale(useLocale());
  return (
    <SectionPage sectionKey="offers" description={t('description')}>
      <Body />
    </SectionPage>
  );
}

function Body() {
  const locale = useLocale();
  const { t, label } = offersMessages.forLocale(locale);
  const { can } = useCan();
  const toast = useToast();
  const confirm = useConfirm();
  const { store } = useWholesaleChannel();
  const storeId = store!.id; // SectionPage mounts children only with a channel (requires: 'channel')
  const canManage = can('commerce.manage');
  const { state, reload } = useResource(() => loadOffers(storeId), [storeId]);
  const [form, setForm] = useState<{ offer: WorkspaceOffer | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggle(offer: WorkspaceOffer, next: boolean) {
    if (busyId) return;
    setBusyId(offer.id);
    const outcome = await updateWorkspaceOffer(storeId, offer.id, { isActive: next });
    setBusyId(null);
    if (outcome.ok) {
      toast.success(t('updated'));
      reload();
    } else {
      toast.error(t('actionFailed'));
    }
  }

  async function remove(offer: WorkspaceOffer) {
    const name = offer.product?.name ?? t('deletedProduct');
    const ok = await confirm({ title: t('deleteTitle'), message: t('deleteMessage', { name }), confirmLabel: t('delete'), tone: 'danger' });
    if (!ok) return;
    const outcome = await deleteWorkspaceOffer(storeId, offer.id);
    if (outcome.ok) {
      toast.success(t('deleted'));
      reload();
    } else {
      toast.error(t('actionFailed'));
    }
  }

  const windowText = (offer: WorkspaceOffer) =>
    offer.startsAt || offer.endsAt
      ? [offer.startsAt ? `${t('fromLabel')} ${formatDateTime(offer.startsAt, locale)}` : null, offer.endsAt ? `${t('toLabel')} ${formatDateTime(offer.endsAt, locale)}` : null].filter(Boolean).join(' · ')
      : t('noWindow');

  const stateBadge = (offer: WorkspaceOffer) =>
    offer.isLive ? (
      <Badge tone="positive">{t('live')}</Badge>
    ) : (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Badge tone="muted">{t('hidden')}</Badge>
        {offer.reason ? <span className="text-xs text-muted">{label('reason', offer.reason)}</span> : null}
      </span>
    );

  const prices = (offer: WorkspaceOffer) =>
    offer.isLive && offer.referencePrice && offer.offerPrice ? (
      <span className="num">
        <span className="text-muted line-through">{formatOrderMoney({ amount_minor: offer.referencePrice.amountMinor, currency: offer.referencePrice.currency })}</span>{' '}
        <span className="font-medium">{formatOrderMoney({ amount_minor: offer.offerPrice.amountMinor, currency: offer.offerPrice.currency })}</span>{' '}
        {offer.discountPercent !== null ? <Badge tone="neutral">{t('discount', { percent: offer.discountPercent })}</Badge> : null}
      </span>
    ) : (
      <span className="text-xs text-muted">{t('noPrices')}</span>
    );

  return (
    <div className="space-y-4">
      <ResourceBoundary state={state} onRetry={reload} loadingVariant="table">
        {(data: LoadedOffers) => {
          const atLimit = data.maxOffers !== null && data.offers.length >= data.maxOffers;
          const taken = data.offers.map((offer) => offer.productId);
          const name = (offer: WorkspaceOffer) => offer.product?.name ?? t('deletedProduct');
          const actions = (offer: WorkspaceOffer) =>
            canManage ? (
              <div className="flex items-center justify-end gap-1">
                <Switch
                  checked={offer.isActive}
                  disabled={busyId !== null}
                  aria-label={t(offer.isActive ? 'toggleOff' : 'toggleOn', { name: name(offer) })}
                  onCheckedChange={(next) => void toggle(offer, next)}
                />
                <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => setForm({ offer })}>{t('edit')}</Button>
                <Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => void remove(offer)}>{t('delete')}</Button>
              </div>
            ) : null;

          return (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatCard label={t('statConfigured')} value={data.offers.length} />
                <StatCard label={t('statLive')} value={data.offers.filter((offer) => offer.isLive).length} />
                <StatCard
                  label={t('statLimit')}
                  value={data.maxOffers ?? undefined}
                  unavailable={data.maxOffers === null ? t('statLimitUnknown') : undefined}
                  hint={data.maxOffers === null ? undefined : t('statLimitHint')}
                />
              </div>

              <section aria-label={t('tableTitle')} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-medium text-text">{t('tableTitle')}</h2>
                  {canManage ? (
                    <Button type="button" className="min-h-11" disabled={atLimit} onClick={() => setForm({ offer: null })}>
                      <Plus className="h-4 w-4" aria-hidden="true" /> {t('add')}
                    </Button>
                  ) : null}
                </div>
                {atLimit ? <FormAlert tone="info">{t('limitReached')}</FormAlert> : null}
                {data.offers.length === 0 ? (
                  <EmptyState icon={Percent} title={t('emptyTitle')} description={t('emptyBody')} />
                ) : (
                  <div className="rounded border border-border bg-surface">
                    <div className="hidden md:block">
                      <Table>
                        <THead>
                          <TR>
                            <TH scope="col" className="px-3 py-2 text-start font-medium">{t('colProduct')}</TH>
                            <TH scope="col" className="px-3 py-2 text-start font-medium">{t('colWindow')}</TH>
                            <TH scope="col" className="px-3 py-2 text-start font-medium">{t('colState')}</TH>
                            <TH scope="col" className="px-3 py-2 text-start font-medium">{t('colPrices')}</TH>
                            <TH scope="col" className="px-3 py-2 text-end font-medium">{t('colActions')}</TH>
                          </TR>
                        </THead>
                        <TBody>
                          {data.offers.map((offer) => (
                            <TR key={offer.id}>
                              <TD className="px-3 py-2 font-medium text-text"><bdi>{name(offer)}</bdi></TD>
                              <TD className="num px-3 py-2 text-xs text-muted">{windowText(offer)}</TD>
                              <TD className="px-3 py-2">{stateBadge(offer)}</TD>
                              <TD className="px-3 py-2">{prices(offer)}</TD>
                              <TD className="px-3 py-1">{actions(offer)}</TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                    </div>
                    <ul className="divide-y divide-border md:hidden">
                      {data.offers.map((offer) => (
                        <li key={offer.id}>
                          <MobileRecordItem
                            record={{ title: name(offer), subtitle: prices(offer), status: stateBadge(offer), meta: windowText(offer), actions: actions(offer) }}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              {form ? (
                <OfferFormDialog
                  storeId={storeId}
                  offer={form.offer}
                  takenProductIds={taken}
                  onClose={() => setForm(null)}
                  onSaved={(_saved, created) => {
                    toast.success(t(created ? 'created' : 'updated'));
                    setForm(null);
                    reload();
                  }}
                />
              ) : null}
            </>
          );
        }}
      </ResourceBoundary>

      <UnavailablePanel title={t('discountsTitle')} description={t('discountsBody')} blocker={t('discountsBlocker')} reference={t('discountsReference')}>
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <p className="text-xs text-muted">{t('discountsHowTo')}</p>
          <Button asChild variant="outline" size="sm" className="min-h-11">
            <Link href={withStoreParam(`${WHOLESALE_BASE}/price-lists`, storeId)}>{t('goPriceLists')}</Link>
          </Button>
        </div>
      </UnavailablePanel>
    </div>
  );
}
