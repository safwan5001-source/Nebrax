'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { CircleCheck, CircleSlash, Eye, Mail, MapPin, MoreHorizontal, Pencil, Plus, ShieldAlert, Trash2, UserCheck, UserX } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { ListToolbar, PageHeader, Pagination, type PageAction, type SortOption } from '@/components/nebrax';
import { EmptyState } from '@/components/nebrax/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { useToast } from '@/components/ui/toast';
import { useScopeText } from '@/components/users/scope-language';
import { UserAccessSummarySheet } from '@/components/users/user-access-summary-sheet';
import { UserEditorSheet } from '@/components/users/user-editor-sheet';
import { api, ApiError } from '@/lib/api';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';
import { useActorScope, useCan } from '@/lib/use-can';
import {
  effectivePermissions,
  filterUsers,
  resolveRoleLabel,
  rowCapabilities,
  sortUsers,
  summarizeScope,
  type DisabledReason,
  type RoleSummary,
  type RowCapabilities,
  type ScopeOption,
  type UserListQuery,
  type UserRecord,
  type UserScopeFilter,
  type UserStatusFilter,
} from '@/modules/users/model';

const SYSTEM_ROLE_SLUGS = ['owner', 'admin', 'accountant', 'staff', 'self_service'] as const;

function filterValue(filters: ActiveFilter[], key: string): string {
  const filter = filters.find((candidate) => candidate.key === key);
  if (!filter || Array.isArray(filter.value)) return '';
  return String(filter.value).trim();
}

function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value)
    ? filter.value.every((value) => String(value).trim() === '')
    : String(filter.value).trim() === '';
}

