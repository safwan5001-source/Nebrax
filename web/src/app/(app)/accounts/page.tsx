'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  Ellipsis,
  FileText,
  FolderTree,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { AccountDialog, type ManagedAccount } from '@/components/accounts/account-dialog';
import {
  ancestorIds,
  buildAccountTree,
  searchAccounts,
  type AccountTreeNode,
  type WorkspaceAccount,
} from '@/components/accounts/account-workspace';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError, hasApiStatus } from '@/lib/api';
import { useBranches } from '@/lib/branch';
import { currentUser } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { formatRiyal, isNegative } from '@/lib/money';

const INITIAL_CHILD_LIMIT = 200;

function hasPermission(permission: string): boolean {
  const user = currentUser();
  if (!user) return false;
  if (['owner', 'admin'].includes(user.role)) return true;
  return user.permissions?.includes('*') || user.permissions?.includes(permission) || false;
}

function accountLabel(account: Pick<WorkspaceAccount, 'name' | 'name_en'>, locale: string): string {
  return locale.toLowerCase().startsWith('en') && account.name_en ? account.name_en : account.name;
}

function accountTone(account: WorkspaceAccount): 'positive' | 'warning' | 'neutral' {
  return account.is_active ? (account.is_group ? 'neutral' : 'positive') : 'warning';
}

