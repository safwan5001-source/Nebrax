'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { litersToMilliliters, millilitersToLiters } from '@/lib/fuel-quantity';

type Kind = 'stations' | 'products' | 'tanks' | 'pumps' | 'nozzles';
type Item = Record<string, string | number | boolean | null | undefined> & { id: string };
type Branch = { id: string; name: string; code: string };
type Product = { id: string; name: string; sku?: string | null; unit?: string | null };
type Warehouse = { id: string; name: string; code: string; branch_id?: string | null; is_active?: boolean };

const ENDPOINTS: Record<Kind, string> = {
  stations: '/fuel-stations/stations',
  products: '/fuel-stations/products',
  tanks: '/fuel-stations/tanks',
  pumps: '/fuel-stations/pumps',
  nozzles: '/fuel-stations/nozzles',
};

const VOLUME_FIELDS = new Set(['capacity_milliliters', 'safe_capacity_milliliters', 'minimum_level_milliliters', 'dead_stock_milliliters', 'opening_volume_milliliters', 'meter_opening_milliliters']);

const EMPTY: Record<Kind, Record<string, string>> = {
  stations: { branch_id: '', warehouse_id: '', code: '', name: '', city: '', timezone: 'Asia/Riyadh', status: 'active' },
  products: { product_id: '', code: '', name: '', density_kg_per_m3: '', tax_category: '', is_active: 'true' },
  tanks: { fuel_station_id: '', fuel_product_id: '', code: '', name: '', capacity_milliliters: '', safe_capacity_milliliters: '', minimum_level_milliliters: '0', dead_stock_milliliters: '0', opening_volume_milliliters: '0', atg_source_key: '', status: 'active' },
  pumps: { fuel_station_id: '', pump_number: '', name: '', controller_key: '', status: 'active' },
  nozzles: { fuel_pump_id: '', fuel_tank_id: '', fuel_product_id: '', nozzle_number: '', meter_opening_milliliters: '0', controller_key: '', status: 'active' },
};