export default function UsersPage() {
  const t = useTranslations('users');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const askConfirm = useConfirm();
  const { success, error: toastError } = useToast();

  const { viewer: actor, can, hydrated } = useCan();
  const canView = can('users.view');
  const canManage = can('users.manage');
  // كل قائمة مرجعية خلف صلاحيتها المستقلة (D-J): لا طلب يُعرف سلفاً أنه سيُرفض.
  const canListRoles = can('roles.view');
  const canListBranches = can('branches.view');
  const canListWarehouses = can('products.view');
  const canOpenEmployee = can('hr.view');

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [roles, setRoles] = useState<RoleSummary[] | null>(null);
  const [branches, setBranches] = useState<ScopeOption[] | null>(null);
  const [warehouses, setWarehouses] = useState<ScopeOption[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // المحرّر مفتوح ⇔ `editor` غير null؛ `user: null` = إضافة. `focusAccess` يفتحه عند قسم الوصول.
  const [editor, setEditor] = useState<{ user: UserRecord | null; focusAccess: boolean } | null>(null);
  /** معرّف المستخدم المعروض ملخّصه؛ الصف يُقرأ حيّاً من القائمة فيتحدّث مع إعادة التحميل. */
  const [summaryId, setSummaryId] = useState<string | null>(null);
  const editing = editor?.user ?? null;
  const [busyId, setBusyId] = useState<string | null>(null);

  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? 'newest' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api<{ data: UserRecord[] }>('/users')
      .then((response) => setUsers(response.data))
      .catch((err) => setLoadError(err instanceof ApiError && err.message ? err.message : tc('loadFailed')))
      .finally(() => setLoading(false));
  }, [tc]);

  useEffect(() => {
    if (!hydrated || !canView) return;
    load();
  }, [hydrated, canView, load]);

  // المراجع اختيارية: فشلها يُسقط الواجهة إلى العدّ/الترجمة، لا يُعطّل القائمة.
  useEffect(() => {
    if (!canView) return;
    if (canListRoles) {
      api<{ data: RoleSummary[] }>('/roles').then((r) => setRoles(r.data)).catch(() => setRoles(null));
    }
    if (canListBranches) {
      api<{ data: ScopeOption[] }>('/branches').then((r) => setBranches(r.data)).catch(() => setBranches(null));
    }
    if (canListWarehouses) {
      api<{ data: ScopeOption[] }>('/warehouses').then((r) => setWarehouses(r.data)).catch(() => setWarehouses(null));
    }
  }, [canView, canListRoles, canListBranches, canListWarehouses]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setExplorer((current) => (current.search === searchInput ? current : { ...current, search: searchInput, page: 1 }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const url = serializeExplorerState(explorer);
    router.replace(url.toString() ? `/users?${url.toString()}` : '/users', { scroll: false });
  }, [explorer, router]);

  const systemRoleNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const slug of SYSTEM_ROLE_SLUGS) names[slug] = t(`roles.${slug}`);
    return names;
  }, [t]);

  const roleText = useCallback(
    (slug: string) => {
      const label = resolveRoleLabel(slug, roles, systemRoleNames);
      return label.kind === 'name' ? label.name : t('role_custom');
    },
    [roles, systemRoleNames, t],
  );

  const scopeText = useScopeText();

  const definitions = useMemo<FilterDefinition[]>(() => {
    const list: FilterDefinition[] = [
      {
        key: 'status',
        label: t('status_label'),
        kind: 'select',
        quick: true,
        options: [
          { value: 'active', label: t('active') },
          { value: 'inactive', label: t('inactive') },
        ],
      },
    ];
    if (roles) {
      list.push({
        key: 'role',
        label: t('role'),
        kind: 'select',
        quick: true,
        options: roles.map((role) => ({ value: role.slug, label: role.name })),
      });
    }
    list.push({
      key: 'scope',
      label: t('scope_title'),
      kind: 'select',
      quick: true,
      options: [
        { value: 'all', label: t('scope_filter_all') },
        { value: 'restricted', label: t('scope_filter_restricted') },
      ],
    });
    return list;
  }, [roles, t]);

  const labelledFilters = useMemo(
    () => explorer.filters.map((filter) => ({
      ...filter,
      label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label,
    })),
    [definitions, explorer.filters],
  );

  // شريحة الفلتر تعرض اسم الخيار لا قيمته المخزَّنة (slug الدور مثلاً لا يُكشف اسماً أبداً).
  const formatFilter = useCallback(
    (filter: ActiveFilter) => {
      const raw = Array.isArray(filter.value) ? filter.value.map(String) : [String(filter.value)];
      if (filter.key === 'role') {
        // الدور يمرّ دائماً عبر مُحلّل الاسم (D-H) — حتى قبل وصول `/roles` أو بدون `roles.view`
        // (رابطٌ محفوظ بـ`?f.role=`): الاسم إن عُرف، وإلا «دور مخصَّص»، لا slug خام أبداً.
        return `${t('role')}: ${raw.map(roleText).join('، ')}`;
      }
      const definition = definitions.find((candidate) => candidate.key === filter.key);
      const shown = raw.map((value) => definition?.options?.find((option) => option.value === value)?.label ?? value);
      const label = definition?.label ?? (filter.key === 'status' ? t('status_label') : filter.key === 'scope' ? t('scope_title') : filter.label ?? filter.key);
      return `${label}: ${shown.join('، ')}`;
    },
    [definitions, roleText, t],
  );

  const query: UserListQuery = {
    search: explorer.search,
    status: filterValue(explorer.filters, 'status') as UserStatusFilter,
    role: filterValue(explorer.filters, 'role'),
    scope: filterValue(explorer.filters, 'scope') as UserScopeFilter,
  };
  const sorted = useMemo(
    () => sortUsers(filterUsers(users, query), explorer.sort ?? 'newest', locale),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, explorer.search, explorer.filters, explorer.sort, locale],
  );

  const perPage = explorer.perPage ?? 25;
  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const page = Math.min(explorer.page ?? 1, totalPages);
  const pageData = sorted.slice((page - 1) * perPage, page * perPage);

  function updateFilter(next: ActiveFilter) {
    setExplorer((current) => ({
      ...current,
      page: 1,
      filters: isEmptyFilter(next) ? removeFilter(current.filters, next.key) : replaceFilter(current.filters, next),
    }));
  }

  const linkedEmployeeIds = useMemo(
    () => users.filter((u) => u.employee_id && u.id !== editing?.id).map((u) => u.employee_id as string),
    [users, editing],
  );

  // ───────── الإجراءات: تأكيد صريح بنتائجه، ولا «نجاح» إلا بعد نجاح الخادم فعلاً ─────────

  const reasonText = (reason: DisabledReason | undefined): string | undefined =>
    reason ? t(`reason_${reason}`) : undefined;

  const run = useCallback(
    async (user: UserRecord, action: () => Promise<unknown>, doneMessage: string) => {
      setBusyId(user.id);
      try {
        await action();
        success(doneMessage);
        load();
      } catch (err) {
        toastError(err instanceof ApiError && err.message ? err.message : tc('saveFailed'));
      } finally {
        setBusyId(null);
      }
    },
    [load, success, tc, toastError],
  );

  const toggleActive = useCallback(
    async (user: UserRecord) => {
      const deactivating = user.is_active;
      const confirmed = await askConfirm(
        deactivating
          ? { title: t('confirm_deactivate_title'), message: t('confirm_deactivate', { name: user.name }), confirmLabel: t('deactivate'), tone: 'danger' }
          : { title: t('confirm_activate_title'), message: t('confirm_activate', { name: user.name }), confirmLabel: t('activate') },
      );
      if (!confirmed) return;
      await run(user, () => api(`/users/${user.id}`, { method: 'PUT', body: { is_active: !deactivating } }), t(deactivating ? 'toast_deactivated' : 'toast_activated'));
    },
    [askConfirm, run, t],
  );

  const removeUser = useCallback(
    async (user: UserRecord) => {
      const confirmed = await askConfirm({
        title: t('confirm_delete_title'),
        message: t('confirm_delete', { name: user.name }),
        confirmLabel: t('remove'),
        tone: 'danger',
      });
      if (!confirmed) return;
      await run(user, () => api(`/users/${user.id}`, { method: 'DELETE' }), tc('deleted'));
    },
    [askConfirm, run, t, tc],
  );

  const sendInvitation = useCallback(
    async (user: UserRecord) => {
      const confirmed = await askConfirm({ message: t('send_invitation_confirm', { email: user.email }) });
      if (!confirmed) return;
      await run(user, () => api(`/users/${user.id}/send-invitation`, { method: 'POST' }), t('invitation_sent'));
    },
    [askConfirm, run, t],
  );

  const openEdit = (user: UserRecord | null, focusAccess = false) => setEditor({ user, focusAccess });

  // نطاق المشاهد نفسه من `/me` (AC-UX-11): فراغ = غير مقيَّد، ولا يتطلب صفّه في القائمة. غير المعروف يُمرَّر `undefined` كما كان.
  // لا طلب إضافي لمن لا يملك التعديل (النطاق يلزم المحرّر وقدرات الصف فقط).
  const actorScope = useActorScope({ enabled: canManage }) ?? undefined;

  const capsFor = useCallback(
    (user: UserRecord): RowCapabilities =>
      rowCapabilities(
        {
          id: actor?.id ?? null,
          role: actor?.role ?? null,
          canManage,
          permissions: actor ? effectivePermissions(actor.permissions, actor.role) : undefined,
          scope: actorScope,
        },
        user,
        roles,
      ),
    [actor, actorScope, canManage, roles],
  );

  // دالة عرض لا مكوّن: مكوّنٌ معرَّف داخل الصفحة يُعاد تركيبه كل عرض فيفقد القائمة المنسدلة حالتها وتركيزها.
  const rowActions = (user: UserRecord) => {
    const caps = capsFor(user);
    const busy = busyId === user.id;
    const summaryButton = (
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('access_summary_open')}
        title={t('access_summary_open')}
        onClick={() => setSummaryId(user.id)}
      >
        <Eye className="h-4 w-4 text-muted" strokeWidth={1.7} />
      </Button>
    );
    if (!canManage) return <div className="flex items-center justify-end gap-0.5">{summaryButton}</div>;
    return (
      <div className="flex items-center justify-end gap-0.5">
        {summaryButton}
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('edit')}
          title={reasonText(caps.edit.reason)}
          disabled={!caps.edit.allowed || busy}
          onClick={() => openEdit(user)}
        >
          <Pencil className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('scope_title')}
          title={reasonText(caps.scope.reason)}
          disabled={!caps.scope.allowed || busy}
          onClick={() => openEdit(user, true)}
        >
          <MapPin className="h-4 w-4 text-muted" strokeWidth={1.7} />
        </Button>
        <Dropdown
          align="end"
          menuLabel={t('more_actions')}
          triggerLabel={t('more_actions')}
          triggerClassName="h-9 w-9 justify-center text-muted hover:bg-primary-soft hover:text-primary"
          trigger={<MoreHorizontal className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />}
        >
          {({ close }) => (
            <>
              <DropdownItem
                icon={Mail}
                disabled={!caps.invite.allowed || busy}
                title={reasonText(caps.invite.reason)}
                onClick={() => { close(); void sendInvitation(user); }}
              >
                {t('send_login_details')}
              </DropdownItem>
              <DropdownItem
                icon={user.is_active ? UserX : UserCheck}
                disabled={!caps.toggle.allowed || busy}
                title={reasonText(caps.toggle.reason)}
                onClick={() => { close(); void toggleActive(user); }}
              >
                {user.is_active ? t('deactivate') : t('activate')}
              </DropdownItem>
              <DropdownItem
                icon={Trash2}
                tone="danger"
                disabled={!caps.remove.allowed || busy}
                title={reasonText(caps.remove.reason)}
                onClick={() => { close(); void removeUser(user); }}
              >
                {t('remove')}
              </DropdownItem>
            </>
          )}
        </Dropdown>
      </div>
    );
  };

  const statusBadge = (user: UserRecord) => (
    <Badge tone={user.is_active ? 'positive' : 'muted'}>
      {user.is_active ? (
        <CircleCheck className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
      ) : (
        <CircleSlash className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
      )}
      {user.is_active ? t('active') : t('inactive')}
    </Badge>
  );

  const employeeCell = (user: UserRecord) => {
    const employee = user.employee;
    if (!employee) return <span className="text-muted">—</span>;
    const label = `${employee.employee_no ? `${employee.employee_no} — ` : ''}${employee.name}`;
    return canOpenEmployee ? (
      <Link href={`/hr/employees/${employee.id}`} className="text-primary hover:underline">
        {label}
      </Link>
    ) : (
      <span>{label}</span>
    );
  };

  const summaryUser = summaryId ? users.find((candidate) => candidate.id === summaryId) ?? null : null;

  const columns = useMemo<ColumnDef<UserRecord, unknown>[]>(
    () => [
      {
        id: 'name',
        accessorFn: (user) => user.name,
        header: t('col_user'),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-medium text-text">
              <bdi className="truncate">{row.original.name}</bdi>
              {row.original.id === actor?.id ? <Badge tone="muted">{t('you')}</Badge> : null}
            </div>
            <div className="num truncate text-xs text-muted" dir="ltr">{row.original.email}</div>
          </div>
        ),
      },
      { id: 'employee', header: t('link_employee'), accessorFn: (user) => user.employee?.name ?? '', cell: ({ row }) => employeeCell(row.original) },
      { id: 'role', header: t('role'), accessorFn: (user) => roleText(user.role), cell: ({ row }) => <Badge tone="muted">{roleText(row.original.role)}</Badge> },
      { id: 'status', header: t('status_label'), accessorFn: (user) => (user.is_active ? 1 : 0), cell: ({ row }) => statusBadge(row.original) },
      {
        id: 'branches',
        header: t('col_branches'),
        accessorFn: (user) => user.branch_ids?.length ?? 0,
        cell: ({ row }) => <span className="text-sm">{scopeText(summarizeScope(row.original.branch_ids, branches), 'branches')}</span>,
      },
      {
        id: 'warehouses',
        header: t('col_warehouses'),
        accessorFn: (user) => user.warehouse_ids?.length ?? 0,
        cell: ({ row }) => <span className="text-sm">{scopeText(summarizeScope(row.original.warehouse_ids, warehouses), 'warehouses')}</span>,
      },
      { id: 'actions', header: '', enableSorting: false, cell: ({ row }) => rowActions(row.original) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, actor, roles, branches, warehouses, canManage, canOpenEmployee, busyId, roleText, scopeText, capsFor],
  );

  const sortOptions: SortOption[] = [
    { value: 'newest', label: t('sort_newest') },
    { value: 'name', label: t('sort_name') },
    { value: '-name', label: t('sort_name_desc') },
  ];

  const headerActions: PageAction[] = canManage
    ? [{ key: 'create', label: t('add'), icon: Plus, onClick: () => openEdit(null), variant: 'primary' }]
    : [];

  if (!hydrated) return null;

  if (!canView) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('title')} />
        <EmptyState
          icon={ShieldAlert}
          title={t('no_access_title')}
          description={t('no_access_description')}
        />
      </div>
    );
  }

  const filtersActive = explorer.filters.length > 0 || explorer.search.trim() !== '';

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('description')} actions={headerActions} />

      {!canManage ? (
        <p role="note" className="rounded border border-border bg-surface px-3 py-2 text-sm text-muted">
          {t('read_only_note')}
        </p>
      ) : null}

      <ListToolbar
        search={searchInput}
        searchPlaceholder={t('search')}
        searchLabel={t('title')}
        onSearchChange={setSearchInput}
        definitions={definitions}
        filters={labelledFilters}
        onFilterChange={updateFilter}
        onRemoveFilter={(key) => setExplorer((current) => ({ ...current, page: 1, filters: removeFilter(current.filters, key) }))}
        onClearFilters={() => setExplorer((current) => ({ ...current, page: 1, filters: [] }))}
        formatFilter={formatFilter}
        sort={{
          value: explorer.sort ?? 'newest',
          onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })),
          options: sortOptions,
        }}
        resultCount={loadError ? undefined : sorted.length}
        totalCount={loadError ? undefined : users.length}
      />

      <DataTable
        columns={columns}
        data={pageData}
        loading={loading}
        error={loadError}
        onRetry={load}
        retryLabel={tc('retry')}
        showToolbar={false}
        stickyHeader
        serverSort={{
          value: explorer.sort === 'newest' ? '' : explorer.sort,
          onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value || 'newest' })),
          columns: ['name'],
        }}
        emptyLabel={filtersActive ? t('no_results') : t('empty_title')}
        emptyDescription={filtersActive ? t('no_results_hint') : t('empty_hint')}
        mobileRecord={(user) => ({
          title: user.name,
          subtitle: <span className="num" dir="ltr">{user.email}</span>,
          caption: `${roleText(user.role)}${user.employee ? ` · ${user.employee.name}` : ''}`,
          status: statusBadge(user),
          meta: `${scopeText(summarizeScope(user.branch_ids, branches), 'branches')} · ${scopeText(summarizeScope(user.warehouse_ids, warehouses), 'warehouses')}`,
          actions: rowActions(user),
        })}
      />

      {!loadError ? (
        <Pagination
          page={page}
          lastPage={totalPages}
          perPage={perPage}
          total={sorted.length}
          disabled={loading}
          onPageChange={(next) => setExplorer((current) => ({ ...current, page: next }))}
          onPerPageChange={(next) => setExplorer((current) => ({ ...current, page: 1, perPage: next }))}
        />
      ) : null}

      {summaryUser ? (
        <UserAccessSummarySheet
          key={summaryUser.id}
          user={summaryUser}
          onClose={() => setSummaryId(null)}
          onEdit={
            canManage && capsFor(summaryUser).edit.allowed
              ? () => {
                  setSummaryId(null);
                  openEdit(summaryUser);
                }
              : undefined
          }
          roles={roles}
          branches={branches}
          warehouses={warehouses}
          isSelf={summaryUser.id === actor?.id}
        />
      ) : null}

      {editor ? (
        <UserEditorSheet
          key={editor.user?.id ?? 'new'}
          open
          onClose={() => setEditor(null)}
          onSaved={load}
          user={editor.user}
          linkedEmployeeIds={linkedEmployeeIds}
          actorScope={actorScope}
          focusAccess={editor.focusAccess}
        />
      ) : null}
    </div>
  );
}
