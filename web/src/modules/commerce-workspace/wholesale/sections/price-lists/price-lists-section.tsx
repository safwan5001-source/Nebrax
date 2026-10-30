'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Plus, Tags } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, MobileRecordItem } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/lib/use-can';
import { useWholesaleChannel } from '../../channel-context';
import { SectionPage } from '../../components/section-page';
import { UnavailablePanel } from '../../components/unavailable-panel';
import { commonMessages } from '../../messages/common';
import { useResource } from '../../use-resource';
import { deletePriceList, fetchCustomerDefaults, fetchPriceLists, type PriceList } from './api';
import { ChannelPricingCard } from './channel-pricing-card';
import { ListDrawer } from './list-drawer';
import { ListFormDialog } from './list-form-dialog';
import { priceListsMessages } from './messages';

export function PriceListsSection() {
  const { t } = priceListsMessages.forLocale(useLocale());
  return (
    <SectionPage sectionKey="priceLists" description={t('description')}>
      <Body />
    </SectionPage>
  );
}

function Body() {
  const locale = useLocale();
  const { t } = priceListsMessages.forLocale(locale);
  const common = commonMessages.forLocale(locale);
  const { can } = useCan();
  const confirm = useConfirm();
  const toast = useToast();
  const { settings } = useWholesaleChannel();
  const canWrite = can('company.manage');
  const canSeeCustomers = can('partners.view');

  const lists = useResource(fetchPriceLists, []);
  // Customers are read once; a viewer without `partners.view` sends no request and sees an explicit note.
  const customers = useResource(fetchCustomerDefaults, [], { enabled: canSeeCustomers });
  const customerRows = canSeeCustomers && customers.state.status === 'ready' ? customers.state.data : canSeeCustomers ? undefined : null;

  const [opened, setOpened] = useState<string | null>(null);
  const [form, setForm] = useState<{ list: PriceList | null } | null>(null);

  const channelListId = settings.status === 'ready' ? (settings.data.default_price_list?.id ?? null) : null;
  const openedList = lists.state.status === 'ready' ? (lists.state.data.find((candidate) => candidate.id === opened) ?? null) : null;

  async function remove(list: PriceList) {
    const ok = await confirm({
      title: t('deleteConfirmTitle'),
      message: t('deleteConfirm', { name: list.name }) + (list.id === channelListId ? t('deleteAssignedWarn') : ''),
      confirmLabel: t('delete'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deletePriceList(list.id);
      toast.success(t('deleted'));
      setOpened(null);
      lists.reload();
    } catch (failure) {
      toast.error(failure instanceof Error && failure.message ? failure.message : t('err.generic'));
    }
  }

  const countFor = (list: PriceList) => (customerRows == null ? null : customerRows.filter((row) => row.default_price_list_id === list.id).length);

  const rowActions = (list: PriceList) => (
    <div className="flex items-center justify-end gap-1">
      <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => setOpened(list.id)}>
        {t('openDetails')}
      </Button>
      {canWrite ? (
        <Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => void remove(list)}>
          {t('delete')}
        </Button>
      ) : null}
    </div>
  );
  const badges = (list: PriceList) => (
    <>
      <Badge tone={list.is_active ? 'positive' : 'muted'}>{list.is_active ? t('active') : t('inactive')}</Badge>
      {list.id === channelListId ? <Badge tone="neutral">{t('channelDefault')}</Badge> : null}
    </>
  );

  return (
    <div className="space-y-4">
      {lists.state.status === 'ready' ? <ChannelPricingCard lists={lists.state.data} /> : null}

      <section aria-label={t('tableTitle')} className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-text">{t('tableTitle')}</h2>
          {canWrite ? (
            <Button type="button" className="min-h-11" onClick={() => setForm({ list: null })}>
              <Plus className="h-4 w-4" aria-hidden="true" /> {t('create')}
            </Button>
          ) : null}
        </div>
        {!canWrite ? <p className="text-xs text-muted">{t('readOnly')}</p> : null}
        {lists.state.status === 'loading' ? (
          <LoadingState variant="table" rows={4} />
        ) : lists.state.status === 'error' ? (
          <ErrorState message={lists.state.kind === 'forbidden' ? common.t('forbiddenServer') : t('loadError')} onRetry={lists.reload} retryLabel={common.t('retry')} />
        ) : lists.state.data.length === 0 ? (
          <EmptyState
            icon={Tags}
            title={t('emptyTitle')}
            description={t('emptyBody')}
            action={canWrite ? <Button type="button" className="min-h-11" onClick={() => setForm({ list: null })}>{t('create')}</Button> : undefined}
          />
        ) : (
          <div className="rounded border border-border bg-surface">
            <div className="hidden md:block">
              <Table>
                <THead>
                  <TR>
                    <TH scope="col" className="px-3 py-2 text-start font-medium">{t('colName')}</TH>
                    <TH scope="col" className="px-3 py-2 text-start font-medium">{t('colStatus')}</TH>
                    <TH scope="col" className="px-3 py-2 text-end font-medium">{t('colItems')}</TH>
                    <TH scope="col" className="px-3 py-2 text-end font-medium">{t('colCustomers')}</TH>
                    <TH scope="col" className="px-3 py-2"><span className="sr-only">{t('openDetails')}</span></TH>
                  </TR>
                </THead>
                <TBody>
                  {lists.state.data.map((list) => (
                    <TR key={list.id}>
                      <TD className="px-3 py-2">
                        <div className="font-medium text-text"><bdi>{list.name}</bdi></div>
                        {list.description ? <div className="max-w-xs truncate text-xs text-muted">{list.description}</div> : null}
                      </TD>
                      <TD className="px-3 py-2"><div className="flex flex-wrap gap-1">{badges(list)}</div></TD>
                      <TD className="num px-3 py-2 text-end">{list.items_count ?? 0}</TD>
                      <TD className="num px-3 py-2 text-end">{countFor(list) ?? t('customersUnknown')}</TD>
                      <TD className="px-3 py-1">{rowActions(list)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            <ul className="divide-y divide-border md:hidden">
              {lists.state.data.map((list) => (
                <li key={list.id}>
                  <MobileRecordItem
                    record={{
                      title: list.name,
                      subtitle: list.description ?? undefined,
                      amount: list.items_count ?? 0,
                      amountLabel: t('colItems'),
                      status: badges(list),
                      actions: rowActions(list),
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <UnavailablePanel
        title={t('customerPricingTitle')}
        description={t('customerPricingBody')}
        blocker={t('customerPricingBlocker')}
        reference={t('customerPricingReference')}
      />

      <ListDrawer
        list={openedList}
        canWrite={canWrite}
        customers={customerRows ?? null}
        onClose={() => setOpened(null)}
        onChanged={lists.reload}
        onEdit={(list) => setForm({ list })}
      />
      {form ? (
        <ListFormDialog
          list={form.list}
          onClose={() => setForm(null)}
          onSaved={(saved) => {
            toast.success(t('saved'));
            setForm(null);
            lists.reload();
            if (!form.list) setOpened(saved.id);
          }}
        />
      ) : null}
    </div>
  );
}
