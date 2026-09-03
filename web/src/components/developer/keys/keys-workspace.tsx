'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { KeyRound, Plus, Trash2, Ban } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader, type PageAction } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { SecretRevealDialog } from '@/components/developer/secret-reveal';
import { ConfirmDialog } from '@/components/developer/confirm-dialog';
import { KeyFormDialog } from '@/components/developer/keys/key-form-dialog';
import {
  deactivateApiClient, listApiClients, revokeApiKey,
  type DeveloperApiClient, type DeveloperApiKey, type IssuedKey,
} from '@/lib/developer';
import { formatDate, formatDateTime } from '@/lib/formatting';

export function KeysWorkspace({ canManage }: { canManage: boolean }) {
  const t = useTranslations('developer.keys');
  const tsec = useTranslations('developer.secret');
  const { success, error: toastError } = useToast();
  const locale = useLocale();
  // التنسيق عبر المنسّق المركزي (لا Intl مباشر — حارس صيغة التاريخ)؛ null ⇒ null
  // كي يعمل السقوط `?? t('neverUsed')`.
  const when = useCallback(
    (iso: string | null, withTime = false) => (iso ? (withTime ? formatDateTime(iso, locale) : formatDate(iso, locale)) : null),
    [locale],
  );

  const [clients, setClients] = useState<DeveloperApiClient[] | null>(null);
  const [error, setError] = useState(false);

  const [form, setForm] = useState<{ mode: 'create' | 'issue'; clientId?: string; clientName?: string } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<{ clientId: string; key: DeveloperApiKey } | null>(null);
  const [deactivate, setDeactivate] = useState<DeveloperApiClient | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      setClients(await listApiClients());
    } catch {
      setError(true);
      setClients(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onIssued = (result: IssuedKey) => {
    setForm(null);
    setSecret(result.secret); // لحظيّ فقط — يُمسح عند إغلاق حوار العرض
    success(form?.mode === 'issue' ? t('issued') : t('created'));
    void load();
  };

  async function confirmRevoke() {
    if (!revoke) return;
    setBusy(true);
    try {
      await revokeApiKey(revoke.clientId, revoke.key.id);
      success(t('revoked'));
      setRevoke(null);
      await load();
    } catch {
      toastError(t('revokeError'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeactivate() {
    if (!deactivate) return;
    setBusy(true);
    try {
      await deactivateApiClient(deactivate.id);
      success(t('deactivated'));
      setDeactivate(null);
      await load();
    } catch {
      toastError(t('deactivateError'));
    } finally {
      setBusy(false);
    }
  }

  const actions: PageAction[] = canManage
    ? [{ key: 'create', label: t('create'), icon: Plus, onClick: () => setForm({ mode: 'create' }) }]
    : [];

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} description={t('description')} actions={actions} />

      {clients === null && !error ? <LoadingState rows={4} /> : null}
      {error ? <ErrorState message={t('loadError')} onRetry={() => void load()} /> : null}

      {clients !== null && clients.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={t('empty')}
          description={t('emptyHint')}
          action={canManage ? <Button type="button" onClick={() => setForm({ mode: 'create' })}><Plus className="h-4 w-4" strokeWidth={1.8} />{t('create')}</Button> : undefined}
        />
      ) : null}

      {clients?.map((client) => (
        <section key={client.id} className="overflow-hidden rounded border border-border bg-surface">
          <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-text">{client.name}</span>
                <Badge tone={client.is_active ? 'positive' : 'muted'}>{client.is_active ? t('active') : t('inactive')}</Badge>
              </div>
              <div className="mt-0.5 text-xs text-muted">{when(client.created_at)}</div>
            </div>
            {canManage ? (
              <div className="flex items-center gap-2">
                {client.is_active ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setForm({ mode: 'issue', clientId: client.id, clientName: client.name })}>
                    <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />{t('issueAnother')}
                  </Button>
                ) : null}
                {client.is_active ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setDeactivate(client)} title={t('deactivate')} aria-label={t('deactivate')}>
                    <Ban className="h-4 w-4 text-negative" strokeWidth={1.7} />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </header>

          {client.keys.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted">{t('noKeys')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {client.keys.map((key) => (
                <li key={key.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-text">{key.name || t('keyName')}</span>
                      <code dir="ltr" className="font-mono text-xs text-muted">#{key.id}</code>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {key.scopes.map((scope) => (
                        <Badge key={scope} tone="muted"><code dir="ltr" className="font-mono text-[11px]">{scope}</code></Badge>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted">
                      <span>{t('lastUsed')}: {when(key.last_used_at, true) ?? t('neverUsed')}</span>
                      <span>{t('expires')}: {when(key.expires_at) ?? t('noExpiry')}</span>
                    </div>
                  </div>
                  {canManage ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setRevoke({ clientId: client.id, key })} className="self-start text-negative">
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />{t('revoke')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {/* الحوارات */}
      {form ? (
        <KeyFormDialog
          open
          mode={form.mode}
          clientId={form.clientId}
          clientName={form.clientName}
          onClose={() => setForm(null)}
          onIssued={onIssued}
        />
      ) : null}

      {secret !== null ? (
        <SecretRevealDialog
          open
          title={tsec('keyTitle')}
          secret={secret}
          onClose={() => setSecret(null)}
        />
      ) : null}

      {revoke ? (
        <ConfirmDialog
          open
          title={t('revokeTitle')}
          message={t('revokeConfirm')}
          detail={t('revokeKeyLabel', { name: revoke.key.name || `#${revoke.key.id}` })}
          confirmLabel={t('revoke')}
          busy={busy}
          onClose={() => setRevoke(null)}
          onConfirm={() => void confirmRevoke()}
        />
      ) : null}

      {deactivate ? (
        <ConfirmDialog
          open
          title={t('deactivateTitle')}
          message={t('deactivateConfirm')}
          detail={deactivate.name}
          confirmLabel={t('deactivate')}
          busy={busy}
          onClose={() => setDeactivate(null)}
          onConfirm={() => void confirmDeactivate()}
        />
      ) : null}
    </div>
  );
}
