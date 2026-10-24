'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { formatPayAmount } from '@/lib/pay-link';
import { useCan } from '@/lib/use-can';
import { formatSigned } from './format';
import { apiErrorCode, gatewayDisplayName, type GatewayConnection } from '@/modules/payments/gateways/contract';
import {
  VIEW_REFUNDS_PERMISSION, buildSettlementBody, differenceTone, expectedNet, feeTaxOpen, knownError, minorToInput, parseMinor, primaryAction, selectableAdjustment,
  type AdjustmentRow, type MoreMeta, type SettlementDetail, type SettlementPreview, type UnsettledPayment, type UnsettledRefund,
} from './contract';

interface BankAccount { id: string; name: string; type: 'cash' | 'bank'; is_active: boolean; is_main: boolean }
type Picked = Record<string, string>;   // id ⇒ مبلغ بالريال (نص قابل للتحرير)

const PREVIEW_DEBOUNCE_MS = 350;

/**
 * تسجيل تسوية بوابة (PAY-H3-02d، `payment_settlements.manage`). كل تغيير في المدخلات يُعيد **معاينة الخادم** (لا حساب محلي حاسم): المعادلة والفرق والحاجبات،
 * والزرّ الأساسي يتبع المعاينة وحدها — «ترحيل» إن كانت مطابقة، «حفظ كغير مطابقة» إن اختلف الصافي (لا قيد ولا استهلاك دفعات). المعاينة القديمة تُهمل بعدّاد.
 * حقول ضريبة الرسوم تظهر فقط إن فتح الخادم المسار (سياسة `input_vat` + الرأي الضريبي مسجَّل)؛ لا تفعيل لها من هنا أبداً.
 */
