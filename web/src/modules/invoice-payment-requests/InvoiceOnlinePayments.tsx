'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Copy, CreditCard, LoaderCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { api, hasApiStatus } from '@/lib/api';
import { formatDateTime } from '@/lib/formatting';
import { isDemo } from '@/lib/demo';
import { useCan } from '@/lib/use-can';
import { apiErrorCode, gatewayDisplayName, type GatewayConnection } from '@/modules/payments/gateways/contract';
import {
  EXPIRY_OPTIONS, MANAGE_PERMISSION, VIEW_PERMISSION, attemptPhase, buildPayUrl, canCancel, canIssueLink, expiryMinutes, hasOpenRequest,
  knownError, phaseTone, statusTone, usableGateways, type ExpiryKey, type OnlineRequest,
} from './contract';

/**
 * قسم «الدفع الإلكتروني» في تفاصيل الفاتورة (PAY-H2-03b): طلبات الدفع للفاتورة، إنشاء طلب (اتصال، جزئي D-16، مدة)، إصدار الرابط العام مرة واحدة
 * (يُنسخ فوراً ولا يُعرض ثانيةً)، وإلغاء. **القراءة** `payments.view`، **الكتابة** `payments.manage`؛ الخادم هو الحاسم (الإخفاء هنا راحة لا أمن).
 * لا يظهر القسم أصلاً: لفاتورة غير مرحَّلة/مسدَّدة بلا طلبات، أو لمن لا يملك القراءة، أو لمؤسسة بلا اتصال دفع صالح وبلا طلبات سابقة.
 * لا أثر محاسبي هنا: الترحيل يتم عند التقاط المزوّد (H2-02c) ويظهر في حالة «آخر دفعة».
 */
