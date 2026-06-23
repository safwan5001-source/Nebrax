'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { UserDialog } from '@/components/users/user-dialog';
import { api } from '@/lib/api';
import { currentUser } from '@/lib/auth';

interface TeamUser { id: string; name: string; email: string; role: string; is_active: boolean }

interface Subscription {
  plan: string;
  active: boolean;
  trial_ends_at: string | null;
  subscription_ends_at: string | null;
  limits: { invoices_per_month: number | null; users: number | null };
  usage: { invoices_this_month: number; users: number };
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const near = limit !== null && pct >= 80;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="num text-text">
          {used} / {limit ?? '∞'}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-border/60">
        <div
          className={`h-full rounded ${near ? 'bg-warning' : 'bg-primary'}`}
          style={{ width: limit ? `${pct}%` : '4%' }}
        />
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const t = useTranslations('settings');
  const tu = useTranslations('users');
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const user = currentUser();
  const canManage = user?.role === 'owner' || user?.role === 'admin';

  const [team, setTeam] = useState<TeamUser[]>([]);
  const [userDialog, setUserDialog] = useState(false);

  const loadTeam = useCallback(() => {
    if (!canManage) return;
    api<{ data: TeamUser[] }>('/users').then((r) => setTeam(r.data)).catch(() => {});
  }, [canManage]);

  useEffect(() => {
    api<Subscription>('/subscription').then(setSub).finally(() => setLoading(false));
    loadTeam();
  }, [loadTeam]);

  async function removeUser(id: string) {
    await api(`/users/${id}`, { method: 'DELETE' }).catch(() => {});
    loadTeam();
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-text">{t('title')}</h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('subscription')}</CardTitle>
            {sub && (
              <Badge tone={sub.active ? 'positive' : 'negative'}>{sub.active ? t('active') : t('expired')}</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {loading || !sub ? (
              <Skeleton className="h-28 w-full" />
            ) : (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">{t('plan')}</span>
                  <Badge tone="neutral">{t(`plans.${sub.plan}`)}</Badge>
                </div>
                {sub.trial_ends_at && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">{t('trial_ends')}</span>
                    <span className="num text-text">{sub.trial_ends_at}</span>
                  </div>
                )}
                {sub.subscription_ends_at && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">{t('subscription_ends')}</span>
                    <span className="num text-text">{sub.subscription_ends_at}</span>
                  </div>
                )}
                <div className="space-y-2 border-t border-border pt-3">
                  <UsageBar label={t('invoices_usage')} used={sub.usage.invoices_this_month} limit={sub.limits.invoices_per_month} />
                  <UsageBar label={t('users_usage')} used={sub.usage.users} limit={sub.limits.users} />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('account')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">{t('name')}</dt>
                <dd className="text-text">{user?.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{t('email')}</dt>
                <dd className="num text-text">{user?.email}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{t('role')}</dt>
                <dd><Badge tone="muted">{t(`roles.${user?.role}`)}</Badge></dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      {canManage && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{tu('title')}</CardTitle>
            <Button size="sm" onClick={() => setUserDialog(true)}>
              <Plus className="h-4 w-4" strokeWidth={1.8} />
              {tu('add')}
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR>
                  <TH>{tu('name')}</TH>
                  <TH>{tu('email')}</TH>
                  <TH>{tu('role')}</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {team.map((u) => (
                  <TR key={u.id}>
                    <TD>{u.name}</TD>
                    <TD className="num text-muted">{u.email}</TD>
                    <TD><Badge tone="muted">{tu(`roles.${u.role}`)}</Badge></TD>
                    <TD className="text-end">
                      {u.id !== user?.id && (
                        <Button variant="ghost" size="icon" aria-label={tu('remove')} onClick={() => removeUser(u.id)}>
                          <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <UserDialog open={userDialog} onClose={() => setUserDialog(false)} onSaved={loadTeam} />
    </div>
  );
}
