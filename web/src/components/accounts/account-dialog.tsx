'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface ManagedAccount {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  name_en?: string | null;
  type: AccountType;
  normal_balance: 'debit' | 'credit';
  is_group: boolean;
  is_system: boolean;
  is_active: boolean;
  children_count?: number;
  has_entries?: boolean;
  balance: string;
  depth?: number;
}

function normalBalanceFor(type: AccountType): 'debit' | 'credit' {
  return ['asset', 'expense'].includes(type) ? 'debit' : 'credit';
}

export function AccountDialog({
  account,
  accounts,
  initialParent,
  open,
  onClose,
  onSaved,
}: {
  account: ManagedAccount | null;
  accounts: ManagedAccount[];
  /** يحافظ إجراء «إضافة حساب فرعي» على الأب والنوع في سياق الحوار. */
  initialParent?: ManagedAccount | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('accounts');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [type, setType] = useState<AccountType>('expense');
  const [parentId, setParentId] = useState('');
  const [isGroup, setIsGroup] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [codeEdited, setCodeEdited] = useState(false);
  const [suggestingCode, setSuggestingCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const hasEntries = !!account?.has_entries;

  useEffect(() => {
    if (!open) return;
    setCode(account?.code ?? '');
    setName(account?.name ?? '');
    setNameEn(account?.name_en ?? '');
    setType(account?.type ?? initialParent?.type ?? 'expense');
    setParentId(account?.parent_id ?? initialParent?.id ?? '');
    setIsGroup(account?.is_group ?? false);
    setIsActive(account?.is_active ?? true);
    setCodeEdited(!!account);
    setError(null);
  }, [account, initialParent, open]);

  const parentOptions = useMemo(
    () => accounts.filter((candidate) =>
      candidate.id !== account?.id &&
      candidate.is_group &&
      candidate.is_active &&
      candidate.type === type,
    ),
    [account?.id, accounts, type],
  );

  async function suggestCode() {
    if (account) return;
    setSuggestingCode(true);
    try {
      const query = new URLSearchParams({ type });
      if (parentId) query.set('parent_id', parentId);
      const response = await api<{ data: { code: string } }>(`/accounts/code-suggestion?${query.toString()}`);
      setCode(response.data.code);
      setCodeEdited(false);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : tc('loadFailed'));
    } finally {
      setSuggestingCode(false);
    }
  }

  useEffect(() => {
    if (!open || account || codeEdited) return;
    void suggestCode();
  // يستجيب الاقتراح للأب أو التصنيف فقط؛ لا يعيد التنفيذ عند تغير النص المقترح نفسه.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account, parentId, type, codeEdited]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const body = {
        code: code.trim(),
        name: name.trim(),
        name_en: nameEn.trim() || null,
        type,
        parent_id: parentId || null,
        is_group: isGroup,
        is_active: isActive,
      };

      if (account) {
        await api(`/accounts/${account.id}`, { method: 'PUT', body });
        success(tc('updated'));
      } else {
        await api('/accounts', { method: 'POST', body });
        success(tc('created'));
      }

      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={account ? t('edit') : t('add')}>
      <form onSubmit={submit} className="space-y-4">
        {hasEntries && (
          <div className="flex gap-2 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-text" role="note">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.7} aria-hidden="true" />
            <p>{t('historyLocked')}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="account-code">{t('code')}</Label>
            <div className="flex gap-2">
              <Input
                id="account-code"
                dir="ltr"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  setCodeEdited(true);
                }}
                disabled={hasEntries}
                maxLength={50}
                required
              />
              {!account && (
                <Button type="button" size="icon" variant="outline" onClick={() => void suggestCode()} disabled={suggestingCode} aria-label={t('suggestCode')} title={t('suggestCode')}>
                  <RefreshCw className={suggestingCode ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} strokeWidth={1.7} aria-hidden="true" />
                </Button>
              )}
            </div>
            {!account && <p className="text-[11px] text-muted">{t('suggestCodeHint')}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="account-type">{t('category')}</Label>
            <Select
              id="account-type"
              value={type}
              onChange={(event) => setType(event.target.value as AccountType)}
              disabled={!!account}
            >
              <option value="asset">{t('types.asset')}</option>
              <option value="liability">{t('types.liability')}</option>
              <option value="equity">{t('types.equity')}</option>
              <option value="revenue">{t('types.revenue')}</option>
              <option value="expense">{t('types.expense')}</option>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="account-name">{t('name')}</Label>
            <Input id="account-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={255} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="account-name-en">{t('nameEn')}</Label>
            <Input id="account-name-en" dir="ltr" value={nameEn} onChange={(event) => setNameEn(event.target.value)} maxLength={255} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="account-parent">{t('parent')}</Label>
          <Select
            id="account-parent"
            value={parentId}
            onChange={(event) => setParentId(event.target.value)}
            disabled={hasEntries || !!initialParent}
          >
            <option value="">{t('noParent')}</option>
            {parentOptions.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.code} — {candidate.name}
              </option>
            ))}
          </Select>
          {initialParent && !account && <p className="text-[11px] text-muted">{t('childOf', { name: initialParent.name })}</p>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded border border-border px-3 py-2.5">
            <div>
              <Label htmlFor="account-group">{t('group')}</Label>
              <p className="mt-1 text-[11px] text-muted">{isGroup ? t('summaryHint') : t('postingHint')}</p>
            </div>
            <Switch id="account-group" checked={isGroup} onCheckedChange={setIsGroup} disabled={(account?.children_count ?? 0) > 0} />
          </div>
          <div className="flex items-center justify-between rounded border border-border px-3 py-2.5">
            <div>
              <Label htmlFor="account-active">{t('active')}</Label>
              <p className="mt-1 text-[11px] text-muted">{t('normalBalance')}: {normalBalanceFor(type) === 'debit' ? t('debit') : t('credit')}</p>
            </div>
            <Switch id="account-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        {error && <p className="rounded border border-negative/30 bg-negative/10 px-3 py-2 text-xs text-negative" role="alert">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" disabled={saving || !code.trim() || !name.trim()}>{t('save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