export function InvoiceOnlinePayments({ invoiceId, invoicePosted, fullyPaid }: { invoiceId: string; invoicePosted: boolean; fullyPaid: boolean }) {
  const t = useTranslations('invoiceOnlinePay');
  const locale = useLocale();
  const { can } = useCan();
  const toast = useToast();
  const confirm = useConfirm();
  // المعاينة (demo) بلا خادم دفع: القسم غائب بدل أن يدّعي قدرة غير موجودة.
  const demo = isDemo();
  const canView = can(VIEW_PERMISSION) && !demo;
  const canManage = can(MANAGE_PERMISSION);

  const [requests, setRequests] = useState<OnlineRequest[] | null>(null);
  const [gateways, setGateways] = useState<GatewayConnection[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [linkFor, setLinkFor] = useState<{ id: string; url: string | null; error: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const response = await api<{ data: OnlineRequest[] }>(`/invoices/${invoiceId}/payment-requests`);
      setRequests(response.data);
    } catch (e) {
      if (hasApiStatus(e, 403)) setRequests([]);
      else setLoadFailed(true);
    }
  }, [invoiceId]);

  useEffect(() => {
    if (canView && invoicePosted) void load();
  }, [canView, invoicePosted, load]);

  useEffect(() => {
    if (!canManage || !invoicePosted) return;
    api<{ data: GatewayConnection[] }>('/payment-gateways').then((r) => setGateways(usableGateways(r.data))).catch(() => setGateways([]));
  }, [canManage, invoicePosted]);

  if (!canView || !invoicePosted) return null;
  if (requests === null && !loadFailed) return <section aria-label={t('title')}><p className="text-sm text-muted">{t('loading')}</p></section>;

  const list = requests ?? [];
  const canCreate = canManage && !fullyPaid && !hasOpenRequest(list) && gateways.length > 0;
  // مؤسسة بلا اتصال صالح وبلا طلبات سابقة: لا ضجيج.
  if (!loadFailed && list.length === 0 && !canCreate) return null;

  const message = (code: string | null) => t(`error_${knownError(code)}` as 'error_unknown');

  async function issueLink(request: OnlineRequest) {
    setCopied(false);
    setLinkFor({ id: request.id, url: null, error: null });
    try {
      const response = await api<{ data: { token: string } }>(`/payment-requests/${request.id}/link`, { method: 'POST', body: {} });
      setLinkFor({ id: request.id, url: buildPayUrl(window.location.origin, response.data.token), error: null });
      void load();
    } catch (e) {
      setLinkFor({ id: request.id, url: null, error: message(apiErrorCode(e)) });
    }
  }

  async function cancelRequest(request: OnlineRequest) {
    const ok = await confirm({ title: t('cancel_title'), message: t('cancel_message'), confirmLabel: t('cancel_confirm'), tone: 'danger' });
    if (!ok) return;
    setBusy(request.id);
    try {
      await api(`/payment-requests/${request.id}/cancel`, { method: 'POST', body: {} });
      toast.success(t('cancelled_ok'));
      await load();
    } catch (e) {
      toast.error(message(apiErrorCode(e)));
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    if (!linkFor?.url) return;
    try {
      await navigator.clipboard.writeText(linkFor.url);
      setCopied(true);
    } catch {
      // النسخ اليدوي من الحقل يبقى متاحاً.
    }
  }

  return (
    <section aria-label={t('title')} className="no-print">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-64">
            <CardTitle className="flex items-center gap-2"><CreditCard className="h-4 w-4" aria-hidden />{t('title')}</CardTitle>
            <p className="mt-1 text-xs leading-5 text-muted">{t('subtitle')}</p>
          </div>
          {canCreate && <Button size="sm" className="shrink-0" onClick={() => setCreating(true)}>{t('new_request')}</Button>}
        </CardHeader>
        <CardContent>
          {loadFailed && (
            <div role="alert" className="flex items-center justify-between gap-3 text-sm text-negative">
              <span>{t('load_failed')}</span>
              <Button size="sm" variant="outline" onClick={() => void load()}>{t('retry')}</Button>
            </div>
          )}
          {!loadFailed && list.length === 0 && <p className="text-sm text-muted">{t('empty')}</p>}
          {list.length > 0 && (
            <ul className="divide-y divide-border">
              {list.map((request) => {
                const phase = attemptPhase(request.latest_attempt);
                const reasons = request.latest_attempt?.review_reasons ?? [];
                return (
                  <li key={request.id} className="grid gap-3 py-3 first:pt-0 last:pb-0 md:grid-cols-[auto_1fr_auto] md:items-center" data-testid="online-request-row">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={statusTone(request.status)}>{t(`status_${request.status}` as 'status_open')}</Badge>
                      <span className="text-xs text-muted">{request.allow_partial ? t('mode_partial') : t('mode_full')}</span>
                    </div>
                    <div className="min-w-0 space-y-1 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted">{t('col_payment')}:</span>
                        <Badge tone={phaseTone(phase)}>{t(`phase_${phase}` as 'phase_none')}</Badge>
                        {reasons.includes('overpayment') && <Badge tone="warning">{t('overpayment')}</Badge>}
                        {reasons.includes('late_capture') && <Badge tone="warning">{t('late_capture')}</Badge>}
                      </div>
                      <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                        <div className="flex gap-1"><dt>{t('col_created')}</dt><dd><bdi>{request.created_at ? formatDateTime(request.created_at, locale) : '—'}</bdi></dd></div>
                        <div className="flex gap-1"><dt>{t('col_expires')}</dt><dd>{request.expires_at ? <bdi>{formatDateTime(request.expires_at, locale)}</bdi> : t('no_expiry')}</dd></div>
                      </dl>
                    </div>
                    {canManage && (
                      <div className="flex flex-wrap items-center gap-2 md:justify-end">
                        {request.status === 'open' && (canIssueLink(request)
                          ? <Button size="sm" variant="outline" onClick={() => void issueLink(request)}>{t('action_link')}</Button>
                          : <span className="text-xs text-muted">{t('action_link_done')}</span>)}
                        {canCancel(request) && (
                          <Button size="sm" variant="ghost" disabled={busy === request.id} onClick={() => void cancelRequest(request)}>{t('action_cancel')}</Button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {creating && (
        <CreateDialog
          invoiceId={invoiceId}
          gateways={gateways}
          locale={locale}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            toast.success(t('created_ok'));
            void load();
            void issueLink(created);
          }}
          message={message}
        />
      )}

      {linkFor && (
        <Dialog open title={t('link_title')} onClose={() => setLinkFor(null)} closeLabel={t('link_close')}>
          <div className="space-y-3">
            {linkFor.error ? (
              <p role="alert" className="text-sm text-negative">{linkFor.error}</p>
            ) : linkFor.url === null ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />{t('link_generating')}</p>
            ) : (
              <>
                <p className="text-sm leading-6 text-warning">{t('link_once')}</p>
                <Input readOnly dir="ltr" className="text-start" value={linkFor.url} onFocus={(e) => e.currentTarget.select()} aria-label={t('link_title')} />
                <div className="flex flex-wrap justify-end gap-2">
                  <Button onClick={() => void copyLink()}>
                    {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                    {copied ? t('link_copied') : t('link_copy')}
                  </Button>
                  <Button variant="outline" onClick={() => setLinkFor(null)}>{t('link_close')}</Button>
                </div>
              </>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}

function CreateDialog({
  invoiceId, gateways, locale, onClose, onCreated, message,
}: {
  invoiceId: string;
  gateways: GatewayConnection[];
  locale: string;
  onClose: () => void;
  onCreated: (request: OnlineRequest) => void;
  message: (code: string | null) => string;
}) {
  const t = useTranslations('invoiceOnlinePay');
  const [gatewayId, setGatewayId] = useState(gateways[0]?.id ?? '');
  const [allowPartial, setAllowPartial] = useState(false);
  const [expiry, setExpiry] = useState<ExpiryKey>('d7');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    const minutes = expiryMinutes(expiry);
    try {
      const response = await api<{ data: OnlineRequest }>(`/invoices/${invoiceId}/payment-requests`, {
        method: 'POST',
        body: { payment_gateway_id: gatewayId, allow_partial: allowPartial, ...(minutes === null ? {} : { expires_in_minutes: minutes }) },
      });
      onCreated(response.data);
    } catch (e) {
      setError(message(apiErrorCode(e)));
      setSaving(false);
    }
  }

  return (
    <Dialog open title={t('create_title')} onClose={onClose}>
      <div className="space-y-4">
        {gateways.length === 0 ? (
          <p className="text-sm text-muted">
            {t('no_gateway')} <Link href="/finance-settings/payments?tab=gateways" className="text-primary hover:underline">{t('go_settings')}</Link>
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="online-gateway">{t('create_gateway')}</Label>
              <Select id="online-gateway" value={gatewayId} onChange={(e) => setGatewayId(e.target.value)}>
                {gateways.map((g) => <option key={g.id} value={g.id}>{gatewayDisplayName(g, locale)}</option>)}
              </Select>
              <p className="text-xs text-muted">{t('create_gateway_hint')}</p>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="online-partial">{t('create_partial')}</Label>
                <p className="mt-1 text-xs leading-5 text-muted">{t('create_partial_hint')}</p>
              </div>
              <Switch id="online-partial" checked={allowPartial} onCheckedChange={setAllowPartial} aria-label={t('create_partial')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="online-expiry">{t('create_expiry')}</Label>
              <Select id="online-expiry" value={expiry} onChange={(e) => setExpiry(e.target.value as ExpiryKey)}>
                {EXPIRY_OPTIONS.map((o) => <option key={o.key} value={o.key}>{t(`expiry_${o.key === 'none' ? 'none' : o.key}` as 'expiry_none')}</option>)}
              </Select>
            </div>
          </>
        )}
        {error && <p role="alert" className="text-sm text-negative">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('create_cancel')}</Button>
          {gateways.length > 0 && (
            <Button onClick={() => void submit()} disabled={saving || gatewayId === ''} aria-busy={saving}>
              {saving ? t('creating') : t('create_submit')}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
