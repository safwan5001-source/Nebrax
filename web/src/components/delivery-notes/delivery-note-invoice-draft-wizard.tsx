'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2, CircleAlert, FileText, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { formatMinorRiyal, minorToRiyal, riyalToMinor } from '@/lib/money';
import { DELIVERY_NOTE_PERMISSIONS, hasPermission, type DeliveryNote } from '@/lib/delivery-notes';

interface PriceList { id: string; name: string; is_active: boolean }
interface PreviewLine {
  id: string;
  line_number: number;
  product_id: string;
  product_name: string;
  unit_name: string;
  unit_factor: number;
  quantity: number;
  quantity_numerator: number | null;
  quantity_denominator: number | null;
  suggested_unit_price: number | null;
  suggested_tax_rate: number | null;
  recommended_price_list_id: string | null;
}
interface PreviewNote {
  id: string;
  number?: string;
  version?: number;
  customer_id?: string;
  customer_name?: string | null;
  warehouse_id?: string;
  warehouse_name?: string | null;
  delivery_date?: string | null;
  eligible: boolean;
  issues: string[];
  lines?: PreviewLine[];
}
interface DraftPreview {
  delivery_notes: PreviewNote[];
  compatible: boolean;
  compatibility_issues: string[];
  pricing_required: boolean;
  source_line_count?: number;
  source_line_limit?: number;
  requested_price_list_id: string | null;
}
interface PricingDecision {
  unitPrice: string;
  taxRate: string;
  discount: string;
  minimumPriceOverrideReason: string;
}
interface BuiltInvoice { id: string; number?: string; status?: string }

function newKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `delivery-draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function lineQuantity(line: PreviewLine): string {
  return line.quantity_numerator && line.quantity_denominator
    ? `${line.quantity_numerator}/${line.quantity_denominator}`
    : String(line.quantity);
}

function issueKey(issue: string): string {
  return `issue_${issue}`;
}

/**
 * معالج واحد صريح المصدر: لا يعيد استعمال نموذج فاتورة عادي ولا يعرض زر ترحيل.
 * يمكن الوصول إليه من قائمة/تفصيل سندات التسليم ومن نموذج فاتورة جديد عبر route
 * واحد، بينما يبقى قرار الإنشاء الفعلي حصراً في endpoint الباني الخلفي.
 */
export function DeliveryNoteInvoiceDraftWizard() {
  const t = useTranslations('deliveryNotes');
  const tc = useTranslations('common');
  const searchParams = useSearchParams();
  const user = currentUser();
  const canInvoice = hasPermission(user?.permissions, user?.role, DELIVERY_NOTE_PERMISSIONS.invoice);
  const canViewInvoices = hasPermission(user?.permissions, user?.role, 'invoices.view');
  const initialIds = useMemo(
    () => (searchParams.get('notes') ?? '').split(',').map((value) => value.trim()).filter(Boolean).slice(0, 50),
    [searchParams],
  );
  const [notes, setNotes] = useState<DeliveryNote[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [priceListError, setPriceListError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialIds);
  const [priceListId, setPriceListId] = useState('');
  const [preview, setPreview] = useState<DraftPreview | null>(null);
  const [pricing, setPricing] = useState<Record<string, PricingDecision>>({});
  const [reason, setReason] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [built, setBuilt] = useState<{ invoice: BuiltInvoice; replay: boolean } | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const loadNotes = useCallback(() => {
    setLoading(true);
    setError(null);
    setPriceListError(null);

    api<{ data: DeliveryNote[] }>('/delivery-notes?status=confirmed&per_page=100&sort=delivery_date&direction=desc')
      .then((noteResult) => {
        setNotes(noteResult.data);
        return api<{ data: PriceList[] }>('/price-lists')
          .then((priceListResult) => setPriceLists(priceListResult.data.filter((priceList) => priceList.is_active)))
          .catch((caught) => {
            setPriceLists([]);
            setPriceListId('');
            setPriceListError(caught instanceof ApiError ? caught.message : t('invoiceDraftPriceListsUnavailable'));
          });
      })
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : tc('saveFailed')))
      .finally(() => setLoading(false));
  }, [t, tc]);

  useEffect(() => {
    if (canInvoice) loadNotes();
  }, [canInvoice, loadNotes]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const selectedNoteIds = useMemo(() => [...selectedIds].sort(), [selectedIds]);
  const previewRows = useMemo(() => preview?.delivery_notes ?? [], [preview]);
  const allPreviewEligible = preview !== null && preview.compatible && previewRows.length === selectedNoteIds.length && previewRows.every((note) => note.eligible);

  function toggleNote(note: DeliveryNote): void {
    if (note.invoice_draft) return;
    setBuilt(null);
    setPreview(null);
    setPricing({});
    setError(null);
    setSelectedIds((current) => current.includes(note.id) ? current.filter((id) => id !== note.id) : [...current, note.id]);
  }

  async function runPreview(): Promise<void> {
    if (selectedNoteIds.length === 0) {
      setError(t('invoiceDraftNeedSelection'));
      return;
    }
    setPreviewing(true);
    setBuilt(null);
    setError(null);
    try {
      const response = await api<{ data: DraftPreview }>('/delivery-notes/invoice-draft/preview', {
        method: 'POST',
        body: {
          delivery_note_ids: selectedNoteIds,
          ...(priceListId ? { price_list_id: priceListId } : {}),
        },
      });
      setPreview(response.data);
      const nextPricing: Record<string, PricingDecision> = {};
      response.data.delivery_notes.forEach((note) => note.lines?.forEach((line) => {
        nextPricing[line.id] = {
          unitPrice: line.suggested_unit_price === null ? '' : minorToRiyal(line.suggested_unit_price),
          taxRate: String(line.suggested_tax_rate ?? 15),
          discount: '0.00',
          minimumPriceOverrideReason: '',
        };
      }));
      setPricing(nextPricing);
    } catch (caught) {
      setPreview(null);
      setPricing({});
      setError(caught instanceof ApiError ? caught.message : tc('saveFailed'));
    } finally {
      setPreviewing(false);
    }
  }

  function patchPricing(lineId: string, patch: Partial<PricingDecision>): void {
    setPricing((current) => ({ ...current, [lineId]: { ...current[lineId], ...patch } }));
    setBuilt(null);
  }

  const pricingValid = useMemo(() => previewRows.every((note) => note.lines?.every((line) => {
    const decision = pricing[line.id];
    if (!decision) return false;
    const price = riyalToMinor(decision.unitPrice);
    const discount = riyalToMinor(decision.discount);
    const tax = Number(decision.taxRate);
    return Number.isInteger(price) && price > 0
      && Number.isInteger(discount) && discount >= 0
      && Number.isInteger(tax) && tax >= 0 && tax <= 100;
  }) ?? false), [previewRows, pricing]);

  async function buildDraft(): Promise<void> {
    if (!preview || !allPreviewEligible || !pricingValid || !reason.trim()) {
      setError(t('invoiceDraftCompletePricing'));
      return;
    }
    setBuilding(true);
    setError(null);
    try {
      const response = await api<{ data: BuiltInvoice; meta: { idempotent_replay: boolean } }>('/delivery-notes/invoice-draft', {
        method: 'POST',
        body: {
          delivery_note_ids: selectedNoteIds,
          expected_versions: Object.fromEntries(previewRows.map((note) => [note.id, note.version])),
          idempotency_key: idempotencyKey,
          reason: reason.trim(),
          invoice_date: invoiceDate,
          due_date: dueDate || null,
          notes: invoiceNotes.trim() || null,
          tax_inclusive: taxInclusive,
          ...(priceListId ? { price_list_id: priceListId } : {}),
          line_pricing: previewRows.flatMap((note) => (note.lines ?? []).map((line) => {
            const decision = pricing[line.id];
            return {
              delivery_note_line_id: line.id,
              unit_price: riyalToMinor(decision.unitPrice),
              tax_rate: Number(decision.taxRate),
              discount: riyalToMinor(decision.discount),
              ...(decision.minimumPriceOverrideReason.trim()
                ? { minimum_price_override_reason: decision.minimumPriceOverrideReason.trim() }
                : {}),
            };
          })),
        },
      });
      setBuilt({ invoice: response.data, replay: response.meta.idempotent_replay });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tc('saveFailed'));
    } finally {
      setBuilding(false);
    }
  }

  if (!canInvoice) {
    return <section className="rounded border border-negative/30 bg-negative/10 p-5" role="alert">
      <h1 className="text-lg font-semibold text-text">{t('invoiceDraftPermissionTitle')}</h1>
      <p className="mt-2 text-sm text-muted">{t('invoiceDraftPermissionHint')}</p>
      <Button asChild variant="outline" className="mt-4"><Link href="/delivery-notes">{t('backToList')}</Link></Button>
    </section>;
  }

  return <div className="space-y-5 pb-28 lg:pb-6">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted"><Link className="hover:text-text hover:underline" href="/delivery-notes">{t('backToList')}</Link><span aria-hidden="true">/</span><span>{t('invoiceDraftBreadcrumb')}</span></div>
        <h1 className="mt-2 text-xl font-semibold text-text">{t('invoiceDraftTitle')}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t('invoiceDraftSubtitle')}</p>
      </div>
      {canViewInvoices && <Button asChild variant="outline"><Link href="/invoices/new"><FileText className="h-4 w-4" strokeWidth={1.7} />{t('invoiceDraftGenericInvoice')}</Link></Button>}
    </header>

    <section className="rounded border border-primary/25 bg-primary-soft/40 p-4 text-sm text-text">
      <div className="flex gap-3"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} /><div><strong>{t('invoiceDraftBoundaryTitle')}</strong><p className="mt-1 text-muted">{t('invoiceDraftBoundaryHint')}</p></div></div>
    </section>

    {error && <div ref={errorRef} tabIndex={-1} role="alert" className="rounded border border-negative/30 bg-negative/10 p-4 text-sm text-negative">{error}</div>}

    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0"><div><CardTitle>{t('invoiceDraftSelectTitle')}</CardTitle><p className="mt-1 text-sm font-normal text-muted">{t('invoiceDraftSelectHint')}</p></div><Badge tone="muted">{t('invoiceDraftSelectedCount', { count: selectedIds.length })}</Badge></CardHeader>
      <CardContent className="space-y-3">
        {loading ? <div className="flex items-center gap-2 py-8 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />{t('loading')}</div> : <>
          <div className="hidden overflow-x-auto rounded border border-border md:block"><table className="w-full text-sm"><thead className="bg-muted/40 text-start text-xs text-muted"><tr><th className="w-12 px-3 py-3"><span className="sr-only">{t('invoiceDraftSelectTitle')}</span></th><th className="px-3 py-3">{t('number')}</th><th className="px-3 py-3">{t('customer')}</th><th className="px-3 py-3">{t('warehouse')}</th><th className="px-3 py-3">{t('deliveryDate')}</th><th className="px-3 py-3">{t('invoiceDraftAvailability')}</th></tr></thead><tbody>{notes.map((note) => {
            const unavailable = !!note.invoice_draft;
            return <tr key={note.id} className="border-t border-border"><td className="px-3 py-3"><input type="checkbox" checked={selectedIds.includes(note.id)} disabled={unavailable} onChange={() => toggleNote(note)} aria-label={t('invoiceDraftSelectNote', { number: note.number })} /></td><td className="px-3 py-3"><Link href={`/delivery-notes/${note.id}`} className="num font-medium text-primary hover:underline">{note.number}</Link></td><td className="px-3 py-3">{note.customer?.name ?? '—'}</td><td className="px-3 py-3 text-muted">{note.warehouse?.name ?? '—'}</td><td className="num px-3 py-3 text-muted" dir="ltr">{note.delivery_date}</td><td className="px-3 py-3">{unavailable ? <span className="text-xs text-negative">{t('invoiceDraftAlreadyLinked', { number: note.invoice_draft?.number ?? '—' })}</span> : <span className="text-xs text-positive">{t('invoiceDraftAvailable')}</span>}</td></tr>;
          })}</tbody></table></div>
          <div className="divide-y divide-border rounded border border-border md:hidden">{notes.map((note) => {
            const unavailable = !!note.invoice_draft;
            return <label key={note.id} className="flex items-start gap-3 p-4"><input className="mt-1" type="checkbox" checked={selectedIds.includes(note.id)} disabled={unavailable} onChange={() => toggleNote(note)} aria-label={t('invoiceDraftSelectNote', { number: note.number })} /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center justify-between gap-2"><span className="num font-medium text-primary">{note.number}</span>{unavailable && <Badge tone="negative">{t('invoiceDraftLinkedBadge')}</Badge>}</span><span className="mt-1 block text-sm text-text">{note.customer?.name ?? '—'}</span><span className="mt-1 block text-xs text-muted">{note.warehouse?.name ?? '—'} · <span dir="ltr">{note.delivery_date}</span></span>{unavailable && <span className="mt-1 block text-xs text-negative">{t('invoiceDraftAlreadyLinked', { number: note.invoice_draft?.number ?? '—' })}</span>}</span></label>;
          })}</div>
          {notes.length === 0 && <p className="py-8 text-center text-sm text-muted">{t('invoiceDraftNoConfirmed')}</p>}
        </>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>{t('invoiceDraftPreviewTitle')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="invoice-draft-price-list">{t('invoiceDraftPriceList')}</Label><Select id="invoice-draft-price-list" value={priceListId} disabled={priceListError !== null} onChange={(event) => { setPriceListId(event.target.value); setPreview(null); setPricing({}); setBuilt(null); }}><option value="">{t('invoiceDraftCustomerDefault')}</option>{priceLists.map((priceList) => <option key={priceList.id} value={priceList.id}>{priceList.name}</option>)}</Select><p className="text-xs text-muted">{t('invoiceDraftPriceListHint')}</p>{priceListError && <p role="alert" className="text-xs text-negative">{priceListError}</p>}</div>
          <div className="flex items-end"><Button type="button" className="w-full md:w-auto" disabled={previewing || selectedIds.length === 0} onClick={runPreview}>{previewing && <Loader2 className="h-4 w-4 animate-spin" />}{previewing ? t('invoiceDraftPreviewing') : t('invoiceDraftRunPreview')}</Button></div>
        </div>
        {preview && <div className="space-y-3" aria-live="polite">
          {!allPreviewEligible && <div className="rounded border border-negative/30 bg-negative/10 p-3 text-sm text-negative"><strong>{t('invoiceDraftIneligibleTitle')}</strong><ul className="mt-2 list-disc space-y-1 ps-5">{preview.compatibility_issues.map((issue) => <li key={issue}>{t(issueKey(issue), { limit: preview.source_line_limit ?? 0 })}</li>)}{previewRows.filter((note) => !note.eligible).flatMap((note) => note.issues.map((issue) => <li key={`${note.id}-${issue}`}>{note.number ?? '—'}: {t(issueKey(issue), { limit: preview.source_line_limit ?? 0 })}</li>))}</ul></div>}
          {previewRows.map((note) => <div key={note.id} className="rounded border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="num text-text">{note.number}</strong><span className="mx-2 text-muted">·</span><span className="text-sm text-muted">{note.customer_name} — {note.warehouse_name}</span></div>{note.eligible ? <Badge tone="positive">{t('invoiceDraftEligible')}</Badge> : <Badge tone="negative">{t('invoiceDraftIneligible')}</Badge>}</div>{note.lines?.map((line) => {
            const decision = pricing[line.id];
            return <div key={line.id} className="mt-3 grid grid-cols-1 gap-3 border-t border-border pt-3 lg:grid-cols-12 lg:items-end"><div className="lg:col-span-3"><p className="font-medium text-sm text-text">{line.product_name}</p><p className="mt-1 text-xs text-muted">{t('unit')}: {line.unit_name} · {t('quantity')}: <span className="num" dir="ltr">{lineQuantity(line)}</span></p></div><div className="space-y-1 lg:col-span-2"><Label htmlFor={`price-${line.id}`}>{t('invoiceDraftUnitPrice')}</Label><Input id={`price-${line.id}`} inputMode="decimal" dir="ltr" value={decision?.unitPrice ?? ''} onChange={(event) => patchPricing(line.id, { unitPrice: event.target.value })} disabled={!allPreviewEligible || !note.eligible} aria-describedby={`price-help-${line.id}`} /><p id={`price-help-${line.id}`} className="text-xs text-muted">{line.suggested_unit_price === null ? t('invoiceDraftPriceRequired') : t('invoiceDraftSuggestedPrice', { price: formatMinorRiyal(line.suggested_unit_price) })}</p></div><div className="space-y-1 lg:col-span-2"><Label htmlFor={`tax-${line.id}`}>{t('invoiceDraftTaxRate')}</Label><Input id={`tax-${line.id}`} inputMode="numeric" min="0" max="100" dir="ltr" value={decision?.taxRate ?? '15'} onChange={(event) => patchPricing(line.id, { taxRate: event.target.value })} disabled={!allPreviewEligible || !note.eligible} /></div><div className="space-y-1 lg:col-span-2"><Label htmlFor={`discount-${line.id}`}>{t('invoiceDraftLineDiscount')}</Label><Input id={`discount-${line.id}`} inputMode="decimal" dir="ltr" value={decision?.discount ?? '0.00'} onChange={(event) => patchPricing(line.id, { discount: event.target.value })} disabled={!allPreviewEligible || !note.eligible} /></div><div className="space-y-1 lg:col-span-3"><Label htmlFor={`minimum-price-reason-${line.id}`}>{t('invoiceDraftMinimumOverride')}</Label><Input id={`minimum-price-reason-${line.id}`} value={decision?.minimumPriceOverrideReason ?? ''} onChange={(event) => patchPricing(line.id, { minimumPriceOverrideReason: event.target.value })} disabled={!allPreviewEligible || !note.eligible} /></div></div>;
          })}</div>)}
        </div>}
      </CardContent>
    </Card>

    {preview && <Card>
      <CardHeader><CardTitle>{t('invoiceDraftDecisionTitle')}</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-1.5 lg:col-span-2"><Label htmlFor="invoice-draft-reason">{t('invoiceDraftReason')} <span className="text-negative">*</span></Label><Textarea id="invoice-draft-reason" maxLength={500} value={reason} onChange={(event) => { setReason(event.target.value); setBuilt(null); }} aria-invalid={!!preview && !reason.trim() || undefined} /><p className="text-xs text-muted">{t('invoiceDraftReasonHint')}</p></div>
        <div className="space-y-1.5"><Label htmlFor="invoice-draft-date">{t('invoiceDraftDate')}</Label><Input id="invoice-draft-date" type="date" dir="ltr" value={invoiceDate} onChange={(event) => { setInvoiceDate(event.target.value); setBuilt(null); }} /></div>
        <div className="space-y-1.5"><Label htmlFor="invoice-draft-due-date">{t('invoiceDraftDueDate')}</Label><Input id="invoice-draft-due-date" type="date" dir="ltr" value={dueDate} onChange={(event) => { setDueDate(event.target.value); setBuilt(null); }} /></div>
        <div className="space-y-1.5 lg:col-span-2"><Label htmlFor="invoice-draft-notes">{t('invoiceDraftNotes')}</Label><Textarea id="invoice-draft-notes" maxLength={5000} value={invoiceNotes} onChange={(event) => { setInvoiceNotes(event.target.value); setBuilt(null); }} /></div>
        <label className="flex items-start gap-2 text-sm lg:col-span-2"><input className="mt-1" type="checkbox" checked={taxInclusive} onChange={(event) => { setTaxInclusive(event.target.checked); setBuilt(null); }} /><span><strong className="text-text">{t('invoiceDraftTaxInclusive')}</strong><span className="mt-1 block text-muted">{t('invoiceDraftTaxInclusiveHint')}</span></span></label>
      </CardContent>
    </Card>}

    {built && <section className="rounded border border-positive/30 bg-positive/10 p-4" role="status"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2 font-medium text-positive"><CheckCircle2 className="h-5 w-5" />{built.replay ? t('invoiceDraftReplayCreated') : t('invoiceDraftCreated')}</div><p className="mt-1 text-sm text-muted">{t('invoiceDraftCreatedHint')}</p></div>{canViewInvoices ? <Button asChild><Link href={`/invoices/${built.invoice.id}`}>{built.invoice.number ?? t('invoiceDraftOpenInvoice')}</Link></Button> : <Badge tone="positive" className="num self-start sm:self-auto">{built.invoice.number ?? t('invoiceDraftOpenInvoice')}</Badge>}</div></section>}

    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0"><div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => { setPreview(null); setPricing({}); setBuilt(null); setError(null); setIdempotencyKey(newKey()); }} disabled={building}><RefreshCw className="h-4 w-4" strokeWidth={1.7} />{t('invoiceDraftReset')}</Button><Button type="button" className="w-full sm:w-auto" disabled={!allPreviewEligible || !pricingValid || !reason.trim() || building} onClick={buildDraft}>{building && <Loader2 className="h-4 w-4 animate-spin" />}{building ? t('invoiceDraftCreating') : t('invoiceDraftCreate')}</Button></div></div>
  </div>;
}
