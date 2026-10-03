'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DeliveryPlatformMark } from '@/components/delivery/delivery-platform-mark';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  PLATFORM_COLLECTION_MODES,
  PLATFORM_REFERENCE_POLICIES,
  draftFromRow,
  platformSaveBody,
  type PlatformBranchOverride,
  type PlatformDraft,
  type PlatformManagementRow,
} from '@/lib/delivery-platform-management';
import { deliveryPlatformLabel } from '@/lib/delivery-platform-registry';

export interface PlatformBranchOption {
  id: string;
  name: string;
  is_active: boolean;
}

export function DeliveryPlatformsWorkspace({
  rows,
  branches,
  canManage,
  selectedKey,
  busy,
  loading,
  error,
  onSelect,
  onSave,
}: {
  rows: PlatformManagementRow[];
  branches: PlatformBranchOption[];
  canManage: boolean;
  selectedKey: string | null;
  busy: boolean;
  loading: boolean;
  error: string | null;
  onSelect: (key: string | null) => void;
  onSave: (profileId: string | null, body: Record<string, unknown>) => void;
}) {
  const t = useTranslations('deliveryPlatforms');
  const locale = useLocale();
  const selected = rows.find((row) => row.key === selectedKey) ?? null;

  return (
    <div className="space-y-4 pb-16 md:pb-0" data-testid="delivery-platforms-workspace">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <p className="text-sm text-muted">{t('subtitle')}</p>
        <p className="text-sm font-medium text-text">{t('notAnIntegration')}</p>
      </header>
      {error ? <p role="alert" className="text-sm text-negative">{error}</p> : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <ul className="space-y-2 md:hidden" data-testid="delivery-platforms-mobile-list">
            {rows.map((row) => (
              <li key={row.key}>
                <PlatformButton row={row} locale={locale} selected={row.key === selectedKey} statusLabel={t(`status_${row.status}`)} onSelect={onSelect} />
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded border border-border md:block" data-testid="delivery-platforms-desktop-table">
            <table className="w-full text-sm">
              <thead className="bg-surface text-muted">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t('platform')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('status')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('collectionMode')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('version')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className={`border-t border-border ${row.key === selectedKey ? 'bg-primary-soft' : ''}`}>
                    <td className="px-3 py-2">
                      <button type="button" className="min-h-11 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => onSelect(row.key)}>
                        <DeliveryPlatformMark platformKey={row.key} name={deliveryPlatformLabel(row.key, locale)} />
                      </button>
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={row.status} label={t(`status_${row.status}`)} /></td>
                    <td className="px-3 py-2">{row.profile?.collection_mode ? t(`mode_${row.profile.collection_mode}`) : '—'}</td>
                    <td className="px-3 py-2">{row.profile?.version_number ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {loading && rows.length === 0 ? <p className="mt-3 text-sm text-muted">{t('loading')}</p> : null}
        </div>
        <PlatformDetail
          key={selected?.key ?? 'closed'}
          row={selected}
          branches={branches}
          canManage={canManage}
          busy={busy}
          locale={locale}
          onClose={() => onSelect(null)}
          onSave={onSave}
        />
      </div>
    </div>
  );
}

function StatusBadge({ status, label }: { status: PlatformManagementRow['status']; label: string }) {
  const tone = status === 'active' ? 'positive' : status === 'inactive' ? 'muted' : 'neutral';
  return <Badge tone={tone}>{label}</Badge>;
}

function PlatformButton({
  row,
  locale,
  selected,
  statusLabel,
  onSelect,
}: {
  row: PlatformManagementRow;
  locale: string;
  selected: boolean;
  statusLabel: string;
  onSelect: (key: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(row.key)}
      className={`flex min-h-11 w-full items-center justify-between gap-3 rounded border border-border bg-surface p-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selected ? 'bg-primary-soft' : ''}`}
    >
      <DeliveryPlatformMark platformKey={row.key} name={deliveryPlatformLabel(row.key, locale)} />
      <StatusBadge status={row.status} label={statusLabel} />
    </button>
  );
}

function PlatformDetail({
  row,
  branches,
  canManage,
  busy,
  locale,
  onClose,
  onSave,
}: {
  row: PlatformManagementRow | null;
  branches: PlatformBranchOption[];
  canManage: boolean;
  busy: boolean;
  locale: string;
  onClose: () => void;
  onSave: (profileId: string | null, body: Record<string, unknown>) => void;
}) {
  const t = useTranslations('deliveryPlatforms');
  const [draft, setDraft] = useState<PlatformDraft | null>(row ? draftFromRow(row) : null);
  if (!row || !draft) return null;
  const name = deliveryPlatformLabel(row.key, locale, {
    name: row.profile?.display_name,
    nameEn: row.profile?.display_name_en,
  });
  const used = new Set(draft.overrides.map((override) => override.branch_id));
  const available = branches.filter((branch) => branch.is_active && !used.has(branch.id));

  function updateOverride(index: number, patch: Partial<PlatformBranchOverride>): void {
    setDraft((current) => current && ({
      ...current,
      overrides: current.overrides.map((override, item) => item === index ? { ...override, ...patch } : override),
    }));
  }

  return (
    <aside className="space-y-3 rounded border border-border bg-surface p-4" data-testid="delivery-platform-detail" aria-label={t('detailTitle')}>
      <div className="flex items-start justify-between gap-2">
        <DeliveryPlatformMark platformKey={row.key} name={name} />
        <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={onClose}>{t('close')}</Button>
      </div>
      <StatusBadge status={row.status} label={t(`status_${row.status}`)} />
      <p className="text-sm text-text">{t('configuredIsNotConnected')}</p>
      <dl className="space-y-2 text-sm">
        <div><dt className="text-muted">{t('channel')}</dt><dd>{row.profile?.sales_channel_slug || '—'}</dd></div>
        <div><dt className="text-muted">{t('version')}</dt><dd>{row.profile?.version_number ?? '—'}</dd></div>
      </dl>
      <div className="space-y-3">
        <div>
          <Label htmlFor="platform-mode">{t('collectionMode')}</Label>
          <Select id="platform-mode" disabled={!canManage} value={draft.collectionMode} onChange={(event) => setDraft({ ...draft, collectionMode: event.target.value as PlatformDraft['collectionMode'] })}>
            {PLATFORM_COLLECTION_MODES.map((mode) => <option key={mode} value={mode}>{t(`mode_${mode}`)}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="platform-reference">{t('referencePolicy')}</Label>
          <Select id="platform-reference" disabled={!canManage} value={draft.referencePolicy} onChange={(event) => setDraft({ ...draft, referencePolicy: event.target.value as PlatformDraft['referencePolicy'] })}>
            {PLATFORM_REFERENCE_POLICIES.map((policy) => <option key={policy} value={policy}>{t(`policy_${policy}`)}</option>)}
          </Select>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={draft.isActive} disabled={!canManage} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} />
          {t('enabled')}
        </label>
        <div>
          <Label htmlFor="platform-name">{t('displayName')}</Label>
          <Input id="platform-name" className="min-h-11" disabled={!canManage} value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} />
        </div>
        <div>
          <Label htmlFor="platform-name-en">{t('displayNameEn')}</Label>
          <Input id="platform-name-en" className="min-h-11" disabled={!canManage} value={draft.displayNameEn} onChange={(event) => setDraft({ ...draft, displayNameEn: event.target.value })} />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-text">{t('branchScope')}</p>
          {draft.overrides.length === 0 ? <p className="text-sm text-muted">{t('noBranchOverrides')}</p> : null}
          {draft.overrides.map((override, index) => (
            <div key={override.branch_id} className="space-y-2 rounded border border-border p-2">
              <p className="text-sm text-text">{branches.find((branch) => branch.id === override.branch_id)?.name || override.branch_id}</p>
              <Select aria-label={t('collectionMode')} disabled={!canManage} value={override.collection_mode ?? ''} onChange={(event) => updateOverride(index, { collection_mode: event.target.value || null })}>
                <option value="">{t('inherit')}</option>
                {PLATFORM_COLLECTION_MODES.map((mode) => <option key={mode} value={mode}>{t(`mode_${mode}`)}</option>)}
              </Select>
              {canManage ? <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setDraft({ ...draft, overrides: draft.overrides.filter((_, item) => item !== index) })}>{t('removeBranch')}</Button> : null}
            </div>
          ))}
          {canManage && available.length > 0 ? (
            <Select aria-label={t('addBranch')} value="" onChange={(event) => {
              if (!event.target.value) return;
              setDraft({ ...draft, overrides: [...draft.overrides, { branch_id: event.target.value, collection_mode: draft.collectionMode, external_reference_policy: draft.referencePolicy }] });
            }}>
              <option value="">{t('addBranch')}</option>
              {available.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </Select>
          ) : null}
        </div>
        {canManage ? (
          <div>
            <Label htmlFor="platform-reason">{t('changeReason')}</Label>
            <Input id="platform-reason" className="min-h-11" value={draft.changeReason} onChange={(event) => setDraft({ ...draft, changeReason: event.target.value })} />
          </div>
        ) : <p className="text-sm text-muted">{t('viewOnly')}</p>}
        {canManage ? (
          <Button type="button" className="min-h-11" disabled={busy} onClick={() => onSave(row.profile?.id ?? null, platformSaveBody(row.key, draft, row.profile === null))}>
            {row.profile === null ? t('configure') : t('save')}
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
