'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, Webhook, XCircle } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { PageHeader, type PageAction } from '@/components/nebrax';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { SecretRevealDialog } from '@/components/developer/secret-reveal';
import { ConfirmDialog } from '@/components/developer/confirm-dialog';
import { WebhookFormDialog } from '@/components/developer/webhooks/webhook-form-dialog';
import { DeliveriesPanel } from '@/components/developer/webhooks/deliveries-panel';
import {
  deleteWebhook, listWebhooks, rotateWebhookSecret, updateWebhook,
  type DeveloperWebhook, type WebhookWithSecret,
} from '@/lib/developer';
import { formatDate, formatDateTime } from '@/lib/formatting';

export function WebhooksWorkspace({ canManage }: { canManage: boolean }) {
  const t = useTranslations('developer.webhooks');
  const tsec = useTranslations('developer.secret');
  const locale = useLocale();
  const { success, error: toastError } = useToast();

  const [tab, setTab] = useState('subscriptions');
  const [hooks, setHooks] = useState<DeveloperWebhook[] | null>(null);
  const [error, setError] = useState(false);

  const [form, setForm] = useState<{ mode: 'create' | 'edit'; webhook?: DeveloperWebhook } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [rotate, setRotate] = useState<DeveloperWebhook | null>(null);
  const [remove, setRemove] = useState<DeveloperWebhook | null>(null);
  const [busy, setBusy] = useState(false);

  // منسّق مركزي (لا Intl مباشر — حارس صيغة التاريخ)؛ null ⇒ null.
  const when = useCallback((iso: string | null, withTime = false) => (
    iso ? (withTime ? formatDateTime(iso, locale, { dateStyle: 'short', timeStyle: 'short' }) : formatDate(iso, locale)) : null
  ), [locale]);

  const load = useCallback(async () => {
    setError(false);
    try {
      setHooks(await listWebhooks());
    } catch {
      setError(true);
      setHooks(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onCreated = (result: WebhookWithSecret) => {
    setForm(null);
    setSecret(result.secret);
    success(t('created'));
    void load();
  };

  async function toggleStatus(hook: DeveloperWebhook) {
    setBusy(true);
    try {
      await updateWebhook(hook.id, { status: hook.status === 'enabled' ? 'disabled' : 'enabled' });
      success(hook.status === 'enabled' ? t('disabledToast') : t('enabledToast'));
      await load();
    } catch {
      toastError(t('updateError'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRotate() {
    if (!rotate) return;
    setBusy(true);
    try {
      const result = await rotateWebhookSecret(rotate.id);
      setRotate(null);
      setSecret(result.secret);
      success(t('rotated'));
      await load();
    } catch {
      toastError(t('rotateError'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (!remove) return;
    setBusy(true);
    try {
      await deleteWebhook(remove.id);
      success(t('deleted'));
      setRemove(null);
      await load();
    } catch {
      toastError(t('deleteError'));
    } finally {
      setBusy(false);
    }
  }

  const columns = useMemo<ColumnDef<DeveloperWebhook, unknown>[]>(() => [
    {
      id: 'endpoint', enableSorting: false, header: t('colEndpoint'),
      cell: ({ row }) => (
        <div className="min-w-0">
          <span dir="ltr" className="block max-w-[260px] truncate font-mono text-xs text-text">{row.original.url}</span>
          {row.original.description ? <span className="block truncate text-xs text-muted">{row.original.description}</span> : null}
        </div>
      ),
    },
    {
      id: 'events', enableSorting: false, header: t('colEvents'),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.event_types.map((event) => <Badge key={event} tone="muted"><code dir="ltr" className="font-mono text-[11px]">{event}</code></Badge>)}
        </div>
      ),
    },
    {
      id: 'status', enableSorting: false, header: t('colStatus'),
      cell: ({ row }) => <Badge tone={row.original.status === 'enabled' ? 'positive' : 'muted'}>{row.original.status === 'enabled' ? t('enabled') : t('disabled')}</Badge>,
    },
    {
      id: 'activity', enableSorting: false, header: t('colActivity'),
      cell: ({ row }) => <ActivityCell hook={row.original} when={when} />,
    },
    { id: 'created', enableSorting: false, header: t('colCreated'), cell: ({ row }) => <span className="num text-xs text-muted">{when(row.original.created_at)}</span> },
    ...(canManage ? [{
      id: 'actions', enableSorting: false, header: '',
      cell: ({ row }: { row: { original: DeveloperWebhook } }) => <RowActions hook={row.original} t={t} onEdit={() => setForm({ mode: 'edit', webhook: row.original })} onRotate={() => setRotate(row.original)} onToggle={() => void toggleStatus(row.original)} onDelete={() => setRemove(row.original)} />,
    }] : []),
  ], [t, when, canManage]);

  const mobileRecord = useCallback((hook: DeveloperWebhook) => ({
    title: <span dir="ltr" className="font-mono text-xs">{hook.url}</span>,
    subtitle: hook.event_types.join(' · '),
    status: <Badge tone={hook.status === 'enabled' ? 'positive' : 'muted'}>{hook.status === 'enabled' ? t('enabled') : t('disabled')}</Badge>,
    meta: when(hook.created_at),
    actions: canManage ? <RowActions hook={hook} t={t} onEdit={() => setForm({ mode: 'edit', webhook: hook })} onRotate={() => setRotate(hook)} onToggle={() => void toggleStatus(hook)} onDelete={() => setRemove(hook)} /> : undefined,
  }), [t, when, canManage]);

  const actions: PageAction[] = canManage && tab === 'subscriptions'
    ? [{ key: 'create', label: t('create'), icon: Plus, onClick: () => setForm({ mode: 'create' }) }]
    : [];

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} description={t('description')} actions={actions} />

      <Tabs
        tabs={[{ id: 'subscriptions', label: t('tabSubscriptions') }, { id: 'deliveries', label: t('tabDeliveries') }]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'subscriptions' ? (
        <TabPanel id="subscriptions">
          <DataTable
            columns={columns}
            data={hooks ?? []}
            loading={hooks === null && !error}
            error={error ? t('loadError') : null}
            onRetry={() => void load()}
            showToolbar={false}
            emptyLabel={t('empty')}
            emptyDescription={t('emptyHint')}
            emptyAction={canManage ? <Button type="button" onClick={() => setForm({ mode: 'create' })}><Plus className="h-4 w-4" strokeWidth={1.8} />{t('create')}</Button> : undefined}
            mobileRecord={mobileRecord}
          />
        </TabPanel>
      ) : (
        <TabPanel id="deliveries">
          <DeliveriesPanel endpoints={hooks ?? []} />
        </TabPanel>
      )}

      {/* الحوارات */}
      {form ? (
        <WebhookFormDialog
          open
          mode={form.mode}
          webhook={form.webhook}
          onClose={() => setForm(null)}
          onCreated={onCreated}
          onUpdated={() => { setForm(null); success(t('updated')); void load(); }}
        />
      ) : null}

      {secret !== null ? (
        <SecretRevealDialog open title={tsec('webhookTitle')} description={t('verifyGuidance')} secret={secret} onClose={() => setSecret(null)} />
      ) : null}

      {rotate ? (
        <ConfirmDialog open title={t('rotateTitle')} message={t('rotateConfirm')} detail={rotate.url} confirmLabel={t('rotate')} danger={false} busy={busy} onClose={() => setRotate(null)} onConfirm={() => void confirmRotate()} />
      ) : null}

      {remove ? (
        <ConfirmDialog open title={t('deleteTitle')} message={t('deleteConfirm')} detail={remove.url} confirmLabel={t('delete')} busy={busy} onClose={() => setRemove(null)} onConfirm={() => void confirmRemove()} />
      ) : null}
    </div>
  );
}

function ActivityCell({ hook, when }: { hook: DeveloperWebhook; when: (iso: string | null, withTime?: boolean) => string | null }) {
  const t = useTranslations('developer.webhooks');
  if (!hook.last_success_at && !hook.last_failure_at) return <span className="text-xs text-muted">{t('noActivity')}</span>;
  return (
    <div className="space-y-0.5 text-xs">
      {hook.last_success_at ? (
        <div className="flex items-center gap-1 text-muted"><CheckCircle2 className="h-3 w-3 text-positive" strokeWidth={1.9} aria-hidden="true" /><span className="num">{when(hook.last_success_at, true)}</span></div>
      ) : null}
      {hook.last_failure_at ? (
        <div className="flex items-center gap-1 text-muted"><XCircle className="h-3 w-3 text-negative" strokeWidth={1.9} aria-hidden="true" /><span className="num">{when(hook.last_failure_at, true)}</span></div>
      ) : null}
    </div>
  );
}

function RowActions({
  hook, t, onEdit, onRotate, onToggle, onDelete,
}: {
  hook: DeveloperWebhook;
  t: ReturnType<typeof useTranslations>;
  onEdit: () => void;
  onRotate: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex justify-end">
      <Dropdown
        align="end"
        mobilePopover
        menuLabel={t('detailsTitle')}
        triggerLabel={t('detailsTitle')}
        triggerClassName="h-8 w-8 justify-center rounded border border-border bg-surface text-text hover:bg-primary-soft"
        trigger={<MoreHorizontal className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />}
      >
        <DropdownItem icon={Pencil} onClick={onEdit}>{t('edit')}</DropdownItem>
        <DropdownItem icon={RefreshCw} onClick={onRotate}>{t('rotate')}</DropdownItem>
        <DropdownItem icon={hook.status === 'enabled' ? XCircle : CheckCircle2} onClick={onToggle}>{hook.status === 'enabled' ? t('disable') : t('enable')}</DropdownItem>
        <DropdownItem icon={Trash2} tone="danger" onClick={onDelete}>{t('delete')}</DropdownItem>
      </Dropdown>
    </div>
  );
}
