'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Loader2, Plus, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

type Entity = { id: string; name?: string; code?: string; fuel_station_id?: string; warehouse_id?: string; branch_id?: string | null; is_active?: boolean };
type Delivery = { id: string; status: string; delivery_note_number?: string | null; supplier_id: string; received_liters: string; received_total_cost_minor: number; warehouse_id: string; received_at?: string | null };
type SupplierInvoice = { id: string; invoice_number: string; status: string; supplier_id: string; total_value_minor: number; currency: string };

const emptyForm = { fuel_station_id: '', fuel_tank_id: '', fuel_product_id: '', warehouse_id: '', supplier_id: '', dispatched_liters: '', received_liters: '', received_total_cost_minor: '', delivery_note_number: '', idempotency_key: '' };

export default function FuelStationsReceivingPage() {
  const t = useTranslations('fuelStationsReceiving');
  const { success } = useToast();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [stations, setStations] = useState<Entity[]>([]);
  const [tanks, setTanks] = useState<Entity[]>([]);
  const [fuelProducts, setFuelProducts] = useState<Entity[]>([]);
  const [warehouses, setWarehouses] = useState<Entity[]>([]);
  const [suppliers, setSuppliers] = useState<Entity[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([
      api<{ data: Delivery[] }>('/fuel-stations/deliveries'),
      api<{ data: SupplierInvoice[] }>('/fuel-stations/supplier-invoices'),
      api<{ data: Entity[] }>('/fuel-stations/stations'),
      api<{ data: Entity[] }>('/fuel-stations/tanks'),
      api<{ data: Entity[] }>('/fuel-stations/products'),
      api<{ data: Entity[] }>('/warehouses'),
      api<{ data: Entity[] }>('/partners?type=supplier'),
    ] as const).then(([deliveryResponse, invoiceResponse, stationResponse, tankResponse, fuelResponse, warehouseResponse, supplierResponse]) => {
      setDeliveries(deliveryResponse.data); setInvoices(invoiceResponse.data); setStations(stationResponse.data); setTanks(tankResponse.data); setFuelProducts(fuelResponse.data); setWarehouses(warehouseResponse.data); setSuppliers(supplierResponse.data);
    }).catch((err) => setError(err instanceof ApiError ? err.message : t('loadFailed'))).finally(() => setLoading(false));
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const selectedStation = useMemo(() => stations.find((station) => station.id === form.fuel_station_id), [form.fuel_station_id, stations]);
  const compatibleTanks = useMemo(() => tanks.filter((tank) => !form.fuel_station_id || tank.fuel_station_id === form.fuel_station_id), [form.fuel_station_id, tanks]);
  const compatibleWarehouses = useMemo(() => warehouses.filter((warehouse) => warehouse.is_active !== false && (!selectedStation?.branch_id || !warehouse.branch_id || warehouse.branch_id === selectedStation.branch_id)), [selectedStation?.branch_id, warehouses]);

  function set(key: keyof typeof emptyForm, value: string) { setForm((current) => ({ ...current, [key]: value })); }
  function selectStation(id: string) {
    const station = stations.find((item) => item.id === id);
    setForm((current) => ({ ...current, fuel_station_id: id, warehouse_id: station?.warehouse_id ?? '', fuel_tank_id: '', fuel_product_id: '' }));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(null); setSaving(true);
    try {
      await api('/fuel-stations/deliveries', { method: 'POST', body: { ...form, idempotency_key: form.idempotency_key || `web-receipt-${crypto.randomUUID()}` } });
      success(t('created')); setForm(emptyForm); load();
    } catch (err) { setError(err instanceof ApiError ? err.message : t('saveFailed')); } finally { setSaving(false); }
  }

  if (loading) return <div className="space-y-4">{[0, 1].map((item) => <Skeleton key={item} className="h-48 w-full" />)}</div>;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><Link href="/fuel-stations" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowRight className="h-4 w-4" strokeWidth={1.7} />{t('backWorkspace')}</Link><h1 className="mt-2 text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{t('subtitle')}</p></div><Button type="button" variant="outline" onClick={load}><RefreshCw className="h-4 w-4" strokeWidth={1.7} />{t('refresh')}</Button></div>
    <p role="note" className="rounded-md border border-border bg-primary-soft px-3 py-2 text-sm leading-relaxed text-text">{t('grniHint')}</p>
    {error && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(21rem,0.7fr)]">
      <Card><CardHeader><CardTitle>{t('deliveries')}</CardTitle></CardHeader><CardContent>{deliveries.length === 0 ? <p className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted">{t('emptyDeliveries')}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[44rem] text-sm"><thead className="border-b border-border text-xs text-muted"><tr><th className="px-2 py-2 text-start">{t('deliveryNote')}</th><th className="px-2 py-2 text-start">{t('received')}</th><th className="px-2 py-2 text-start">{t('value')}</th><th className="px-2 py-2 text-start">{t('status')}</th></tr></thead><tbody>{deliveries.map((delivery) => <tr key={delivery.id} className="border-b border-border/70 last:border-0"><td className="num px-2 py-3 text-text">{delivery.delivery_note_number ?? '—'}</td><td className="num px-2 py-3 text-text">{delivery.received_liters} L</td><td className="num px-2 py-3 text-text">{delivery.received_total_cost_minor}</td><td className="px-2 py-3"><Badge tone={delivery.status === 'approved' ? 'positive' : 'muted'}>{t(`status_${delivery.status}` as 'status_draft' | 'status_approved')}</Badge></td></tr>)}</tbody></table></div>}</CardContent></Card>
      <Card><CardHeader><CardTitle>{t('newDelivery')}</CardTitle></CardHeader><CardContent><form onSubmit={submit} className="grid gap-3"><div className="space-y-1.5"><Label htmlFor="station">{t('station')}</Label><Select id="station" value={form.fuel_station_id} onChange={(event) => selectStation(event.target.value)} required><option value="">—</option>{stations.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</Select></div><div className="space-y-1.5"><Label htmlFor="warehouse">{t('warehouse')}</Label><Select id="warehouse" value={form.warehouse_id} onChange={(event) => set('warehouse_id', event.target.value)} required><option value="">—</option>{compatibleWarehouses.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</Select><p className="text-xs leading-relaxed text-muted">{t('warehouseHint')}</p></div><div className="space-y-1.5"><Label htmlFor="tank">{t('tank')}</Label><Select id="tank" value={form.fuel_tank_id} onChange={(event) => set('fuel_tank_id', event.target.value)} required><option value="">—</option>{compatibleTanks.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</Select></div><div className="space-y-1.5"><Label htmlFor="fuel-product">{t('fuelProduct')}</Label><Select id="fuel-product" value={form.fuel_product_id} onChange={(event) => set('fuel_product_id', event.target.value)} required><option value="">—</option>{fuelProducts.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</Select></div><div className="space-y-1.5"><Label htmlFor="supplier">{t('supplier')}</Label><Select id="supplier" value={form.supplier_id} onChange={(event) => set('supplier_id', event.target.value)} required><option value="">—</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="dispatched">{t('dispatched')}</Label><Input id="dispatched" inputMode="decimal" value={form.dispatched_liters} onChange={(event) => set('dispatched_liters', event.target.value)} required /></div><div className="space-y-1.5"><Label htmlFor="received">{t('received')}</Label><Input id="received" inputMode="decimal" value={form.received_liters} onChange={(event) => set('received_liters', event.target.value)} required /></div></div><div className="space-y-1.5"><Label htmlFor="value">{t('valueMinor')}</Label><Input id="value" inputMode="numeric" value={form.received_total_cost_minor} onChange={(event) => set('received_total_cost_minor', event.target.value)} required /></div><div className="space-y-1.5"><Label htmlFor="note">{t('deliveryNote')}</Label><Input id="note" value={form.delivery_note_number} onChange={(event) => set('delivery_note_number', event.target.value)} /></div><Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} /> : <Plus className="h-4 w-4" strokeWidth={1.7} />}{t('createDraft')}</Button></form></CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle>{t('supplierInvoices')}</CardTitle></CardHeader><CardContent>{invoices.length === 0 ? <p className="text-sm text-muted">{t('emptyInvoices')}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[36rem] text-sm"><thead className="border-b border-border text-xs text-muted"><tr><th className="px-2 py-2 text-start">{t('invoiceNumber')}</th><th className="px-2 py-2 text-start">{t('value')}</th><th className="px-2 py-2 text-start">{t('status')}</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id} className="border-b border-border/70 last:border-0"><td className="num px-2 py-3">{invoice.invoice_number}</td><td className="num px-2 py-3">{invoice.total_value_minor} {invoice.currency}</td><td className="px-2 py-3"><Badge tone={invoice.status === 'matched' ? 'positive' : invoice.status === 'value_variance_pending' ? 'warning' : 'muted'}>{t(`invoice_${invoice.status}` as 'invoice_unmatched' | 'invoice_partially_matched' | 'invoice_matched' | 'invoice_value_variance_pending')}</Badge></td></tr>)}</tbody></table></div>}</CardContent></Card>
  </div>;
}
