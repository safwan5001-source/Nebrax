'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ListOrdered, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { EmptyState, ErrorState, LoadingState } from '@/components/nebrax';
import {
  createCollection,
  deleteCollection,
  loadCollectionMembers,
  loadCollections,
  moveItem,
  replaceCollectionMembers,
  updateCollection,
  type Collection,
  type CollectionMember,
  type CollectionStatus,
} from './client';
import { ConfirmDialog, FieldsDialog, writeFailureMessage, type T } from './common';
import { ProductPicker } from './product-picker';

type DialogState =
  | { kind: 'create' }
  | { kind: 'edit'; collection: Collection }
  | { kind: 'delete'; collection: Collection }
  | { kind: 'members'; collection: Collection };

/** تبويب «المجموعات»: عنوان/حالة + عضوية مرتّبة يدوياً (ADR-14 §2.3). */
export function CollectionsPanel({ t, canManage }: { t: T; canManage: boolean }) {
  const { success } = useToast();
  const [collections, setCollections] = useState<Collection[] | null | 'error'>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const load = useCallback(async () => {
    setCollections((await loadCollections()) ?? 'error');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const statusOptions = [
    { value: 'draft', label: t('merchStatusDraft') },
    { value: 'active', label: t('merchStatusActive') },
  ];

  if (collections === null) return <LoadingState variant="table" rows={3} label={t('merchLoading')} />;
  if (collections === 'error') return <ErrorState message={t('merchLoadFailed')} onRetry={() => void load()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-muted">{t('merchCollectionsIntro')}</p>
        {canManage ? (
          <Button type="button" size="sm" onClick={() => setDialog({ kind: 'create' })}>
            <Plus className="h-4 w-4" aria-hidden="true" /> {t('merchCollectionCreate')}
          </Button>
        ) : null}
      </div>

      {collections.length === 0 ? (
        <EmptyState icon={ListOrdered} title={t('merchCollectionsEmptyTitle')} description={t('merchCollectionsEmptyDescription')} />
      ) : (
        <ul className="divide-y divide-border rounded border border-border bg-surface">
          {collections.map((collection) => (
            <li key={collection.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-text">{collection.title}</span>
                  {collection.titleEn ? <span className="text-xs text-muted" dir="ltr">{collection.titleEn}</span> : null}
                  <Badge tone={collection.status === 'active' ? 'positive' : 'muted'}>
                    {collection.status === 'active' ? t('merchStatusActive') : t('merchStatusDraft')}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  <code dir="ltr">{collection.slug}</code> · {collection.memberCount} {t('merchProductsSuffix')}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => setDialog({ kind: 'members', collection })}>
                  {canManage ? t('merchManageProducts') : t('merchViewProducts')}
                </Button>
                {canManage ? (
                  <>
                  <Button type="button" variant="ghost" size="icon" aria-label={`${t('merchEdit')} ${collection.title}`} onClick={() => setDialog({ kind: 'edit', collection })}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={`${t('merchDelete')} ${collection.title}`} onClick={() => setDialog({ kind: 'delete', collection })}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === 'create' || dialog?.kind === 'edit' ? (
        <FieldsDialog
          t={t}
          title={dialog.kind === 'create' ? t('merchCollectionCreate') : t('merchEdit')}
          submitLabel={t('merchSave')}
          fields={[
            { id: 'title', label: t('merchCollectionTitle'), required: true, value: dialog.kind === 'edit' ? dialog.collection.title : '' },
            { id: 'titleEn', label: t('merchCollectionTitleEn'), dir: 'ltr', value: dialog.kind === 'edit' ? dialog.collection.titleEn ?? '' : '' },
            { id: 'description', label: t('merchCollectionDescription'), value: dialog.kind === 'edit' ? dialog.collection.description ?? '' : '' },
            { id: 'status', label: t('merchCollectionStatus'), value: dialog.kind === 'edit' ? dialog.collection.status : 'draft', options: statusOptions },
          ]}
          onClose={() => setDialog(null)}
          onSubmit={async (v) => {
            const draft = {
              title: v.title.trim(),
              titleEn: v.titleEn?.trim() ?? '',
              description: v.description?.trim() ?? '',
              status: (v.status === 'active' ? 'active' : 'draft') as CollectionStatus,
            };
            const result = dialog.kind === 'create' ? await createCollection(draft) : await updateCollection(dialog.collection.id, draft);
            if (!result.ok) return writeFailureMessage(result, t);
            setDialog(null);
            await load();
            return null;
          }}
        />
      ) : null}

      {dialog?.kind === 'delete' ? (
        <ConfirmDialog
          t={t}
          title={`${t('merchDelete')} — ${dialog.collection.title}`}
          message={t('merchConfirmDeleteCollection')}
          confirmLabel={t('merchDelete')}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            const result = await deleteCollection(dialog.collection.id);
            if (!result.ok) return writeFailureMessage(result, t);
            setDialog(null);
            await load();
            return null;
          }}
        />
      ) : null}

      {dialog?.kind === 'members' ? (
        <MembersDialog
          t={t}
          canManage={canManage}
          collection={dialog.collection}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await load();
            success(t('merchMembersSave'));
          }}
        />
      ) : null}
    </div>
  );
}

function MembersDialog({
  t,
  canManage,
  collection,
  onClose,
  onSaved,
}: {
  t: T;
  canManage: boolean;
  collection: Collection;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [members, setMembers] = useState<CollectionMember[] | null | 'error'>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadCollectionMembers(collection.id).then((rows) => {
      if (!cancelled) setMembers(rows ?? 'error');
    });
    return () => {
      cancelled = true;
    };
  }, [collection.id]);

  const rows = Array.isArray(members) ? members : [];

  async function save() {
    if (saving || !canManage) return;
    setSaving(true);
    setError(null);
    const result = await replaceCollectionMembers(collection.id, rows.map((m) => m.productId));
    setSaving(false);
    if (!result.ok) {
      setError(writeFailureMessage(result, t));
      return;
    }
    await onSaved();
  }

  return (
    <Dialog open onClose={saving ? () => undefined : onClose} title={`${t('merchMembersTitle')} — ${collection.title}`} className="max-w-xl">
      {members === null ? <LoadingState variant="table" rows={3} label={t('merchLoading')} surface="bare" /> : null}
      {members === 'error' ? <ErrorState message={t('merchLoadFailed')} surface="bare" /> : null}
      {Array.isArray(members) ? (
        <div className="space-y-4">
          {canManage ? (
          <ProductPicker
            t={t}
            idPrefix="merch-members"
            actionLabel={t('merchAddProduct')}
            excludeIds={rows.map((m) => m.productId)}
            onPick={(product) =>
              setMembers((current) =>
                Array.isArray(current)
                  ? [...current, { productId: product.id, name: product.name, nameEn: null, sku: product.sku, isActive: true, position: current.length }]
                  : current,
              )
            }
          />
          ) : null}

          {rows.length === 0 ? (
            <p className="text-sm text-muted">{t('merchMembersEmpty')}</p>
          ) : (
            <ol className="divide-y divide-border rounded border border-border">
              {rows.map((member, index) => (
                <li key={member.productId} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 truncate text-sm text-text">
                    <span className="me-2 text-xs text-muted">{index + 1}</span>
                    {member.name}
                    {!member.isActive ? <Badge tone="muted" className="ms-2">{t('merchInactive')}</Badge> : null}
                  </span>
                  {canManage ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <Button type="button" variant="ghost" size="icon" disabled={index === 0} aria-label={`${t('merchMoveUp')}: ${member.name}`} onClick={() => setMembers(moveItem(rows, index, -1))}>
                      <ArrowUp className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" disabled={index === rows.length - 1} aria-label={`${t('merchMoveDown')}: ${member.name}`} onClick={() => setMembers(moveItem(rows, index, 1))}>
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={`${t('merchRemove')}: ${member.name}`} onClick={() => setMembers(rows.filter((m) => m.productId !== member.productId))}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}

          {error ? <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              {canManage ? t('merchCancel') : t('merchClose')}
            </Button>
            {canManage ? (
              <Button type="button" onClick={() => void save()} disabled={saving}>
                {t('merchMembersSave')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