export default function FuelStationsMasterDataPage() {
  const t = useTranslations('fuelStationsMasterData');
  const { success } = useToast();
  const [kind, setKind] = useState<Kind>('stations');
  const [rows, setRows] = useState<Record<Kind, Item[]>>({ stations: [], products: [], tanks: [], pumps: [], nozzles: [] });
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY.stations);
  const [saving, setSaving] = useState(false);

  const labels: Record<Kind, string> = {
    stations: t('stations'), products: t('fuelProducts'), tanks: t('tanks'), pumps: t('pumps'), nozzles: t('nozzles'),
  };

  const load = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([
      api<{ data: Item[] }>(ENDPOINTS.stations),
      api<{ data: Item[] }>(ENDPOINTS.products),
      api<{ data: Item[] }>(ENDPOINTS.tanks),
      api<{ data: Item[] }>(ENDPOINTS.pumps),
      api<{ data: Item[] }>(ENDPOINTS.nozzles),
      api<{ data: Branch[] }>('/branches'),
      api<{ data: Product[] }>('/products'),
      api<{ data: Warehouse[] }>('/warehouses'),
    ] as const).then(([stations, fuelProducts, tanks, pumps, nozzles, branchResponse, productResponse, warehouseResponse]) => {
      setRows({ stations: stations.data, products: fuelProducts.data, tanks: tanks.data, pumps: pumps.data, nozzles: nozzles.data });
      setBranches(branchResponse.data); setProducts(productResponse.data); setWarehouses(warehouseResponse.data);
    }).catch((err) => setError(err instanceof ApiError ? err.message : t('loadFailed'))).finally(() => setLoading(false));
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const choices = useMemo(() => ({
    stations: rows.stations, fuelProducts: rows.products, tanks: rows.tanks, pumps: rows.pumps,
  }), [rows]);

  function startCreate() { setEditing(null); setForm({ ...EMPTY[kind] }); setError(null); }
  function startEdit(row: Item) {
    setEditing(row); setError(null);
    const next = { ...EMPTY[kind] };
    Object.keys(next).forEach((key) => { const value = row[key]; next[key] = value === null || value === undefined ? '' : VOLUME_FIELDS.has(key) ? millilitersToLiters(typeof value === 'string' || typeof value === 'number' ? value : null) : String(value); });
    setForm(next);
  }
  function cancel() { setEditing(null); setForm({ ...EMPTY[kind] }); setError(null); }
  function set(key: string, value: string) { setForm((current) => ({ ...current, [key]: value })); }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(null);
    const body: Record<string, string | number | boolean | null> = {};
    Object.entries(form).forEach(([key, value]) => {
      if (VOLUME_FIELDS.has(key)) body[key] = litersToMilliliters(value, true) ?? 0;
      else if (key === 'density_kg_per_m3') body[key] = Number(value || 0);
      else if (key === 'is_active') body[key] = value === 'true';
      else body[key] = value.trim() === '' ? null : value.trim();
    });
    try {
      const path = editing ? `${ENDPOINTS[kind]}/${editing.id}` : ENDPOINTS[kind];
      await api(path, { method: editing ? 'PUT' : 'POST', body });
      success(editing ? t('updated') : t('created')); cancel(); load();
    } catch (err) { setError(err instanceof ApiError ? err.message : t('saveFailed')); } finally { setSaving(false); }
  }

  async function remove(row: Item) {
    if (! window.confirm(t('confirmDelete'))) return;
    try { await api(`${ENDPOINTS[kind]}/${row.id}`, { method: 'DELETE' }); success(t('deleted')); load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t('deleteFailed')); }
  }

  function selectOptions(key: string) {
    if (key === 'branch_id') return branches.map((row) => ({ value: row.id, label: `${row.name} · ${row.code}` }));
    if (key === 'warehouse_id') return warehouses
      .filter((row) => row.is_active !== false && (!row.branch_id || row.branch_id === form.branch_id))
      .map((row) => ({ value: row.id, label: `${row.name} · ${row.code}` }));
    if (key === 'product_id') return products.map((row) => ({ value: row.id, label: row.name }));
    if (key === 'fuel_station_id') return choices.stations.map((row) => ({ value: row.id, label: `${row.name ?? ''} · ${row.code ?? ''}` }));
    if (key === 'fuel_product_id') return choices.fuelProducts.map((row) => ({ value: row.id, label: `${row.name ?? ''} · ${row.code ?? ''}` }));
    if (key === 'fuel_tank_id') return choices.tanks.map((row) => ({ value: row.id, label: `${row.name ?? ''} · ${row.code ?? ''}` }));
    if (key === 'fuel_pump_id') return choices.pumps.map((row) => ({ value: row.id, label: `${row.pump_number ?? ''} · ${row.name ?? ''}` }));
    return null;
  }

  const fieldLabel = (key: string) => ({ branch_id: t('branch'), warehouse_id: t('warehouse'), code: t('code'), name: t('name'), city: t('city'), timezone: t('timezone'), status: t('status'), product_id: t('product'), density_kg_per_m3: t('density'), tax_category: t('taxCategory'), fuel_station_id: t('station'), fuel_product_id: t('fuelProduct'), capacity_milliliters: t('capacity'), safe_capacity_milliliters: t('safeCapacity'), minimum_level_milliliters: t('minimumLevel'), dead_stock_milliliters: t('deadStock'), opening_volume_milliliters: t('openingVolume'), atg_source_key: t('atgKey'), pump_number: t('pumpNumber'), controller_key: t('controllerKey'), fuel_pump_id: t('pump'), fuel_tank_id: t('tank'), nozzle_number: t('nozzleNumber'), meter_opening_milliliters: t('meterOpening'), is_active: t('status') }[key] ?? key);

  if (loading) return <div className="space-y-4">{[0, 1].map((row) => <Skeleton key={row} className="h-44 w-full" />)}</div>;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><Link href="/fuel-stations" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowRight className="h-4 w-4" strokeWidth={1.7} />{t('backWorkspace')}</Link><h1 className="mt-2 text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{t('subtitle')}</p></div>
      <Button onClick={startCreate}><Plus className="h-4 w-4" strokeWidth={1.7} />{t('add')} {labels[kind]}</Button>
    </div>
    <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-muted">{t('manageHint')}</p>
    {kind === 'stations' && rows.stations.some((row) => !row.warehouse_id) && <p role="note" className="rounded-md border border-border bg-primary-soft px-3 py-2 text-xs leading-relaxed text-text">{t('warehouseUnsetWarning')}</p>}
    <div className="flex flex-wrap gap-2" role="tablist">{(Object.keys(labels) as Kind[]).map((tab) => <Button key={tab} type="button" size="sm" variant={kind === tab ? 'primary' : 'outline'} onClick={() => { setKind(tab); cancel(); }}>{labels[tab]}</Button>)}</div>
    {error && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(19rem,0.65fr)]">
      <Card><CardHeader><CardTitle>{labels[kind]}</CardTitle></CardHeader><CardContent>{rows[kind].length === 0 ? <p className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted">{t('empty')}</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b border-border text-start text-xs text-muted"><tr><th className="px-2 py-2 text-start">{t('name')}</th><th className="px-2 py-2 text-start">{t('code')}</th><th className="px-2 py-2 text-start">{t('status')}</th><th className="px-2 py-2" /></tr></thead><tbody>{rows[kind].map((row) => <tr key={row.id} className="border-b border-border/70 last:border-0"><td className="px-2 py-3 font-medium text-text">{String(row.name ?? row.pump_number ?? row.nozzle_number ?? '—')}</td><td className="num px-2 py-3 text-muted">{String(row.code ?? row.pump_number ?? row.nozzle_number ?? '—')}</td><td className="px-2 py-3">{row.status ? <Badge tone={row.status === 'active' ? 'positive' : 'muted'}>{t(String(row.status) as 'active' | 'inactive' | 'maintenance')}</Badge> : '—'}</td><td className="px-2 py-3"><div className="flex justify-end gap-1"><Button type="button" variant="ghost" size="icon" aria-label={t('edit')} onClick={() => startEdit(row)}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button><Button type="button" variant="ghost" size="icon" aria-label={t('delete')} onClick={() => remove(row)}><Trash2 className="h-4 w-4" strokeWidth={1.7} /></Button></div></td></tr>)}</tbody></table></div>}</CardContent></Card>
      <Card><CardHeader><CardTitle>{editing ? t('edit') : t('add')} {labels[kind]}</CardTitle></CardHeader><CardContent><form onSubmit={submit} className="grid gap-3">{Object.keys(form).map((key) => { const options = selectOptions(key); const status = key === 'status'; const boolean = key === 'is_active'; return <div key={key} className="space-y-1.5"><Label htmlFor={key}>{fieldLabel(key)}</Label>{options || status || boolean ? <><Select id={key} value={form[key]} onChange={(event) => set(key, event.target.value)}>{options && <><option value="">—</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</>}{status && <><option value="active">{t('active')}</option><option value="inactive">{t('inactive')}</option><option value="maintenance">{t('maintenance')}</option></>}{boolean && <><option value="true">{t('active')}</option><option value="false">{t('inactive')}</option></>}</Select>{key === 'warehouse_id' && <p className="text-xs leading-relaxed text-muted">{t('warehouseHint')}</p>}</> : <Input id={key} value={form[key]} type={VOLUME_FIELDS.has(key) || key.includes('density') ? 'number' : 'text'} inputMode={VOLUME_FIELDS.has(key) || key.includes('density') ? 'decimal' : undefined} min={VOLUME_FIELDS.has(key) ? '0' : undefined} dir={key.includes('code') || key.includes('key') ? 'ltr' : undefined} onChange={(event) => set(key, event.target.value)} required={['branch_id', 'code', 'name', 'product_id', 'fuel_station_id', 'fuel_product_id', 'fuel_pump_id', 'fuel_tank_id', 'pump_number', 'nozzle_number', 'capacity_milliliters', 'safe_capacity_milliliters'].includes(key)} />}</div>; })}<div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={cancel}>{t('cancel')}</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />}{t('save')}</Button></div></form></CardContent></Card>
    </div>
  </div>;
}
