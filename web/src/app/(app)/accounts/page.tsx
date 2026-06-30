'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatRiyal, formatRiyalShort } from '@/lib/money';

interface Account {
  id: string;
  code: string;
  name: string;
  name_en?: string | null;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  normal_balance: 'debit' | 'credit';
  is_group: boolean;
  balance: string;
}

// ترتيب أقسام دليل الحسابات: أصول ← خصوم ← ملكية ← إيرادات ← مصروفات
const TYPE_ORDER = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;

// مستوى التعشيق من طول الكود: 1→0، 11→1، 1110→2 (بحدّ أقصى مستويين).
const indentLevel = (code: string) => Math.min(code.length - 1, 2);

export default function AccountsPage() {
  const t = useTranslations('accounts');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    api<{ data: Account[] }>('/accounts')
      .then((r) => setAccounts(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.code.includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.name_en ?? '').toLowerCase().includes(q),
    );
  }, [accounts, query]);

  // تجميع حسب النوع، الفرز بالكود، وحساب إجمالي كل قسم من الأوراق فقط.
  const groups = useMemo(
    () =>
      TYPE_ORDER.map((type) => {
        const rows = filtered
          .filter((a) => a.type === type)
          .sort((a, b) => a.code.localeCompare(b.code));
        const subtotal = rows
          .filter((a) => !a.is_group)
          .reduce((s, a) => s + Number(a.balance), 0);
        return { type, rows, subtotal };
      }).filter((g) => g.rows.length > 0),
    [filtered],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </div>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search')}
          className="sm:w-64"
        />
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <Card>
          <CardContent>
            <p className="py-8 text-center text-sm text-negative">{t('error')}</p>
          </CardContent>
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent>
            <p className="py-8 text-center text-sm text-muted">{t('empty')}</p>
          </CardContent>
        </Card>
      ) : (
        groups.map((g) => (
          <Card key={g.type}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t(`types.${g.type}`)}</CardTitle>
              <span className="text-sm text-muted">
                {t('total')}:{' '}
                <span className="num font-medium text-text">{formatRiyalShort(g.subtotal)}</span>
              </span>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH>{t('account')}</TH>
                      <TH>{t('nature')}</TH>
                      <TH className="text-end">{t('balance')}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {g.rows.map((a) => (
                      <TR key={a.id}>
                        <TD>
                          <div
                            className="flex items-center gap-2"
                            style={{ paddingInlineStart: `${indentLevel(a.code) * 18}px` }}
                          >
                            <span className="num text-xs text-muted">{a.code}</span>
                            <span className={a.is_group ? 'font-semibold text-text' : 'text-text'}>
                              {a.name}
                            </span>
                          </div>
                        </TD>
                        <TD className="text-muted">
                          {a.normal_balance === 'debit' ? t('debit') : t('credit')}
                        </TD>
                        <TD className="num text-end">
                          {a.is_group ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <span className={Number(a.balance) < 0 ? 'text-negative' : 'text-text'}>
                              {formatRiyal(a.balance)}
                            </span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
