'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FolderTree, Pencil, Plus } from 'lucide-react';
import { AccountDialog, type ManagedAccount } from '@/components/accounts/account-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { api } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { formatRiyal, isNegative, riyalToMinor } from '@/lib/money';

const TYPE_ORDER = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;

type Node = ManagedAccount & { depth: number };

/**
 * دليل الحسابات شجرة حقيقية: API يعيد قائمة مسطحة بـ parent_id، ويُحافظ العرض
 * على ترتيب الأب ثم الأبناء حتى تظهر العلاقة المحاسبية بدلاً من تخمينها من طول الكود.
 */
function buildTree(accounts: ManagedAccount[]): Node[] {
  const byParent = new Map<string | null, ManagedAccount[]>();
  const ids = new Set(accounts.map((account) => account.id));

  for (const account of accounts) {
    const parentKey = account.parent_id && ids.has(account.parent_id) ? account.parent_id : null;
    byParent.set(parentKey, [...(byParent.get(parentKey) ?? []), account]);
  }

  const sortByCode = (left: ManagedAccount, right: ManagedAccount) =>
    left.code.localeCompare(right.code, undefined, { numeric: true });

  const result: Node[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const account of (byParent.get(parentId) ?? []).sort(sortByCode)) {
      if (visited.has(account.id)) continue;
      visited.add(account.id);
      result.push({ ...account, depth });
      walk(account.id, depth + 1);
    }
  };

  walk(null, 0);

  // لا تخفي بيانات قديمة ذات دورة أو أب مفقود؛ تظهر كجذر كي يمكن إصلاحها بوضوح.
  for (const account of [...accounts].sort(sortByCode)) {
    if (!visited.has(account.id)) {
      visited.add(account.id);
      result.push({ ...account, depth: 0 });
      walk(account.id, 1);
    }
  }

  return result;
}

export default function AccountsPage() {
  const t = useTranslations('accounts');
  const canManageAccounts = useMemo(() => ['owner', 'admin'].includes(currentUser()?.role ?? ''), []);
  const [accounts, setAccounts] = useState<ManagedAccount[] | null>(null);
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedAccount | null>(null);

  const load = useCallback(() => {
    setAccounts(null);
    api<{ data: ManagedAccount[] }>('/accounts')
      .then((response) => setAccounts(response.data))
      .catch(() => setAccounts([]));
  }, []);

  useEffect(() => load(), [load]);

  const tree = useMemo(() => buildTree(accounts ?? []), [accounts]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return tree;

    const byId = new Map(tree.map((account) => [account.id, account]));
    const included = new Set<string>();

    for (const account of tree) {
      const matches = account.code.includes(normalized) ||
        account.name.toLocaleLowerCase().includes(normalized) ||
        (account.name_en ?? '').toLocaleLowerCase().includes(normalized);
      if (!matches) continue;

      let current: Node | undefined = account;
      while (current) {
        included.add(current.id);
        current = current.parent_id ? byId.get(current.parent_id) : undefined;
      }
    }

    return tree.filter((account) => included.has(account.id));
  }, [query, tree]);

  const sections = useMemo(
    () => TYPE_ORDER.map((type) => {
      const rows = visible.filter((account) => account.type === type);
      const totalMinor = rows
        .filter((account) => !account.is_group)
        .reduce((sum, account) => sum + riyalToMinor(account.balance), 0);
      return { type, rows, totalMinor };
    }).filter((section) => section.rows.length > 0),
    [visible],
  );

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(account: Node) {
    setEditing(account);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FolderTree className="h-5 w-5 text-primary" strokeWidth={1.7} aria-hidden="true" />
            <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
          </div>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('search')}
            className="sm:w-64"
          />
          {canManageAccounts && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              {t('add')}
            </Button>
          )}
        </div>
      </div>

      {accounts === null ? (
        <Skeleton className="h-64 w-full" />
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent>
            <p className="py-8 text-center text-sm text-muted">{t('empty')}</p>
          </CardContent>
        </Card>
      ) : sections.length === 0 ? (
        <Card>
          <CardContent>
            <p className="py-8 text-center text-sm text-muted">{t('empty')}</p>
          </CardContent>
        </Card>
      ) : (
        sections.map((section) => (
          <Card key={section.type}>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>{t(`types.${section.type}`)}</CardTitle>
              <span className="text-sm text-muted">
                {t('total')}: <span className="num font-medium text-text">{formatRiyal(section.totalMinor / 100)}</span>
              </span>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH>{t('account')}</TH>
                      <TH>{t('nature')}</TH>
                      <TH>{t('active')}</TH>
                      <TH className="text-end">{t('balance')}</TH>
                      {canManageAccounts && <TH className="w-16 text-end">{t('actions')}</TH>}
                    </TR>
                  </THead>
                  <TBody>
                    {section.rows.map((account) => (
                      <TR key={account.id} className={!account.is_active ? 'opacity-60' : undefined}>
                        <TD>
                          <div className="flex min-w-[16rem] items-center gap-2" style={{ paddingInlineStart: `${account.depth * 20}px` }}>
                            <span className="num shrink-0 text-xs text-muted">{account.code}</span>
                            <span className={account.is_group ? 'font-semibold text-text' : 'text-text'}>{account.name}</span>
                            {account.is_system ? <Badge tone="muted">{t('system')}</Badge> : <Badge tone="neutral">{t('custom')}</Badge>}
                            {account.is_group && <Badge tone="muted">{t('group')}</Badge>}
                          </div>
                        </TD>
                        <TD className="text-muted">{account.normal_balance === 'debit' ? t('debit') : t('credit')}</TD>
                        <TD>
                          <Badge tone={account.is_active ? 'positive' : 'warning'}>{account.is_active ? t('active') : t('inactive')}</Badge>
                        </TD>
                        <TD className="num text-end">
                          {account.is_group ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <span className={isNegative(account.balance) ? 'text-negative' : 'text-text'}>{formatRiyal(account.balance)}</span>
                          )}
                        </TD>
                        {canManageAccounts && (
                          <TD className="text-end">
                            {account.is_system ? (
                              <span className="text-muted" aria-hidden="true">—</span>
                            ) : (
                              <Button variant="ghost" size="icon" aria-label={t('edit')} onClick={() => openEdit(account)}>
                                <Pencil className="h-4 w-4" strokeWidth={1.7} />
                              </Button>
                            )}
                          </TD>
                        )}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      {canManageAccounts && (
        <AccountDialog
          account={editing}
          accounts={tree}
          open={dialogOpen}
          onClose={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
          onSaved={load}
        />
      )}
    </div>
  );
}