export default function AccountsPage() {
  const t = useTranslations('accounts');
  const locale = useLocale();
  const canManageAccounts = hasPermission('accounts.manage');
  const canViewLedger = hasPermission('reports.view');
  const { branches, loading: branchesLoading } = useBranches();
  const [accounts, setAccounts] = useState<WorkspaceAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [branchId, setBranchId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [visibleChildren, setVisibleChildren] = useState<Record<string, number>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedAccount | null>(null);
  const [dialogParent, setDialogParent] = useState<ManagedAccount | null>(null);

  const load = useCallback(() => {
    setAccounts(null);
    setLoadError(null);
    const suffix = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : '';
    api<{ data: WorkspaceAccount[] }>(`/accounts/workspace${suffix}`)
      .then((response) => setAccounts(response.data))
      .catch((reason) => {
        const message = hasApiStatus(reason, 403)
          ? t('permissionDenied')
          : reason instanceof ApiError ? reason.message : t('loadFailed');
        setLoadError(message);
        setAccounts([]);
      });
  }, [branchId, t]);

  useEffect(() => load(), [load]);

  const tree = useMemo(() => buildAccountTree(accounts ?? []), [accounts]);
  const selected = selectedId ? tree.byId.get(selectedId) ?? null : null;
  const results = useMemo(() => searchAccounts(accounts ?? [], query), [accounts, query]);

  useEffect(() => {
    if (!accounts?.length) {
      setSelectedId(null);
      return;
    }
    setSelectedId((current) => current && tree.byId.has(current) ? current : tree.roots[0]?.id ?? null);
  }, [accounts, tree]);

  function selectAccount(account: WorkspaceAccount) {
    setSelectedId(account.id);
    setExpanded((current) => {
      const next = new Set(current);
      for (const ancestorId of ancestorIds(account)) next.add(ancestorId);
      return next;
    });
  }

  function toggleAccount(account: AccountTreeNode) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(account.id)) next.delete(account.id);
      else next.add(account.id);
      return next;
    });
  }

  function openCreate(parent: WorkspaceAccount | null = null) {
    setEditing(null);
    setDialogParent(parent);
    setDialogOpen(true);
  }

  function openEdit(account: WorkspaceAccount) {
    setDialogParent(null);
    setEditing(account);
    setDialogOpen(true);
  }

  const mobileNodes = selected ? selected.children : tree.roots;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FolderTree className="h-5 w-5 text-primary" strokeWidth={1.7} aria-hidden="true" />
            <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
          </div>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
            <label className="sr-only" htmlFor="account-branch">{t('branchBalance')}</label>
            <Select id="account-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)} disabled={branchesLoading} className="sm:w-52">
              <option value="">{t('allBranches')}</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} — {branch.name}</option>)}
            </Select>
            <div className="relative sm:w-64">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" strokeWidth={1.7} aria-hidden="true" />
              <Input
                id="accounts-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('search')}
                className="ps-9"
              />
            </div>
          </div>
          {canManageAccounts && <Button onClick={() => openCreate()}><Plus className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />{t('add')}</Button>}
        </div>
      </div>

      {query.trim() && accounts !== null && (
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">{t('searchResults')}</CardTitle></CardHeader>
          <CardContent className="space-y-1 pb-3">
            {results.length === 0 ? <p className="py-4 text-center text-sm text-muted">{t('noSearchResults')}</p> : results.slice(0, INITIAL_CHILD_LIMIT).map((account) => (
              <button key={account.id} type="button" onClick={() => selectAccount(account)} className="block w-full rounded px-3 py-2 text-start hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <span className="flex items-center justify-between gap-3"><span className="min-w-0 truncate font-medium text-text">{accountLabel(account, locale)}</span><span className="num shrink-0 text-xs text-muted">{account.code}</span></span>
                <span className="mt-1 block truncate text-xs text-muted">{account.path.map((item) => accountLabel(tree.byId.get(item.id) ?? account, locale)).join(' ← ')}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {accounts === null ? <WorkspaceSkeleton /> : loadError ? (
        <Card><CardContent className="flex flex-col items-center gap-3 py-12 text-center"><p className="text-sm text-muted">{loadError}</p><Button size="sm" variant="outline" onClick={load}>{t('retry')}</Button></CardContent></Card>
      ) : accounts.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-3 py-12 text-center"><p className="text-sm text-muted">{t('empty')}</p>{canManageAccounts && <Button size="sm" onClick={() => openCreate()}><Plus className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />{t('add')}</Button>}</CardContent></Card>
      ) : (
        <>
          <div className="hidden min-h-[calc(100dvh-15rem)] grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.5fr)] gap-4 md:grid">
            <Card className="overflow-hidden">
              <CardHeader className="border-b border-border py-4"><CardTitle className="text-sm">{t('tree')}</CardTitle></CardHeader>
              <CardContent className="max-h-[calc(100dvh-20rem)] overflow-y-auto p-2" role="tree" aria-label={t('tree')}>
                {tree.roots.map((root) => <TreeRow key={root.id} node={root} depth={0} selectedId={selected?.id ?? null} expanded={expanded} visibleChildren={visibleChildren} locale={locale} t={t} onSelect={selectAccount} onToggle={toggleAccount} onMore={(id) => setVisibleChildren((current) => ({ ...current, [id]: (current[id] ?? INITIAL_CHILD_LIMIT) + INITIAL_CHILD_LIMIT }))} />)}
              </CardContent>
            </Card>
            <AccountDetails account={selected} locale={locale} t={t} canManage={canManageAccounts} canViewLedger={canViewLedger} onSelect={selectAccount} onAddChild={openCreate} onEdit={openEdit} />
          </div>

          <div className="space-y-3 md:hidden">
            <MobileBreadcrumb account={selected} tree={tree} locale={locale} t={t} onSelect={selectAccount} />
            {selected && <MobileAccountSummary account={selected} locale={locale} t={t} canManage={canManageAccounts} canViewLedger={canViewLedger} onAddChild={openCreate} onEdit={openEdit} />}
            <Card>
              <CardHeader className="py-4"><CardTitle className="text-sm">{selected ? t('children') : t('tree')}</CardTitle></CardHeader>
              <CardContent className="space-y-1 pb-3">
                {mobileNodes.length === 0 ? (
                  <div className="py-8 text-center"><p className="text-sm font-medium text-text">{t('emptyChildrenTitle')}</p><p className="mt-1 text-xs text-muted">{t('emptyChildrenDescription')}</p>{selected?.is_group && selected.is_active && canManageAccounts && <Button size="sm" className="mt-3" onClick={() => openCreate(selected)}><Plus className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />{t('addChild')}</Button>}</div>
                ) : mobileNodes.map((account) => <MobileAccountRow key={account.id} account={account} locale={locale} t={t} onSelect={selectAccount} />)}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {canManageAccounts && <AccountDialog
        account={editing}
        accounts={accounts ?? []}
        initialParent={dialogParent}
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null); setDialogParent(null); }}
        onSaved={load}
      />}
    </div>
  );
}

function WorkspaceSkeleton() {
  return <div className="grid gap-4 md:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.5fr)]"><Skeleton className="h-96 w-full" /><Skeleton className="h-96 w-full" /></div>;
}

function TreeRow({ node, depth, selectedId, expanded, visibleChildren, locale, t, onSelect, onToggle, onMore }: {
  node: AccountTreeNode;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  visibleChildren: Record<string, number>;
  locale: string;
  t: ReturnType<typeof useTranslations>;
  onSelect: (account: WorkspaceAccount) => void;
  onToggle: (account: AccountTreeNode) => void;
  onMore: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const visibleCount = visibleChildren[node.id] ?? INITIAL_CHILD_LIMIT;
  const children = isExpanded ? node.children.slice(0, visibleCount) : [];

  return <>
    <div role="treeitem" aria-selected={selectedId === node.id} aria-expanded={hasChildren ? isExpanded : undefined} className="group flex items-center gap-1 rounded" style={{ paddingInlineStart: `${depth * 16}px` }}>
      {hasChildren ? <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={isExpanded ? t('collapse', { name: accountLabel(node, locale) }) : t('expand', { name: accountLabel(node, locale) })} onClick={() => onToggle(node)}><ChevronDown className={cn('h-4 w-4 transition-transform', !isExpanded && '-rotate-90')} strokeWidth={1.7} aria-hidden="true" /></Button> : <span className="w-8 shrink-0" aria-hidden="true" />}
      <button type="button" onClick={() => onSelect(node)} className={cn('flex min-h-9 min-w-0 flex-1 items-center justify-between gap-2 rounded px-2 text-start text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', selectedId === node.id ? 'bg-primary-soft text-primary' : 'text-text hover:bg-background')}>
        <span className="min-w-0 truncate">{accountLabel(node, locale)}</span>
        <span className="num shrink-0 text-xs text-muted">{node.code}</span>
      </button>
    </div>
    {children.map((child) => <TreeRow key={child.id} node={child} depth={depth + 1} selectedId={selectedId} expanded={expanded} visibleChildren={visibleChildren} locale={locale} t={t} onSelect={onSelect} onToggle={onToggle} onMore={onMore} />)}
    {isExpanded && node.children.length > visibleCount && <div className="ps-10 py-1"><Button variant="ghost" size="sm" onClick={() => onMore(node.id)}>{node.children.length - visibleCount}</Button></div>}
  </>;
}

function AccountDetails({ account, locale, t, canManage, canViewLedger, onSelect, onAddChild, onEdit }: {
  account: AccountTreeNode | null;
  locale: string;
  t: ReturnType<typeof useTranslations>;
  canManage: boolean;
  canViewLedger: boolean;
  onSelect: (account: WorkspaceAccount) => void;
  onAddChild: (account: WorkspaceAccount) => void;
  onEdit: (account: WorkspaceAccount) => void;
}) {
  if (!account) return <Card><CardContent className="py-12 text-center text-sm text-muted">{t('empty')}</CardContent></Card>;
  const balance = formatRiyal(account.balance);

  return <Card className="overflow-hidden">
    <CardHeader className="border-b border-border">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0"><p className="text-xs text-muted">{t('details')}</p><CardTitle className="mt-1 truncate text-xl">{accountLabel(account, locale)}</CardTitle><p className="num mt-1 text-sm text-muted">#{account.code}</p></div>
        <AccountActions account={account} t={t} canManage={canManage} canViewLedger={canViewLedger} onAddChild={onAddChild} onEdit={onEdit} />
      </div>
      <AccountBreadcrumb account={account} locale={locale} t={t} onSelect={onSelect} />
    </CardHeader>
    <CardContent className="space-y-5 pt-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded border border-border bg-background p-3"><p className="text-xs text-muted">{t('balance')}</p><p className={cn('num mt-1 text-lg font-semibold', isNegative(account.balance) ? 'text-negative' : 'text-text')}>{balance}</p></div>
        <div className="rounded border border-border bg-background p-3"><p className="text-xs text-muted">{t('normalBalance')}</p><p className="mt-1 font-medium text-text">{account.normal_balance === 'debit' ? t('debit') : t('credit')}</p></div>
        <div className="rounded border border-border bg-background p-3"><p className="text-xs text-muted">{t('children')}</p><p className="num mt-1 font-medium text-text">{account.children.length}</p></div>
      </div>

      {!account.is_active && <AccountNotice icon={CircleOff} text={t('disabledAccount')} />}
      {account.is_system && <AccountNotice icon={ShieldCheck} text={t('protectedAccount')} />}

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={accountTone(account)}>{account.is_group ? t('summary') : t('posting')}</Badge>
        <Badge tone={account.is_active ? 'positive' : 'warning'}>{account.is_active ? t('active') : t('inactive')}</Badge>
        {account.is_system && <Badge tone="neutral">{t('system')}</Badge>}
      </div>

      <section aria-labelledby="account-children">
        <div className="mb-2 flex items-center justify-between gap-3"><h2 id="account-children" className="text-sm font-semibold text-text">{t('children')}</h2><span className="text-xs text-muted">{t('childCount', { count: account.children.length })}</span></div>
        {account.children.length === 0 ? <div className="rounded border border-dashed border-border p-5 text-center"><p className="text-sm font-medium text-text">{t('emptyChildrenTitle')}</p><p className="mt-1 text-xs text-muted">{t('emptyChildrenDescription')}</p>{canManage && account.is_group && account.is_active && <Button size="sm" className="mt-3" onClick={() => onAddChild(account)}><Plus className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />{t('addChild')}</Button>}</div> : <div className="divide-y divide-border overflow-hidden rounded border border-border">{account.children.slice(0, INITIAL_CHILD_LIMIT).map((child) => <button key={child.id} type="button" onClick={() => onSelect(child)} className="flex w-full items-center justify-between gap-3 px-3 py-3 text-start hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><span className="min-w-0 truncate font-medium text-text">{accountLabel(child, locale)}</span><span className="num shrink-0 text-xs text-muted">{child.code}</span></button>)}</div>}
      </section>
    </CardContent>
  </Card>;
}

function AccountActions({ account, t, canManage, canViewLedger, onAddChild, onEdit }: {
  account: WorkspaceAccount;
  t: ReturnType<typeof useTranslations>;
  canManage: boolean;
  canViewLedger: boolean;
  onAddChild: (account: WorkspaceAccount) => void;
  onEdit: (account: WorkspaceAccount) => void;
}) {
  const items = (canManage && account.is_group && account.is_active) || (canManage && !account.is_system) || (canViewLedger && !account.is_group);
  if (!items) return null;

  return <Dropdown
    trigger={<Ellipsis className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />}
    triggerLabel={t('actions')}
    menuLabel={t('actions')}
    mobilePopover
    triggerClassName="h-10 w-10 justify-center border border-border text-muted hover:bg-primary-soft hover:text-primary"
  >
    {canManage && account.is_group && account.is_active && <DropdownItem icon={Plus} onClick={() => onAddChild(account)}>{t('addChild')}</DropdownItem>}
    {canManage && !account.is_system && <DropdownItem icon={Pencil} onClick={() => onEdit(account)}>{t('edit')}</DropdownItem>}
    {canViewLedger && !account.is_group && <DropdownItem icon={FileText} href={`/reports/general/account-ledger?account_id=${encodeURIComponent(account.id)}`}>{t('viewLedger')}</DropdownItem>}
  </Dropdown>;
}

function AccountBreadcrumb({ account, locale, t, onSelect }: { account: WorkspaceAccount; locale: string; t: ReturnType<typeof useTranslations>; onSelect: (account: WorkspaceAccount) => void }) {
  return <nav aria-label={t('searchPath')} className="mt-4 flex flex-wrap items-center gap-1 text-xs text-muted">
    {account.path.map((item, index) => {
      const isCurrent = index === account.path.length - 1;
      return <span key={item.id} className="flex min-w-0 items-center gap-1">{index > 0 && <ChevronLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}{isCurrent ? <span className="truncate text-text">{accountLabel(item, locale)}</span> : <button type="button" onClick={() => onSelect({ ...account, id: item.id })} className="truncate hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{accountLabel(item, locale)}</button>}</span>;
    })}
  </nav>;
}

function MobileBreadcrumb({ account, tree, locale, t, onSelect }: { account: AccountTreeNode | null; tree: ReturnType<typeof buildAccountTree>; locale: string; t: ReturnType<typeof useTranslations>; onSelect: (account: WorkspaceAccount) => void }) {
  if (!account) return null;
  return <nav aria-label={t('searchPath')} className="flex min-h-10 items-center gap-1 overflow-x-auto text-sm text-muted">
    {account.path.map((item, index) => {
      const node = tree.byId.get(item.id);
      const isCurrent = index === account.path.length - 1;
      return <span key={item.id} className="flex items-center gap-1">{index > 0 && <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />}{isCurrent ? <span className="whitespace-nowrap font-medium text-text">{accountLabel(node ?? account, locale)}</span> : <button type="button" onClick={() => node && onSelect(node)} className="whitespace-nowrap hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{accountLabel(node ?? account, locale)}</button>}</span>;
    })}
  </nav>;
}

function MobileAccountSummary({ account, locale, t, canManage, canViewLedger, onAddChild, onEdit }: {
  account: AccountTreeNode;
  locale: string;
  t: ReturnType<typeof useTranslations>;
  canManage: boolean;
  canViewLedger: boolean;
  onAddChild: (account: WorkspaceAccount) => void;
  onEdit: (account: WorkspaceAccount) => void;
}) {
  return <Card><CardContent className="space-y-3 pt-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-base font-semibold text-text">{accountLabel(account, locale)}</p><p className="num mt-1 text-xs text-muted">#{account.code}</p></div><AccountActions account={account} t={t} canManage={canManage} canViewLedger={canViewLedger} onAddChild={onAddChild} onEdit={onEdit} /></div><div className="flex items-end justify-between gap-3"><div><p className="text-xs text-muted">{t('balance')}</p><p className={cn('num mt-1 text-lg font-semibold', isNegative(account.balance) ? 'text-negative' : 'text-text')}>{formatRiyal(account.balance)}</p></div><Badge tone={accountTone(account)}>{account.is_group ? t('summary') : t('posting')}</Badge></div>{!account.is_active && <AccountNotice icon={CircleOff} text={t('disabledAccount')} />}</CardContent></Card>;
}

function MobileAccountRow({ account, locale, t, onSelect }: { account: AccountTreeNode; locale: string; t: ReturnType<typeof useTranslations>; onSelect: (account: WorkspaceAccount) => void }) {
  const DirectionIcon = locale.toLowerCase().startsWith('ar') ? ChevronLeft : ChevronRight;
  return <button type="button" onClick={() => onSelect(account)} className="flex min-h-14 w-full items-center justify-between gap-3 rounded px-2 py-2 text-start hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><div className="min-w-0"><p className="truncate text-sm font-medium text-text">{accountLabel(account, locale)}</p><p className="num mt-1 text-xs text-muted">{account.code}</p></div><div className="flex items-center gap-2"><span className={cn('num text-sm font-medium', isNegative(account.balance) ? 'text-negative' : 'text-text')}>{formatRiyal(account.balance)}</span><DirectionIcon className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} aria-hidden="true" /></div></button>;
}

function AccountNotice({ icon: Icon, text }: { icon: typeof CircleOff; text: string }) {
  return <p className="flex gap-2 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-text"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.7} aria-hidden="true" />{text}</p>;
}
