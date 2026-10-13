'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/platform/confirm-dialog';
import { formatDateTime } from '@/lib/formatting';
import { platformApi } from '@/lib/platform-api';
import { isolateAuto } from './isolate';

type ExceptionStatus = 'active' | 'expired' | 'revoked';
type Exception = { id: string; tenant_id: string; tenant_name?: string; reason: string; expires_at: string | null; status: ExceptionStatus };
type Tenant = { id: string; name: string };
type TenantPage = { data: { data?: Tenant[] } | Tenant[]; pagination?: { current_page?: number; last_page?: number; total?: number } };

/** حجم صفحة المؤسسات: افتراض الخادم نفسه (20). التصفح بـ`page` والبحث بـ`search` من جهة الخادم، فلا تُحمَّل كل المؤسسات. */
const TENANT_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 250;

const STATUS_KEY = { active: 'scanExStatusActive', expired: 'scanExStatusExpired', revoked: 'scanExStatusRevoked' } as const;
const STATUS_TONE = { active: 'positive', expired: 'muted', revoked: 'negative' } as const;

const fieldClass = 'h-11 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

/**
 * استثناءات فحص الملفات (منح وسحب). السلوك والطلبات كما كانت: منح = POST مع كلمة المرور الحالية، وسحب = POST مع
 * السبب وكلمة المرور. ما تغيّر: النصوص في ملفات الرسائل، تسميات ظاهرة، تخطيط متجاوب، وحوار تأكيد بدل `window.prompt`
 * (فتح الحوار لا يرسل شيئاً، والتنفيذ مرة واحدة أثناء الانشغال). كلمات المرور لا تُخزَّن بعد الإغلاق.
 */