export function RecordSettlementDialog({ gateways, onClose, onDone }: { gateways: GatewayConnection[]; onClose: () => void; onDone: (s: SettlementDetail) => void }) {
  const t = useTranslations('paymentSettlements');
  const locale = useLocale();
  const toast = useToast();
  const { can } = useCan();
  const canViewRefunds = can(VIEW_REFUNDS_PERMISSION);

  const [gatewayId, setGatewayId] = useState('');
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [bankId, setBankId] = useState('');
  const [ref, setRef] = useState('');
  const [date, setDate] = useState('');
  const [net, setNet] = useState('');
  const [fee, setFee] = useState('');
  const [feeTax, setFeeTax] = useState('');
  const [feeTaxRef, setFeeTaxRef] = useState('');
  const [payments, setPayments] = useState<UnsettledPayment[]>([]);
  const [refunds, setRefunds] = useState<UnsettledRefund[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([]);
  const [pickedPayments, setPickedPayments] = useState<Picked>({});
  const [pickedRefunds, setPickedRefunds] = useState<Picked>({});
  const [pickedAdjustments, setPickedAdjustments] = useState<Set<string>>(new Set());
  const [loadingLists, setLoadingLists] = useState(false);
  const [listsFailed, setListsFailed] = useState(false);
  const [more, setMore] = useState(false);
  const [preview, setPreview] = useState<{ key: string; data: SettlementPreview } | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counter = useRef(0);

  const gateway = gateways.find((g) => g.id === gatewayId) ?? null;
  const taxOpen = feeTaxOpen(gateway);

  useEffect(() => {
    let live = true;
    api<{ data: BankAccount[] }>('/cash-bank-accounts')
      .then((res) => { if (live) setBanks(res.data.filter((b) => b.type === 'bank' && b.is_active)); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const main = banks.find((b) => b.is_main) ?? banks[0];
    if (main && bankId === '') setBankId(main.id);
  }, [banks, bankId]);

  // قوائم البوابة المختارة: الدفعات غير المسوّاة، الاستردادات غير المخصومة (بصلاحية عرضها فقط)، والتعديلات المعتمدة غير المستهلكة.
  useEffect(() => {
    setPickedPayments({}); setPickedRefunds({}); setPickedAdjustments(new Set()); setPayments([]); setRefunds([]); setAdjustments([]); setMore(false); setListsFailed(false);
    if (!gatewayId) return;
    let live = true;
    setLoadingLists(true);
    Promise.all([
      api<{ data: UnsettledPayment[]; meta: MoreMeta }>(`/payment-gateways/${gatewayId}/unsettled-payments?per_page=100`),
      canViewRefunds ? api<{ data: UnsettledRefund[]; meta: MoreMeta }>(`/payment-gateways/${gatewayId}/unsettled-refunds?per_page=100`) : Promise.resolve(null),
      api<{ data: AdjustmentRow[] }>(`/payment-gateway-adjustments?status=approved&payment_gateway_id=${gatewayId}&per_page=100`),
    ])
      .then(([p, r, a]) => {
        if (!live) return;
        setPayments(p.data);
        setRefunds(r?.data ?? []);
        setAdjustments(a.data.filter(selectableAdjustment));
        setMore(p.meta.has_more || (r?.meta.has_more ?? false));
      })
      .catch(() => { if (live) setListsFailed(true); })
      .finally(() => { if (live) setLoadingLists(false); });
    return () => { live = false; };
  }, [gatewayId, canViewRefunds]);

  const netMinor = net.trim() === '' ? null : parseMinor(net, true);
  const feeMinor = fee.trim() === '' ? 0 : parseMinor(fee, true);
  const feeTaxMinor = !taxOpen || feeTax.trim() === '' ? 0 : parseMinor(feeTax, true);

  const selection = useMemo(() => {
    let invalid = false;
    const items = Object.entries(pickedPayments).flatMap(([id, text]) => {
      const row = payments.find((p) => p.payment_id === id);
      const minor = parseMinor(text);
      if (!row || minor === null || minor > row.remaining) { invalid = true; return []; }
      return [{ payment_id: id, gross_amount: minor }];
    });
    const refundLines = Object.entries(pickedRefunds).flatMap(([id, text]) => {
      const row = refunds.find((r) => r.refund_id === id);
      const minor = parseMinor(text);
      if (!row || minor === null || minor > row.remaining) { invalid = true; return []; }
      return [{ payment_refund_id: id, amount_minor: minor }];
    });
    return { items, refunds: refundLines, invalid };
  }, [pickedPayments, pickedRefunds, payments, refunds]);

  const amountsInvalid = (net.trim() !== '' && netMinor === null) || feeMinor === null || feeTaxMinor === null;
  const body = useMemo(
    () => (amountsInvalid || selection.invalid ? null : buildSettlementBody({
      gatewayId, bankId, ref, date, netMinor, feeMinor: feeMinor ?? 0, feeTaxMinor: feeTaxMinor ?? 0, feeTaxInvoiceRef: taxOpen ? feeTaxRef : '',
      items: selection.items, refunds: selection.refunds, adjustmentIds: [...pickedAdjustments],
    })),
    [amountsInvalid, selection, gatewayId, bankId, ref, date, netMinor, feeMinor, feeTaxMinor, taxOpen, feeTaxRef, pickedAdjustments],
  );
  const bodyKey = body === null ? null : JSON.stringify(body);

  // معاينة مؤجَّلة؛ كل استجابة تحمل مفتاح جسمها فلا تُطبَّق قديمة على مدخلات أحدث.
  useEffect(() => {
    setError(null);
    if (bodyKey === null) { setPreview(null); setPreviewFailed(false); return; }
    const mine = ++counter.current;
    const timer = setTimeout(() => {
      api<{ data: SettlementPreview }>('/payment-gateway-settlements/preview', { method: 'POST', body: JSON.parse(bodyKey) })
        .then((res) => { if (mine === counter.current) { setPreview({ key: bodyKey, data: res.data }); setPreviewFailed(false); } })
        .catch((e) => { if (mine === counter.current) { setPreview(null); setPreviewFailed(true); setError(t(`error_${knownError(apiErrorCode(e))}` as 'error_unknown')); } });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [bodyKey, t]);

  const fresh = preview !== null && preview.key === bodyKey ? preview.data : null;
  const action = primaryAction(fresh);

  async function submit() {
    if (bodyKey === null || action === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ data: SettlementDetail }>('/payment-gateway-settlements', { method: 'POST', body: JSON.parse(bodyKey) });
      toast.success(t(res.data.status === 'posted' ? 'done_posted' : 'done_unreconciled'));
      onDone(res.data);
    } catch (e) {
      setError(t(`error_${knownError(apiErrorCode(e))}` as 'error_unknown'));
      setSaving(false);
    }
  }

  const toggle = (picked: Picked, set: (p: Picked) => void, id: string, remaining: number) => {
    const next = { ...picked };
    if (id in next) delete next[id]; else next[id] = minorToInput(remaining);
    set(next);
  };
  const currency = refunds[0]?.currency ?? 'SAR';
  const money = (minor: number) => <bdi dir="ltr">{formatPayAmount(minor, currency)}</bdi>;

  return (
    <Dialog open title={t('record_title')} onClose={() => { if (!saving) onClose(); }} closeLabel={t('close')} className="max-w-3xl">
      <div className="space-y-4">
        <p className="text-sm leading-6 text-muted">{t('record_intro')}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rs-gateway">{t('field_gateway')}</Label>
            <Select id="rs-gateway" value={gatewayId} onChange={(e) => setGatewayId(e.target.value)}>
              <option value="">{t('choose')}</option>
              {gateways.map((g) => <option key={g.id} value={g.id}>{gatewayDisplayName(g, locale)}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rs-bank">{t('field_bank')}</Label>
            <Select id="rs-bank" value={bankId} onChange={(e) => setBankId(e.target.value)}>
              <option value="">{t('choose')}</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rs-ref">{t('field_ref')}</Label>
            <Input id="rs-ref" dir="ltr" value={ref} maxLength={191} onChange={(e) => setRef(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rs-date">{t('field_date')}</Label>
            <Input id="rs-date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rs-net">{t('field_net')}</Label>
            <Input id="rs-net" inputMode="decimal" dir="ltr" value={net} onChange={(e) => setNet(e.target.value)} aria-invalid={net.trim() !== '' && netMinor === null} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rs-fee">{t('field_fee')}</Label>
            <Input id="rs-fee" inputMode="decimal" dir="ltr" value={fee} onChange={(e) => setFee(e.target.value)} aria-invalid={feeMinor === null} />
          </div>
          {taxOpen ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="rs-fee-tax">{t('field_fee_tax')}</Label>
                <Input id="rs-fee-tax" inputMode="decimal" dir="ltr" value={feeTax} onChange={(e) => setFeeTax(e.target.value)} aria-invalid={feeTaxMinor === null} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rs-fee-tax-ref">{t('field_fee_tax_ref')}</Label>
                <Input id="rs-fee-tax-ref" dir="ltr" value={feeTaxRef} maxLength={191} onChange={(e) => setFeeTaxRef(e.target.value)} />
              </div>
            </>
          ) : (
            gatewayId !== '' && <p role="note" className="text-xs leading-5 text-muted sm:col-span-2">{t('fee_tax_closed')}</p>
          )}
        </div>

        {gatewayId !== '' && (
          <>
            {loadingLists && <p role="status" className="text-sm text-muted">{t('loading')}</p>}
            {listsFailed && <p role="alert" className="text-sm text-negative">{t('load_failed')}</p>}
            {more && <p role="note" className="text-xs text-warning">{t('lists_truncated')}</p>}
            <PickList
              title={t('payments_title')} empty={t('payments_empty')} testId="rs-payments"
              rows={payments.map((p) => ({ id: p.payment_id, label: p.number ?? p.payment_id.slice(0, 8), remaining: p.remaining }))}
              picked={pickedPayments} format={money} t={t}
              onToggle={(id, remaining) => toggle(pickedPayments, setPickedPayments, id, remaining)}
              onEdit={(id, text) => setPickedPayments({ ...pickedPayments, [id]: text })}
              limit={(id) => payments.find((p) => p.payment_id === id)?.remaining ?? 0}
            />
            {canViewRefunds && (
              <PickList
                title={t('refunds_title')} empty={t('refunds_empty')} testId="rs-refunds"
                rows={refunds.map((r) => ({ id: r.refund_id, label: r.number ?? r.refund_id.slice(0, 8), remaining: r.remaining }))}
                picked={pickedRefunds} format={money} t={t}
                onToggle={(id, remaining) => toggle(pickedRefunds, setPickedRefunds, id, remaining)}
                onEdit={(id, text) => setPickedRefunds({ ...pickedRefunds, [id]: text })}
                limit={(id) => refunds.find((r) => r.refund_id === id)?.remaining ?? 0}
              />
            )}
            <section aria-labelledby="rs-adj" className="space-y-2" data-testid="rs-adjustments">
              <h3 id="rs-adj" className="text-sm font-semibold">{t('adjustments_title')}</h3>
              {adjustments.length === 0 ? <p className="text-sm text-muted">{t('adjustments_empty')}</p> : (
                <ul className="divide-y divide-border rounded border border-border text-sm">
                  {adjustments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <label className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox" checked={pickedAdjustments.has(a.id)}
                          onChange={() => { const next = new Set(pickedAdjustments); if (next.has(a.id)) next.delete(a.id); else next.add(a.id); setPickedAdjustments(next); }}
                        />
                        <span className="min-w-0 truncate">{t(`kind_${a.kind}` as 'kind_reserve_hold')} · <bdi dir="ltr">{a.evidence_ref}</bdi></span>
                      </label>
                      <bdi dir="ltr">{formatPayAmount(a.amount_minor, a.currency)}</bdi>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {fresh && <PreviewSummary preview={fresh} currency={currency} money={money} t={t} />}
        {fresh?.replay && fresh.existing_status && (
          <p role="note" className="rounded border border-border bg-muted/5 p-3 text-xs leading-5 text-muted">{t(fresh.existing_status === 'posted' ? 'replay_posted' : 'replay_draft')}</p>
        )}
        {action === 'unreconciled' && <p role="note" className="rounded border border-warning/30 bg-warning/5 p-3 text-sm leading-6 text-warning">{t('unreconciled_explain')}</p>}
        {previewFailed && !error && <p role="alert" className="text-sm text-negative">{t('preview_failed')}</p>}
        {error && <p role="alert" className="text-sm text-negative">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>{t('cancel')}</Button>
          <Button onClick={() => void submit()} disabled={saving || action === null} aria-busy={saving}>
            {saving ? t('saving') : action === 'unreconciled' ? t('submit_unreconciled') : t('submit_post')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function PickList({ title, empty, rows, picked, format, onToggle, onEdit, limit, t, testId }: {
  title: string; empty: string; testId: string;
  rows: { id: string; label: string; remaining: number }[];
  picked: Picked; format: (minor: number) => React.ReactNode;
  onToggle: (id: string, remaining: number) => void; onEdit: (id: string, text: string) => void; limit: (id: string) => number;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <section aria-label={title} className="space-y-2" data-testid={testId}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-muted">{empty}</p> : (
        <ul className="divide-y divide-border rounded border border-border text-sm">
          {rows.map((r) => {
            const on = r.id in picked;
            const minor = on ? parseMinor(picked[r.id]) : null;
            const bad = on && (minor === null || minor > limit(r.id));
            return (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <label className="flex min-w-0 items-center gap-2">
                  <input type="checkbox" checked={on} onChange={() => onToggle(r.id, r.remaining)} aria-label={r.label} />
                  <bdi dir="ltr" className="truncate">{r.label}</bdi>
                </label>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted">{t('remaining')} {format(r.remaining)}</span>
                  {on && <Input aria-label={`${r.label} ${t('amount')}`} inputMode="decimal" dir="ltr" className="w-28" value={picked[r.id]} onChange={(e) => onEdit(r.id, e.target.value)} aria-invalid={bad} />}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PreviewSummary({ preview, currency, money, t }: { preview: SettlementPreview; currency: string; money: (minor: number) => React.ReactNode; t: ReturnType<typeof useTranslations> }) {
  const expected = expectedNet(preview);
  return (
    <section aria-labelledby="rs-preview" className="space-y-2 rounded border border-border p-3" data-testid="rs-preview">
      <h3 id="rs-preview" className="text-sm font-semibold">{t('preview_title')}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <Row label={t('preview_gross')} value={preview.gross === null ? '—' : money(preview.gross)} />
        <Row label={t('preview_refunds')} value={preview.refunds_total === null ? '—' : money(-preview.refunds_total)} />
        <Row label={t('preview_fee')} value={money(-preview.provider_fee_ex_tax)} />
        {preview.provider_fee_tax > 0 && <Row label={t('preview_fee_tax')} value={money(-preview.provider_fee_tax)} />}
        {(preview.adjustments_deductions ?? 0) > 0 && <Row label={t('preview_adj_deductions')} value={money(-(preview.adjustments_deductions ?? 0))} />}
        {(preview.adjustments_credits ?? 0) > 0 && <Row label={t('preview_adj_credits')} value={money(preview.adjustments_credits ?? 0)} />}
        <Row label={t('preview_expected')} value={expected === null ? '—' : money(expected)} strong />
        <Row label={t('preview_entered')} value={money(preview.net_bank_amount)} strong />
      </dl>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">{t('preview_difference')}</span>
        <Badge tone={differenceTone(preview.difference)}>{preview.difference === null ? '—' : <bdi dir="ltr">{formatSigned(preview.difference, currency)}</bdi>}</Badge>
        {preview.reconciled && <Badge tone="positive">{t('preview_reconciled')}</Badge>}
      </div>
      {preview.blockers.length > 0 && (
        <ul className="space-y-1 text-xs leading-5 text-warning" aria-label={t('preview_blockers')}>
          {preview.blockers.map((b, i) => (
            // رموز قابلة للتكرار (role_unmapped لكل دور) ⇒ مفتاح بالترتيب، ورسالة الخادم تسمّي الدور فتُعرض بدل النص العام.
            <li key={`${b.code}-${i}`}>{b.code !== 'role_unmapped' && t.has(`error_${b.code}` as 'error_unknown') ? t(`error_${b.code}` as 'error_unknown') : b.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ label, value, strong = false }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className={strong ? 'font-medium' : undefined}>{value}</dd>
    </>
  );
}
