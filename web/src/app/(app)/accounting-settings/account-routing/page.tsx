'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Lock, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { EmptyState, LoadingState } from '@/components/nebrax';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';

/**
 * ACC-2: توجيه الحسابات — تعيين كل دور محاسبي دلالي إلى حساب فعلي في دليل
 * المستأجر. بنية تحتية فقط: لا خدمة ترحيل تستهلك هذا التعيين بعد (zero
 * posting consumers)، فالتغيير هنا لا يمسّ أي قيدٍ سابق ولا يُعيد حسابه.
 */
interface EligibleAccount {
  id: string;
  code: string;
  name: string;
  name_en: string | null;
  type: string;
}

interface RoleMappingAccount {
  id: string;
  code: string;
  name: string;
  name_en: string | null;
  is_active: boolean;
  is_group: boolean;
}

interface RoleMapping {
  state: 'mapped' | 'invalid' | 'unmapped';
  account: RoleMappingAccount | null;
  is_default: boolean;
}

interface RoleRow {
  key: string;
  label_ar: string;
  label_en: string;
  description_ar: string;
  description_en: string;
  domain: string;
  legacy_code: string;
  configurable: boolean;
  mapping: RoleMapping;
}

interface RoutingResponse {
  roles: RoleRow[];
  domains: Record<string, { label_ar: string; label_en: string }>;
  eligible_accounts: EligibleAccount[];
}

function useAccountRoutingAccess(): { mounted: boolean; canView: boolean; canManage: boolean } {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const user = currentUser();
  return {
    mounted,
    canView: hasPermission(user?.permissions, user?.role, 'accounting_settings.view'),
    canManage: hasPermission(user?.permissions, user?.role, 'accounting_settings.manage'),
  };
}

export default function AccountRoutingPage() {
  const t = useTranslations('accountingSettings');
  const locale = useLocale();
  const isEn = locale.toLowerCase().startsWith('en');
  const { success, error: toastError } = useToast();
  const { mounted, canView, canManage } = useAccountRoutingAccess();

  const [data, setData] = useState<RoutingResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    api<{ data: RoutingResponse }>('/accounting-settings/account-routing')
      .then((response) => setData(response.data))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t('loadFailed')));
  }, [t]);

  useEffect(() => {
    if (canView) load();
  }, [canView, load]);

  const grouped = useMemo(() => {
    if (!data) return [];
    const byDomain = new Map<string, RoleRow[]>();
    for (const role of data.roles) {
      const list = byDomain.get(role.domain) ?? [];
      list.push(role);
      byDomain.set(role.domain, list);
    }

    return Object.entries(data.domains)
      .filter(([key]) => byDomain.has(key))
      .map(([key, label]) => ({ key, label, roles: byDomain.get(key) ?? [] }));
  }, [data]);

  async function updateMapping(roleKey: string, accountId: string) {
    setSavingKey(roleKey);
    try {
      const response = await api<{ data: RoleRow }>(`/accounting-settings/account-routing/${roleKey}`, {
        method: 'PUT',
        body: { account_id: accountId },
      });
      setData((current) => current && {
        ...current,
        roles: current.roles.map((role) => (role.key === roleKey ? response.data : role)),
      });
      success(t('routingSaved'));
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('routingSaveFailed'));
    } finally {
      setSavingKey(null);
    }
  }

  async function resetMapping(roleKey: string) {
    if (!window.confirm(t('routingResetConfirm'))) return;

    setSavingKey(roleKey);
    try {
      const response = await api<{ data: RoleRow }>(`/accounting-settings/account-routing/${roleKey}`, {
        method: 'DELETE',
      });
      setData((current) => current && {
        ...current,
        roles: current.roles.map((role) => (role.key === roleKey ? response.data : role)),
      });
      success(t('routingResetDone'));
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('routingResetFailed'));
    } finally {
      setSavingKey(null);
    }
  }

  if (!mounted) return <LoadingState variant="cards" rows={5} />;

  if (!canView) {
    return <EmptyState icon={Lock} title={t('forbidden')} description={t('forbiddenHint')} />;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('backToAccountingSettings')}>
          <Link href="/accounting-settings">
            <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold text-text">{t('accountRoutingTitle')}</h1>
          <p className="mt-1 text-sm text-muted">{t('accountRoutingSubtitle')}</p>
        </div>
      </div>

      {!canManage && (
        <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted">{t('routingViewOnly')}</p>
      )}

      {loadError ? (
        <p className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{loadError}</p>
      ) : data === null ? (
        <LoadingState variant="cards" rows={5} />
      ) : (
        grouped.map((group) => (
          <Card key={group.key}>
            <CardHeader>
              <CardTitle>{isEn ? group.label.label_en : group.label.label_ar}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border">
                {group.roles.map((role) => {
                  const label = isEn ? role.label_en : role.label_ar;
                  const description = isEn ? role.description_en : role.description_ar;
                  const currentAccountId = role.mapping.account?.id ?? '';
                  const saving = savingKey === role.key;

                  return (
                    <div key={role.key} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium text-text">{label}</h3>
                          {role.mapping.state === 'mapped' && role.mapping.is_default && (
                            <Badge tone="neutral">{t('routingStateDefault')}</Badge>
                          )}
                          {role.mapping.state === 'mapped' && !role.mapping.is_default && (
                            <Badge tone="positive">{t('routingStateCustom')}</Badge>
                          )}
                          {role.mapping.state === 'invalid' && (
                            <Badge tone="negative">{t('routingStateInvalid')}</Badge>
                          )}
                          {role.mapping.state === 'unmapped' && (
                            <Badge tone="warning">{t('routingStateUnmapped')}</Badge>
                          )}
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Select
                          className="w-56"
                          disabled={!canManage || saving}
                          value={currentAccountId}
                          onChange={(event) => {
                            const value = event.target.value;
                            if (value) updateMapping(role.key, value);
                          }}
                        >
                          <option value="" disabled>{t('routingSelectAccount')}</option>
                          {data.eligible_accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.code} — {isEn && account.name_en ? account.name_en : account.name}
                            </option>
                          ))}
                        </Select>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={!canManage || saving || role.mapping.is_default}
                          onClick={() => resetMapping(role.key)}
                          aria-label={t('routingResetAction')}
                          title={t('routingResetAction')}
                        >
                          <RotateCcw className="h-4 w-4" strokeWidth={1.7} />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
