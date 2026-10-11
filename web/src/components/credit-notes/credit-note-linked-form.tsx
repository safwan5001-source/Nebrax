'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberPreviewField } from '@/components/ui/number-preview-field';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { useNumberPreview } from '@/lib/use-number-preview';
import { formatRiyal } from '@/lib/money';
import {
  blockedReasonKey, buildLinkedBody, emptyInput, summarize,
  type LineInput, type ReturnableInvoice, type SourceInvoice,
} from './invoice-linked';

interface Partner { id: string; name: string; type?: string }

/**
 * إشعار دائن مرتبط بفاتورة مبيعات مرحَّلة: عميل ← فاتورة ← كميات (وسعر مخفَّض اختيارياً).
 * الصافي والضريبة والمعدل يشتقّها الخادم من سطر الفاتورة؛ الجدول هنا معاينة بالمُخصِّص نفسه.
 */
export function CreditNoteLinkedForm({ initialInvoiceId }: { initialInvoiceId?: string | null }) {
  const t = useTranslations('creditNotes');
  const tf = useTranslations('invoiceForm');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [sources, setSources] = useState<SourceInvoice[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [invoiceId, setInvoiceId] = useState('');
  const [invoice, setInvoice] = useState<ReturnableInvoice | null>(null);
  const [inputs, setInputs] = useState<Record<string, LineInput>>({});
  const [refundType, setRefundType] = useState('credit');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { number: suggestedNumber, loading: loadingNumber } = useNumberPreview('credit_note', { seriesKey: 'sales', date });

  const loadInvoice = useCallback(async (id: string) => {
    setInvoiceId(id);
    setInvoice(null);
    setInputs({});
    setError(null);
    if (!id) return;
    try {
      const r = await api<{ data: ReturnableInvoice }>(`/returns/returnable/sales/${id}`);
      setInvoice(r.data);
      return r.data;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('loadFailed'));
      setInvoiceId('');
    }
  }, [tc]);

  useEffect(() => {
    setDate(new Date().toISOString().slice(0, 10));
    // عميل أو «كلاهما»: فاتورة بيع قد تخصّ طرفاً من النوعين، والرابط العميق يحتاج وجوده في القائمة.
    api<{ data: Partner[] }>('/partners')
      .then((r) => setPartners(r.data.filter((p) => !p.type || ['customer', 'both'].includes(p.type))))
      .catch(() => {});
  }, []);

  // الرابط العميق: الفاتورة تحدّد عميلها، ثم يجلب مفعّل العميل قائمة مصادره.
  useEffect(() => {
    if (!initialInvoiceId) return;
    void loadInvoice(initialInvoiceId).then((inv) => { if (inv) setPartnerId(inv.partner_id); });
  }, [initialInvoiceId, loadInvoice]);

  useEffect(() => {
    if (!partnerId) { setSources([]); return; }
    setSourcesLoading(true);
    api<{ data: SourceInvoice[] }>(`/returns/sources/sales?partner_id=${partnerId}`)
      .then((r) => setSources(r.data))
      .catch(() => setSources([]))
      .finally(() => setSourcesLoading(false));
  }, [partnerId]);

  const summary = useMemo(() => summarize(invoice?.lines ?? [], inputs), [invoice, inputs]);
  const selectedSource = sources.find((s) => s.id === invoiceId);
  const blockedKey = blockedReasonKey(selectedSource?.blocked_reason);

  const setInput = (lineId: string, patch: Partial<LineInput>) =>
    setInputs((cur) => ({ ...cur, [lineId]: { ...emptyInput(), ...cur[lineId], ...patch } }));

  const canSave = !saving && !sourcesLoading && !!partnerId && !!invoice && !blockedKey && summary.itemCount > 0 && !summary.hasErrors;

  async function submit() {
    if (!invoice) return;
    if (summary.itemCount === 0) { setError(t('need_quantity')); return; }
    setSaving(true);
    setError(null);
    try {
      const created = await api<{ data: { id: string } }>('/credit-notes', {
        method: 'POST',
        body: buildLinkedBody({
          partnerId, invoiceId: invoice.id, refundType, noteDate: date, reason,
          lines: invoice.lines, inputs,
        }),
      });
      success(tc('created'));
      router.push(`/credit-notes/${created.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSaving(false);
    }
  }

  const invoiceLabel = (s: SourceInvoice) => {
    const base = [s.number, s.date, formatRiyal(s.total)].filter(Boolean).join(' · ');
    const key = blockedReasonKey(s.blocked_reason);
    return key ? `${base} — ${t(key)}` : base;
  };

  return (
    <>
      <Card>
        <CardHeader><CardTitle>{t('details')}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <NumberPreviewField id="credit-note-number" label={t('number')} number={suggestedNumber} loading={loadingNumber} />
            <div className="space-y-1.5">
              <Label htmlFor="partner">{t('partner')}</Label>
              <Select
                id="partner" value={partnerId} required
                onChange={(e) => { setPartnerId(e.target.value); void loadInvoice(''); }}
              >
                <option value="" disabled>{tf('choose_partner')}</option>
                {partners.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="source-invoice">{t('source_invoice')}</Label>
              <Select
                id="source-invoice" value={invoiceId} disabled={!partnerId || sourcesLoading}
                onChange={(e) => void loadInvoice(e.target.value)}
              >
                <option value="" disabled>{partnerId ? t('choose_invoice') : t('choose_partner_first')}</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id} disabled={!!s.blocked_reason}>{invoiceLabel(s)}</option>
                ))}
              </Select>
              {partnerId && !sourcesLoading && sources.length === 0 && (
                <p className="text-xs text-muted">{t('no_invoices')}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="refund">{t('refund_type')}</Label>
              <Select id="refund" value={refundType} onChange={(e) => setRefundType(e.target.value)}>
                <option value="credit">{t('refund_credit')}</option>
                <option value="cash">{t('refund_cash')}</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date">{t('date')}</Label>
              <Input id="date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="reason">{t('reason')}</Label>
              <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          {blockedKey && (
            <p className="mt-3 rounded bg-warning/10 px-3 py-2 text-xs text-warning" role="alert">
              {t('blocked_notice', { reason: t(blockedKey) })}
            </p>
          )}
        </CardContent>
      </Card>

      {invoice && (
        <Card>
          <CardHeader><CardTitle>{t('lines')}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-sm">
                <thead className="border-b border-border bg-muted/40 text-start text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">{t('col_item')}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t('col_sold')}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t('col_credited')}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t('col_remaining')}</th>
                    <th className="px-3 py-2.5 text-end font-medium">
                      {t('col_unit_price')}
                      {invoice.tax_inclusive && <Badge tone="muted" className="ms-1.5">{t('tax_inclusive')}</Badge>}
                    </th>
                    <th className="px-3 py-2.5 text-end font-medium">{t('col_qty')}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t('col_credit_price')}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t('col_net')}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t('col_tax')}</th>
                    <th className="px-3 py-2.5 text-end font-medium">{t('col_total')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoice.lines.map((l) => {
                    const id = l.source_line_id;
                    const done = l.remaining <= 0;
                    const e = summary.evaluations[id];
                    const input = inputs[id] ?? emptyInput();
                    const errorId = `line-error-${id}`;
                    return (
                      <tr key={id} className={done ? 'opacity-60' : undefined}>
                        <td className="px-3 py-2.5 align-top text-text">
                          <div className="max-w-[18rem]">{l.description || '—'}</div>
                          {l.reduced_price_returned && (
                            <p className="mt-1 flex items-start gap-1 text-xs leading-relaxed text-muted">
                              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.7} aria-hidden="true" />
                              {t('reduced_price_note')}
                            </p>
                          )}
                        </td>
                        <td className="num px-3 py-2.5 text-end align-top">{l.quantity}</td>
                        <td className="num px-3 py-2.5 text-end align-top">{l.returned}</td>
                        <td className="num px-3 py-2.5 text-end align-top font-medium">
                          {done ? <Badge tone="muted">{t('line_done')}</Badge> : l.remaining}
                        </td>
                        <td className="num px-3 py-2.5 text-end align-top">{formatRiyal(l.unit_price)}</td>
                        <td className="px-3 py-2.5 align-top">
                          <Label htmlFor={`qty-${id}`} className="sr-only">{t('col_qty')} — {l.description}</Label>
                          <Input
                            id={`qty-${id}`} className="num ms-auto w-20 text-end" dir="ltr" type="number"
                            min={0} max={l.remaining} step={1} disabled={done}
                            value={input.quantity} onChange={(ev) => setInput(id, { quantity: ev.target.value })}
                            aria-invalid={e.error === 'qty_invalid' || e.error === 'qty_above_remaining'}
                            aria-describedby={e.error ? errorId : undefined}
                          />
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <Label htmlFor={`price-${id}`} className="sr-only">{t('col_credit_price')} — {l.description}</Label>
                          <Input
                            id={`price-${id}`} className="num ms-auto w-28 text-end" dir="ltr" inputMode="decimal"
                            disabled={done} placeholder={l.unit_price}
                            value={input.price} onChange={(ev) => setInput(id, { price: ev.target.value })}
                            aria-invalid={e.error === 'price_invalid' || e.error === 'price_above_invoice'}
                            aria-describedby={e.error ? errorId : undefined}
                          />
                          {e.error && (
                            <p id={errorId} className="mt-1 text-end text-xs text-negative">
                              {t(`line_error_${e.error}`, { remaining: l.remaining, price: formatRiyal(l.unit_price) })}
                            </p>
                          )}
                        </td>
                        <td className="num px-3 py-2.5 text-end align-top">{e.quantity > 0 && !e.error ? formatRiyal(e.net / 100) : '—'}</td>
                        <td className="num px-3 py-2.5 text-end align-top">{e.quantity > 0 && !e.error ? formatRiyal(e.tax / 100) : '—'}</td>
                        <td className="num px-3 py-2.5 text-end align-top font-medium">{e.quantity > 0 && !e.error ? formatRiyal(e.total / 100) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border px-4 py-2.5 text-xs leading-relaxed text-muted">{t('preview_note')}</p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <Card className="lg:w-72">
          <CardContent className="space-y-1.5 p-4 text-sm">
            <div className="flex justify-between text-muted"><span>{t('subtotal')}</span><span className="num">{formatRiyal(summary.net / 100)}</span></div>
            <div className="flex justify-between text-muted"><span>{t('tax_total')}</span><span className="num">{formatRiyal(summary.tax / 100)}</span></div>
            <div className="flex justify-between border-t border-border pt-1.5"><span className="font-semibold text-text">{t('total')}</span><span className="num text-lg font-bold text-text">{formatRiyal(summary.total / 100)}</span></div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {error && <p className="self-center rounded bg-negative/10 px-3 py-2 text-xs text-negative" role="alert">{error}</p>}
          <Button disabled={!canSave} onClick={submit}>{t('save')}</Button>
        </div>
      </div>
    </>
  );
}
