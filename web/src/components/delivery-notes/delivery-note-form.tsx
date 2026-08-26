'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, PackageSearch, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberPreviewField } from '@/components/ui/number-preview-field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { toDeliveryNoteItems, type DeliveryLineInput, type DeliveryNote, validWholeQuantity } from '@/lib/delivery-notes';
import { useNumberPreview } from '@/lib/use-number-preview';

interface Partner { id: string; name: string; type: string; phone?: string | null; vat_number?: string | null; is_active?: boolean }
interface Warehouse { id: string; name: string; code?: string | null; is_active: boolean; is_default?: boolean }
interface ProductUnit { name: string; factor: number }
interface Product { id: string; name: string; sku?: string | null; barcode?: string | null; unit?: string | null; is_active: boolean; units?: ProductUnit[] }

let lineSequence = 0;
const newLine = (): DeliveryLineInput => ({ key: `dn-${++lineSequence}`, productId: '', unit: '', quantity: '1', description: '' });

/**
 * نموذج سند التسليم العام. يحفظ مسودة فقط؛ التأكيد والإلغاء قرارات منفصلة من صفحة التفاصيل.
 */
export function DeliveryNoteForm({ editId }: { editId?: string }) {
  const t = useTranslations('deliveryNotes');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [externalReference, setExternalReference] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DeliveryLineInput[]>([newLine()]);
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(Boolean(editId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { number: suggestedNumber, loading: loadingNumber } = useNumberPreview('delivery_note', { date: deliveryDate, enabled: !editId });

  const loadMasters = useCallback(() => {
    api<{ data: Partner[] }>('/partners').then((result) => {
      const customers = result.data.filter((partner) => partner.is_active !== false && (partner.type === 'customer' || partner.type === 'both'));
      setPartners(customers);
      if (!editId && customers[0]) setCustomerId((current) => current || customers[0].id);
    }).catch(() => {});
    api<{ data: Warehouse[] }>('/warehouses').then((result) => {
      const active = result.data.filter((warehouse) => warehouse.is_active);
      setWarehouses(active);
      if (!editId) setWarehouseId((current) => current || active.find((warehouse) => warehouse.is_default)?.id || active[0]?.id || '');
    }).catch(() => {});
    api<{ data: Product[] }>('/products').then((result) => setProducts(result.data.filter((product) => product.is_active))).catch(() => {});
  }, [editId]);

  useEffect(() => {
    setDeliveryDate(new Date().toISOString().slice(0, 10));
    loadMasters();
  }, [loadMasters]);

  useEffect(() => {
    if (!editId) return;
    setLoading(true);
    api<{ data: DeliveryNote }>(`/delivery-notes/${editId}`)
      .then((result) => {
        const note = result.data;
        if (note.status !== 'draft') {
          router.replace(`/delivery-notes/${note.id}`);
          return;
        }
        setCustomerId(note.customer_id);
        setWarehouseId(note.warehouse_id);
        setDeliveryDate(note.delivery_date);
        setExternalReference(note.external_reference ?? '');
        setNotes(note.notes ?? '');
        setVersion(note.version);
        setLines(note.lines.length ? note.lines.map((line) => ({
          key: `dn-${++lineSequence}`,
          productId: line.product_id,
          unit: line.unit_name ?? '',
          quantity: String(line.quantity),
          description: line.description ?? '',
        })) : [newLine()]);
      })
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : tc('saveFailed')))
      .finally(() => setLoading(false));
  }, [editId, router, tc]);

  const customerOptions = useMemo<ComboOption[]>(() => partners.map((partner) => ({
    value: partner.id,
    label: partner.name,
    sub: partner.vat_number ?? undefined,
    hint: partner.phone ?? undefined,
  })), [partners]);
  const warehouseOptions = useMemo<ComboOption[]>(() => warehouses.map((warehouse) => ({
    value: warehouse.id,
    label: warehouse.name,
    sub: warehouse.code ?? undefined,
  })), [warehouses]);
  const productOptions = useMemo<ComboOption[]>(() => products.map((product) => ({
    value: product.id,
    label: product.name,
    sub: [product.sku, product.barcode].filter(Boolean).join(' · ') || undefined,
  })), [products]);

  const patchLine = (key: string, patch: Partial<DeliveryLineInput>) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  const addLine = () => setLines((current) => [...current, newLine()]);
  const removeLine = (key: string) => setLines((current) => current.length > 1 ? current.filter((line) => line.key !== key) : current);
  const selectProduct = (key: string, productId: string) => {
    const product = products.find((candidate) => candidate.id === productId);
    patchLine(key, { productId, unit: '', description: product?.name ?? '' });
  };

  const lineError = (line: DeliveryLineInput): string | null => {
    if (!line.productId) return t('lineProductRequired');
    if (!validWholeQuantity(line.quantity)) return t('lineQuantityInvalid');
    return null;
  };

  async function submit(): Promise<void> {
    const invalid = lines.map(lineError).find(Boolean);
    if (!customerId || !warehouseId || !deliveryDate || invalid) {
      setError(invalid ?? t('headerRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      customer_id: customerId,
      warehouse_id: warehouseId,
      delivery_date: deliveryDate,
      external_reference: externalReference.trim() || null,
      notes: notes.trim() || null,
      ...(editId ? { expected_version: version } : {}),
      items: toDeliveryNoteItems(lines),
    };
    try {
      const result = await api<{ data: DeliveryNote }>(editId ? `/delivery-notes/${editId}` : '/delivery-notes', {
        method: editId ? 'PUT' : 'POST',
        body,
      });
      success(editId ? t('updated') : t('created'));
      router.push(`/delivery-notes/${result.data.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : tc('saveFailed'));
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="space-y-4" aria-busy="true"><div className="h-9 w-52 animate-pulse rounded bg-muted" /><div className="h-64 animate-pulse rounded bg-muted" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}>
          <Link href={editId ? `/delivery-notes/${editId}` : '/delivery-notes'}><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Link>
        </Button>
        <div className="min-w-0"><h1 className="text-xl font-semibold text-text">{editId ? t('editTitle') : t('newTitle')}</h1><p className="text-sm text-muted">{t('draftOnlyHint')}</p></div>
      </div>

      <Card>
        <CardHeader><CardTitle>{t('header')}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <NumberPreviewField id="delivery-note-number" label={t('number')} number={editId ? '' : suggestedNumber} loading={loadingNumber} />
          <div className="space-y-1.5"><Label htmlFor="delivery-customer">{t('customer')}</Label><Combobox id="delivery-customer" value={customerId} onChange={setCustomerId} options={customerOptions} placeholder={t('chooseCustomer')} searchPlaceholder={t('searchCustomers')} emptyText={t('noCustomers')} aria-label={t('customer')} /></div>
          <div className="space-y-1.5"><Label htmlFor="delivery-warehouse">{t('warehouse')}</Label><Combobox id="delivery-warehouse" value={warehouseId} onChange={setWarehouseId} options={warehouseOptions} placeholder={t('chooseWarehouse')} searchPlaceholder={t('searchWarehouses')} emptyText={t('noWarehouses')} aria-label={t('warehouse')} /></div>
          <div className="space-y-1.5"><Label htmlFor="delivery-date">{t('deliveryDate')}</Label><Input id="delivery-date" type="date" dir="ltr" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="delivery-reference">{t('externalReference')}</Label><Input id="delivery-reference" maxLength={120} value={externalReference} onChange={(event) => setExternalReference(event.target.value)} placeholder={t('externalReferenceHint')} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="delivery-notes">{t('notes')}</Label><Textarea id="delivery-notes" maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t('notesHint')} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3"><div><CardTitle>{t('lines')}</CardTitle><p className="mt-1 text-sm text-muted">{t('linesHint')}</p></div><Button type="button" variant="outline" size="sm" onClick={addLine}><Plus className="h-4 w-4" strokeWidth={1.8} />{t('addLine')}</Button></CardHeader>
        <CardContent className="space-y-3">
          <div className="hidden grid-cols-12 gap-3 px-1 text-xs font-medium text-muted md:grid"><div className="col-span-5">{t('product')}</div><div className="col-span-2">{t('unit')}</div><div className="col-span-2 text-end">{t('quantity')}</div><div className="col-span-2">{t('description')}</div><div className="col-span-1" /></div>
          {lines.map((line, index) => {
            const product = products.find((candidate) => candidate.id === line.productId);
            const unitOptions = product?.units ?? [];
            const inputError = lineError(line);
            return <div key={line.key} className="rounded border border-border p-3 md:grid md:grid-cols-12 md:items-start md:gap-3 md:border-0 md:p-0">
              <div className="space-y-1.5 md:col-span-5"><Label className="md:sr-only" htmlFor={`product-${line.key}`}>{t('product')}</Label><Combobox id={`product-${line.key}`} value={line.productId} onChange={(id) => selectProduct(line.key, id)} options={productOptions} placeholder={t('chooseProduct')} searchPlaceholder={t('searchProducts')} emptyText={t('noProducts')} aria-label={`${t('product')} ${index + 1}`} /></div>
              <div className="mt-3 space-y-1.5 md:col-span-2 md:mt-0"><Label className="md:sr-only" htmlFor={`unit-${line.key}`}>{t('unit')}</Label><Select id={`unit-${line.key}`} value={line.unit} disabled={!product} onChange={(event) => patchLine(line.key, { unit: event.target.value })}><option value="">{product?.unit ?? t('baseUnit')}</option>{unitOptions.map((unit) => <option key={unit.name} value={unit.name}>{unit.name}</option>)}</Select></div>
              <div className="mt-3 space-y-1.5 md:col-span-2 md:mt-0"><Label className="md:sr-only" htmlFor={`quantity-${line.key}`}>{t('quantity')}</Label><Input id={`quantity-${line.key}`} className="num text-end" inputMode="numeric" pattern="[0-9]*" value={line.quantity} onChange={(event) => patchLine(line.key, { quantity: event.target.value })} aria-invalid={inputError ? true : undefined} /></div>
              <div className="mt-3 space-y-1.5 md:col-span-2 md:mt-0"><Label className="md:sr-only" htmlFor={`description-${line.key}`}>{t('description')}</Label><Input id={`description-${line.key}`} maxLength={1000} value={line.description} onChange={(event) => patchLine(line.key, { description: event.target.value })} /></div>
              <div className="mt-3 flex items-start justify-between gap-2 md:col-span-1 md:mt-0 md:justify-end"><span className="text-xs text-negative md:hidden">{inputError ?? ''}</span><Button type="button" variant="ghost" size="icon" aria-label={t('removeLine')} disabled={lines.length === 1} onClick={() => removeLine(line.key)}><Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} /></Button></div>
              {inputError && <p className="col-span-12 mt-1 hidden text-xs text-negative md:block">{inputError}</p>}
            </div>;
          })}
          <div className="rounded border border-dashed border-border bg-primary-soft/30 p-3 text-sm text-muted"><PackageSearch className="me-2 inline h-4 w-4 text-primary" strokeWidth={1.7} />{t('noFinancialEffect')}</div>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 z-20 -mx-4 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end"><p role="alert" className="me-auto text-sm text-negative">{error}</p><Button asChild variant="outline"><Link href="/delivery-notes">{tc('cancel')}</Link></Button><Button disabled={saving} onClick={submit}>{saving ? t('saving') : t('saveDraft')}</Button></div>
      </div>
    </div>
  );
}