export function FileScanExceptions(): JSX.Element {
  const t = useTranslations('platformIntegrations');
  const locale = useLocale();
  const [items, setItems] = useState<Exception[]>([]);
  const [selected, setSelected] = useState<Tenant | null>(null);
  const [tenantOptions, setTenantOptions] = useState<Tenant[]>([]);
  const [tenantQuery, setTenantQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [tenantPage, setTenantPage] = useState(1);
  const [tenantLastPage, setTenantLastPage] = useState(1);
  const [tenantTotal, setTenantTotal] = useState(0);
  const [tenantsLoading, setTenantsLoading] = useState(true);
  const [tenantsError, setTenantsError] = useState<'list' | 'more' | null>(null);
  const tenantSeq = useRef(0);
  const tenantId = selected?.id ?? '';
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [revoking, setRevoking] = useState<Exception | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revokePassword, setRevokePassword] = useState('');
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const exceptions = await platformApi<{ data: Exception[] }>('/platform/document-file-scan-exceptions');
      setItems(exceptions.data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * صفحة مؤسسات من الخادم (`GET /platform/tenants?search&page&per_page`). الطلب الأحدث وحده يكتب الحالة،
   * وتُدمج الصفحات بحسب المعرّف فلا تتكرر مؤسسة إن تغيّر الترتيب بين صفحتين. المؤسسة المختارة لا تتأثر بما يُحمَّل.
   */
  const loadTenants = useCallback(async (query: string, page: number): Promise<void> => {
    const id = ++tenantSeq.current;
    setTenantsLoading(true);
    setTenantsError(null);
    try {
      const params = new URLSearchParams({ per_page: String(TENANT_PAGE_SIZE), page: String(page) });
      if (query !== '') params.set('search', query);
      const response = await platformApi<TenantPage>(`/platform/tenants?${params.toString()}`);
      if (id !== tenantSeq.current) return;
      const rows = Array.isArray(response.data) ? response.data : (response.data.data ?? []);
      const meta = response.pagination;
      setTenantOptions((current) => {
        if (page === 1) return rows;
        const known = new Set(current.map((row) => row.id));
        return [...current, ...rows.filter((row) => !known.has(row.id))];
      });
      setTenantPage(page);
      setTenantLastPage(Math.max(1, meta?.last_page ?? 1));
      setTenantTotal(typeof meta?.total === 'number' ? meta.total : rows.length);
      if (page === 1 && query === '') setSelected((current) => current ?? rows[0] ?? null);
    } catch {
      if (id !== tenantSeq.current) return;
      if (page === 1) {
        // نتائج الاستعلام السابق لم تعد تخص هذا البحث الفاشل: لا تبقى قابلة للاختيار. المؤسسة المختارة وحدها تبقى.
        setTenantOptions([]);
        setTenantPage(1);
        setTenantLastPage(1);
        setTenantTotal(0);
      }
      setTenantsError(page === 1 ? 'list' : 'more');
    } finally {
      if (id === tenantSeq.current) setTenantsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTenants(appliedQuery, 1);
  }, [appliedQuery, loadTenants]);

  useEffect(() => {
    const next = tenantQuery.trim();
    if (next === appliedQuery) return;
    const timer = window.setTimeout(() => setAppliedQuery(next), next === '' ? 0 : SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [tenantQuery, appliedQuery]);

  function chooseTenant(value: string): void {
    // الاختيار من المحمَّل فقط (أو المختار سابقاً): قيمة غير موجودة لا تُقبل ولا تُرسل.
    const match = [...tenantOptions, ...(selected ? [selected] : [])].find((tenant) => tenant.id === value);
    if (match) setSelected(match);
  }

  const retryTenants = (): void => void loadTenants(appliedQuery, tenantsError === 'more' ? tenantPage + 1 : 1);
  const tenantSearchPending = tenantQuery.trim() !== appliedQuery;
  const selectOptions = selected && !tenantOptions.some((tenant) => tenant.id === selected.id) ? [selected, ...tenantOptions] : tenantOptions;

  async function grant(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await platformApi('/platform/document-file-scan-exceptions', {
        method: 'POST',
        body: { tenant_id: tenantId, reason, expires_at: expiresAt || null, current_password: password },
      });
      setReason('');
      setPassword('');
      setExpiresAt('');
      await load();
      setNotice({ ok: true, message: t('scanExGranted') });
    } catch (error) {
      setNotice({ ok: false, message: error instanceof Error && error.message ? error.message : t('scanExGrantFailed') });
    } finally {
      setBusy(false);
    }
  }

  function openRevoke(item: Exception): void {
    setRevokeReason('');
    setRevokePassword('');
    setRevokeError(null);
    setRevoking(item);
  }

  function closeRevoke(): void {
    setRevoking(null);
    setRevokeReason('');
    setRevokePassword('');
    setRevokeError(null);
  }

  async function revoke(): Promise<void> {
    if (!revoking) return;
    setBusy(true);
    setRevokeError(null);
    try {
      await platformApi(`/platform/document-file-scan-exceptions/${revoking.id}/revoke`, {
        method: 'POST',
        body: { reason: revokeReason, current_password: revokePassword },
      });
      closeRevoke();
      await load();
      setNotice({ ok: true, message: t('scanExRevoked') });
    } catch (error) {
      setRevokeError(error instanceof Error && error.message ? error.message : t('scanExRevokeFailed'));
    } finally {
      setBusy(false);
    }
  }

  const canGrant = !busy && tenantId !== '' && reason.trim() !== '' && password !== '';

  return (
    <Card className="xl:col-span-2" role="region" aria-labelledby="scan-exceptions-title">
      <CardHeader>
        <CardTitle id="scan-exceptions-title">{t('scanExTitle')}</CardTitle>
        <p className="text-sm leading-relaxed text-muted" role="note">{t('scanExWarning')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="scan-ex-tenant-search">{t('scanExTenantSearch')}</Label>
            <Input id="scan-ex-tenant-search" className="h-11" type="search" autoComplete="off" placeholder={t('scanExTenantSearchPlaceholder')} value={tenantQuery} onChange={(event) => setTenantQuery(event.target.value)} aria-describedby="scan-ex-tenant-status" />
            <Label htmlFor="scan-ex-tenant">{t('scanExTenant')}</Label>
            <select id="scan-ex-tenant" className={fieldClass} value={tenantId} onChange={(event) => chooseTenant(event.target.value)} disabled={selectOptions.length === 0} aria-describedby="scan-ex-tenant-status" aria-busy={tenantsLoading}>
              {selectOptions.length === 0 ? <option value="">{t('scanExNoTenants')}</option> : null}
              {selectOptions.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
            </select>
            <div id="scan-ex-tenant-status" className="space-y-1 text-xs text-muted" aria-live="polite">
              {tenantsError ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-negative" role="alert">{tenantsError === 'more' ? t('scanExTenantsMoreFailed') : t('scanExTenantsFailed')}</span>
                  <Button variant="outline" className="h-11" onClick={retryTenants}>{t('retry')}</Button>
                </div>
              ) : tenantsLoading || tenantSearchPending ? (
                <span>{t('scanExTenantsLoading')}</span>
              ) : tenantOptions.length === 0 ? (
                <span>{appliedQuery === '' ? t('scanExNoTenants') : t('scanExTenantsNoMatch', { query: appliedQuery })}</span>
              ) : (
                <span>{t('scanExTenantsShowing', { shown: tenantOptions.length, total: tenantTotal })}</span>
              )}
              {!tenantsError && !tenantsLoading && !tenantSearchPending && tenantPage < tenantLastPage ? (
                <Button variant="outline" className="h-11 w-full" onClick={() => void loadTenants(appliedQuery, tenantPage + 1)}>{t('scanExTenantsMore')}</Button>
              ) : null}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scan-ex-reason">{t('scanExReason')}</Label>
            <Input id="scan-ex-reason" className="h-11" placeholder={t('scanExReasonPlaceholder')} value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scan-ex-expires">{t('scanExExpires')}</Label>
            <Input id="scan-ex-expires" className="h-11" type="datetime-local" dir="ltr" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scan-ex-password">{t('currentPassword')}</Label>
            <Input id="scan-ex-password" className="h-11" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
        </div>
        <div className="flex sm:justify-end">
          <Button className="h-11 w-full sm:w-auto" onClick={() => void grant()} disabled={!canGrant}>{busy && !revoking ? t('scanExGranting') : t('scanExGrant')}</Button>
        </div>

        {notice && (
          notice.ok
            ? <p role="status" className="text-sm text-positive">{notice.message}</p>
            : <p role="alert" className="text-sm text-negative">{notice.message}</p>
        )}

        {loading && items.length === 0 && !loadError ? (
          <div className="space-y-2" data-testid="scan-exceptions-skeleton"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
        ) : loadError ? (
          <div className="flex flex-wrap items-start gap-3">
            <p role="alert" className="min-w-0 flex-1 text-sm text-negative">{t('scanExLoadFailed')}</p>
            <Button variant="outline" className="h-11" onClick={() => void load()}>{t('retry')}</Button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">{t('scanExEmpty')}</p>
        ) : (
          <ul className="space-y-2" aria-busy={loading}>
            {items.map((item) => (
              <li key={item.id} className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-text">
                    <span className="break-words">{item.tenant_name ?? item.tenant_id}</span>
                    <Badge wrap tone={STATUS_TONE[item.status] ?? 'muted'}>{STATUS_KEY[item.status] ? t(STATUS_KEY[item.status]) : item.status}</Badge>
                  </p>
                  <p className="mt-1 break-words text-sm text-muted">{item.reason}</p>
                  <p className="mt-1 text-xs text-muted">
                    {item.expires_at ? t('scanExExpiresOn', { date: isolateAuto(formatDateTime(item.expires_at, locale)) }) : t('scanExNoExpiry')}
                  </p>
                </div>
                {item.status === 'active' && (
                  <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => openRevoke(item)} disabled={busy}>{t('scanExRevoke')}</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <ConfirmDialog
        open={revoking !== null}
        onCancel={closeRevoke}
        onConfirm={() => void revoke()}
        title={t('scanExRevokeTitle')}
        description={t('scanExRevokeDescription', { tenant: revoking?.tenant_name ?? revoking?.tenant_id ?? '' })}
        confirmLabel={busy ? t('scanExRevoking') : t('scanExRevokeConfirm')}
        cancelLabel={t('cancel')}
        closeLabel={t('close')}
        confirmVariant="danger"
        busy={busy}
        confirmDisabled={revokeReason.trim() === '' || revokePassword === ''}
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="scan-ex-revoke-reason">{t('scanExRevokeReason')}</Label>
            <Input id="scan-ex-revoke-reason" className="h-11" value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scan-ex-revoke-password">{t('currentPassword')}</Label>
            <Input id="scan-ex-revoke-password" className="h-11" type="password" autoComplete="current-password" value={revokePassword} onChange={(event) => setRevokePassword(event.target.value)} disabled={busy} />
          </div>
          {revokeError && <p role="alert" className="text-sm text-negative">{revokeError}</p>}
        </div>
      </ConfirmDialog>
    </Card>
  );
}

export default FileScanExceptions;
