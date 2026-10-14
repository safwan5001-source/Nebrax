'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Copy, Minus, Pencil, Plus, Search, ShieldAlert, Trash2 } from 'lucide-react';
import { PageHeader, type PageAction } from '@/components/nebrax';
import { EmptyState, ErrorState, LoadingState } from '@/components/nebrax/states';
import { RoleEditorSheet } from '@/components/roles/role-editor-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { displayLocale } from '@/lib/formatting';
import { useCan } from '@/lib/use-can';
import { cn } from '@/lib/utils';
import { cloneSeed, type CloneSeed } from '@/modules/roles/editor';
import {
  filterCatalog,
  filterRoles,
  grantedKeys,
  groupCatalog,
  moduleLabel,
  permissionLabel,
  roleCounts,
  type CatalogLabels,
  type RoleRecord,
} from '@/modules/roles/catalog';
import { coversPermissions, effectivePermissions } from '@/modules/users/model';

type RoleReason = 'owner_protected' | 'role_above_you' | 'delete_system' | 'delete_has_users';

export default function RolesPage() {
  const t = useTranslations('rolesPage');
  const th = useTranslations('hr');
  const tc = useTranslations('common');
  const locale = displayLocale(useLocale());
  const askConfirm = useConfirm();
  const { success, error: toastError } = useToast();
  const num = (n: number) => n.toLocaleString(locale);

  const { viewer: actor, can, hydrated } = useCan();
  const canView = can('roles.view');
  const canManage = can('roles.manage');
  const mine = useMemo(() => effectivePermissions(actor?.permissions, actor?.role), [actor]);

  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roleQuery, setRoleQuery] = useState('');
  const [permQuery, setPermQuery] = useState('');
  const [grantedOnly, setGrantedOnly] = useState(false);
  // `seed` + `source` = نسخ دورٍ (إنشاء مبذور)؛ `role` = تعديل؛ كلاهما فارغ = إنشاء جديد.
  const [editor, setEditor] = useState<{ role: RoleRecord | null; seed?: CloneSeed; source?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback((selectId?: string) => {
    setLoading(true);
    setLoadError(null);
    api<{ data: RoleRecord[]; meta?: { permissions?: string[] } }>('/roles')
      .then((response) => {
        setRoles(response.data);
        setCatalog(response.meta?.permissions ?? []);
        // بعد الحفظ نُحدِّد الدور المحفوظ (مفيد للدور الجديد)؛ وإلا يبقى التحديد كما هو.
        if (selectId && response.data.some((role) => role.id === selectId)) setSelectedId(selectId);
      })
      .catch((err) => setLoadError(err instanceof ApiError && err.message ? err.message : tc('loadFailed')))
      .finally(() => setLoading(false));
  }, [tc]);

  useEffect(() => {
    if (!hydrated || !canView) return;
    load();
  }, [hydrated, canView, load]);

  // التحديد يبقى على الدور نفسه بعد إعادة التحميل؛ وإن اختفى (حُذف) أو لم يُحدَّد شيء فأول دور.
  useEffect(() => {
    if (roles.length === 0) return;
    setSelectedId((current) => (current && roles.some((role) => role.id === current) ? current : roles[0].id));
  }, [roles]);

  const labels = useMemo<CatalogLabels>(
    () => ({
      modules: th.raw('perm_modules') as Record<string, string>,
      actions: th.raw('perm_actions') as Record<string, string>,
      areas: th.raw('perm_areas') as Record<string, string>,
    }),
    [th],
  );
  const groups = useMemo(() => groupCatalog(catalog), [catalog]);
  const selected = roles.find((role) => role.id === selectedId) ?? null;
  const granted = useMemo(() => (selected ? grantedKeys(selected, catalog) : new Set<string>()), [selected, catalog]);
  const visibleGroups = useMemo(
    () => filterCatalog(groups, { query: permQuery, grantedOnly }, granted, labels),
    [groups, permQuery, grantedOnly, granted, labels],
  );
  const visibleRoles = useMemo(() => filterRoles(roles, roleQuery), [roles, roleQuery]);

  // عرضٌ لا أمان: الخادم هو الذي يرفض. نُعطّل ما يُعرف سلفاً أنه سيُرفض ونذكر السبب.
  const editReason = (role: RoleRecord): RoleReason | undefined => {
    if (role.is_owner) return 'owner_protected';
    if (!coversPermissions(mine, role.permissions)) return 'role_above_you';
    return undefined;
  };
  const deleteReason = (role: RoleRecord): RoleReason | undefined => {
    const edit = editReason(role);
    if (edit) return edit;
    if (role.is_system) return 'delete_system';
    if (role.users_count > 0) return 'delete_has_users';
    return undefined;
  };

  // النسخ على جانب العميل فقط: نقرأ من الدور المصدر ولا نعدّله، والحفظ لاحقاً POST عادي بالاسم والصلاحيات وحدهما.
  function duplicate(role: RoleRecord) {
    const seed = cloneSeed(role, catalog, mine, t('copy_name', { name: role.name }));
    setEditor({ role: null, seed, source: role.name });
  }

  async function remove(role: RoleRecord) {
    const confirmed = await askConfirm({
      title: t('confirm_delete_title'),
      message: t('confirm_delete', { name: role.name }),
      confirmLabel: t('delete'),
      tone: 'danger',
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await api(`/roles/${role.id}`, { method: 'DELETE' });
      success(tc('deleted'));
      load();
    } catch (err) {
      // رفض الخادم يُعرض كما هو؛ لا «نجاح» كاذب.
      toastError(err instanceof ApiError && err.message ? err.message : tc('saveFailed'));
    } finally {
      setDeleting(false);
    }
  }

  if (!hydrated) return null;

  if (!canView) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('title')} />
        <EmptyState icon={ShieldAlert} title={t('no_access_title')} description={t('no_access_description')} />
      </div>
    );
  }

  const headerActions: PageAction[] = canManage
    ? [{ key: 'create', label: t('new_role'), icon: Plus, onClick: () => setEditor({ role: null }), variant: 'primary' }]
    : [];

  const counts = selected ? roleCounts(selected, catalog) : null;
  const edit = selected ? editReason(selected) : undefined;
  const del = selected ? deleteReason(selected) : undefined;

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('description')} actions={headerActions} />

      {!canManage ? (
        <p role="note" className="rounded border border-border bg-surface px-3 py-2 text-sm text-muted">
          {t('read_only_note')}
        </p>
      ) : null}

      {loading && roles.length === 0 ? (
        <LoadingState variant="table" rows={8} />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={() => load()} />
      ) : roles.length === 0 ? (
        <EmptyState
          title={t('no_roles_title')}
          description={t('no_roles_hint')}
          action={canManage ? <Button onClick={() => setEditor({ role: null })}>{t('new_role')}</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {/* الشريط: قائمة على سطح المكتب، ومحدِّد مضغوط على الجوال/اللوحي (§4.3). */}
          <div className="lg:hidden">
            <label htmlFor="role-select" className="mb-1 block text-xs text-muted">{t('rail_label')}</label>
            <Select id="role-select" value={selectedId ?? ''} onChange={(e) => setSelectedId(e.target.value)} aria-label={t('select_role')}>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </Select>
          </div>

          <nav aria-label={t('rail_label')} className="hidden space-y-2 lg:block">
            <div className="relative">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" strokeWidth={1.7} aria-hidden="true" />
              <Input
                value={roleQuery}
                onChange={(e) => setRoleQuery(e.target.value)}
                placeholder={t('search_roles')}
                aria-label={t('search_roles')}
                className="ps-8"
              />
            </div>
            <ul className="space-y-1">
              {visibleRoles.length === 0 ? (
                <li className="px-2 py-3 text-sm text-muted">{t('no_roles_match')}</li>
              ) : (
                visibleRoles.map((role) => {
                  const c = roleCounts(role, catalog);
                  const active = role.id === selectedId;
                  return (
                    <li key={role.id}>
                      <button
                        type="button"
                        aria-current={active ? 'true' : undefined}
                        onClick={() => setSelectedId(role.id)}
                        className={cn(
                          'w-full rounded border px-3 py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                          active ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:bg-background',
                        )}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-text">{role.name}</span>
                          {role.is_system ? <Badge tone="muted">{t('kind_system')}</Badge> : null}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {c.full ? t('full_access') : t('perms_summary', { granted: num(c.granted), total: num(c.total) })}
                          {' · '}
                          {t('users_summary', { n: role.users_count, count: num(role.users_count) })}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </nav>

          {selected && counts ? (
            <section aria-label={selected.name} className="min-w-0 space-y-4 rounded border border-border bg-surface p-4">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-semibold text-text">{selected.name}</h2>
                    <Badge tone="muted">{selected.is_system ? t('kind_system') : t('kind_custom')}</Badge>
                    {counts.full ? <Badge tone="neutral">{t('full_access')}</Badge> : null}
                  </div>
                  <p className="text-sm text-muted">
                    {counts.full ? t('full_access') : t('perms_summary', { granted: num(counts.granted), total: num(counts.total) })}
                    {' · '}
                    {selected.users_count === 0
                      ? t('no_users_assigned')
                      : t('users_summary', { n: selected.users_count, count: num(selected.users_count) })}
                  </p>
                </div>

                {canManage ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={Boolean(edit)}
                      title={edit ? t(`reason_${edit}`) : undefined}
                      onClick={() => setEditor({ role: selected })}
                    >
                      <Pencil className="h-4 w-4" strokeWidth={1.7} />
                      {t('edit')}
                    </Button>
                    <Button variant="outline" onClick={() => duplicate(selected)}>
                      <Copy className="h-4 w-4" strokeWidth={1.7} />
                      {t('duplicate')}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={Boolean(del) || deleting}
                      title={del ? t(`reason_${del}`) : undefined}
                      onClick={() => remove(selected)}
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                      {t('delete')}
                    </Button>
                  </div>
                ) : null}
              </header>

              {selected.is_owner ? (
                <p className="rounded bg-primary-soft px-3 py-2 text-xs text-primary">{t('owner_note')}</p>
              ) : selected.is_system ? (
                <p className="rounded border border-border px-3 py-2 text-xs text-muted">{t('system_note')}</p>
              ) : null}
              {counts.full && !selected.is_owner ? (
                <p className="rounded border border-border px-3 py-2 text-xs text-muted">{t('full_access_note')}</p>
              ) : null}
              {canManage && (edit || del) ? (
                <p className="text-xs text-muted">{t(`reason_${(edit ?? del) as RoleReason}`)}</p>
              ) : null}

              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-sm font-semibold text-text">{t('catalogue_title')}</h3>
                  <div className="relative min-w-[12rem] flex-1">
                    <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" strokeWidth={1.7} aria-hidden="true" />
                    <Input
                      value={permQuery}
                      onChange={(e) => setPermQuery(e.target.value)}
                      placeholder={t('catalogue_search')}
                      aria-label={t('catalogue_search')}
                      className="h-8 ps-8 text-xs"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted" htmlFor="granted-only">
                    <Switch id="granted-only" checked={grantedOnly} onCheckedChange={setGrantedOnly} aria-label={t('granted_only')} />
                    {t('granted_only')}
                  </label>
                </div>

                {visibleGroups.length === 0 ? (
                  <EmptyState surface="bare" title={t('no_match')} description={t('no_match_hint')} className="py-8" />
                ) : (
                  <div className="space-y-4">
                    {visibleGroups.map((group) => {
                      const total = groups.find((g) => g.module === group.module)?.entries.length ?? group.entries.length;
                      const have = (groups.find((g) => g.module === group.module)?.entries ?? []).filter((e) => granted.has(e.key)).length;
                      return (
                        <section key={group.module} aria-label={moduleLabel(group.module, labels)}>
                          <h4 className="mb-1 flex items-center justify-between border-b border-border pb-1 text-sm font-medium text-text">
                            <span>{moduleLabel(group.module, labels)}</span>
                            <span className="num text-xs font-normal text-muted">{t('group_count', { granted: num(have), total: num(total) })}</span>
                          </h4>
                          <ul>
                            {group.entries.map((entry) => {
                              const has = granted.has(entry.key);
                              return (
                                <li key={entry.key} className="flex items-center gap-3 py-1.5 text-sm">
                                  {has ? (
                                    <Check className="h-4 w-4 shrink-0 text-positive" strokeWidth={2} aria-hidden="true" />
                                  ) : (
                                    <Minus className="h-4 w-4 shrink-0 text-muted opacity-60" strokeWidth={2} aria-hidden="true" />
                                  )}
                                  <span className={cn('min-w-0 flex-1', has ? 'text-text' : 'text-muted')}>{permissionLabel(entry, labels)}</span>
                                  <span className="num hidden shrink-0 text-xs text-muted sm:inline" dir="ltr" title={t('exact_key')}>{entry.key}</span>
                                  <span className={cn('shrink-0 text-xs', has ? 'text-positive' : 'text-muted')}>{has ? t('granted') : t('not_granted')}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </section>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          ) : null}
        </div>
      )}

      {editor ? (
        <RoleEditorSheet
          key={editor.role?.id ?? (editor.seed ? `clone-${editor.source}` : 'new')}
          open
          onClose={() => setEditor(null)}
          onSaved={(savedId) => load(savedId)}
          role={editor.role}
          catalog={catalog}
          labels={labels}
          actorPermissions={mine}
          seed={editor.seed}
          sourceName={editor.source}
        />
      ) : null}
    </div>
  );
}
