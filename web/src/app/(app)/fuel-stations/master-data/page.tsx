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
import {
  MASTER_DATA_DEFAULTS,
  VOLUME_FIELDS,
  filteredProductsForTank,
  filteredTanksForPump,
  formForRow,
  masterDataPayload,
  type FuelMasterDataForm,
  type FuelMasterDataKind as Kind,
  type FuelMasterDataRow as Item,
} from '@/lib/fuel-master-data';

type Branch = { id: string; name: string; code: string };
type Product = { id: string; name: string; sku?: string | null };
type Warehouse = { id: string; name: string; code: string; branch_id?: string | null; is_active?: boolean };
type Field = { key: string; required?: boolean; numeric?: boolean; volume?: boolean };

const ENDPOINTS: Record<Kind, string> = {
  stations: '/fuel-stations/stations',
  products: '/fuel-stations/products',
  tanks: '/fuel-stations/tanks',
  pumps: '/fuel-stations/pumps',
  nozzles: '/fuel-stations/nozzles',
};

// Human-facing master data only. Device/controller mappings intentionally belong to Integrations/Advanced.
const FIELDS: Record<Kind, Field[]> = {
  stations: [
    { key: 'branch_id', required: true }, { key: 'warehouse_id' }, { key: 'code', required: true },
    { key: 'name', required: true }, { key: 'city' }, { key: 'timezone' }, { key: 'status' },
  ],
  products: [
    { key: 'product_id', required: true }, { key: 'code', required: true }, { key: 'name', required: true },
    { key: 'density_kg_per_m3', numeric: true }, { key: 'tax_category' }, { key: 'is_active' },
  ],
  tanks: [
    { key: 'fuel_station_id', required: true }, { key: 'fuel_product_id', required: true },
    { key: 'code', required: true }, { key: 'name', required: true },
    { key: 'capacity_milliliters', required: true, volume: true },
    { key: 'safe_capacity_milliliters', required: true, volume: true },
    { key: 'minimum_level_milliliters', volume: true }, { key: 'dead_stock_milliliters', volume: true },
    { key: 'opening_volume_milliliters', volume: true }, { key: 'status' },
  ],
  pumps: [
    { key: 'fuel_station_id', required: true }, { key: 'pump_number', required: true }, { key: 'name' }, { key: 'status' },
  ],
  nozzles: [
    { key: 'fuel_pump_id', required: true }, { key: 'fuel_tank_id', required: true },
    { key: 'fuel_product_id', required: true }, { key: 'nozzle_number', required: true },
    { key: 'meter_opening_milliliters', volume: true }, { key: 'status' },
  ],
};

function statusTone(value: unknown): 'positive' | 'warning' | 'muted' {
  if (value === 'active' || value === true) return 'positive';
  if (value === 'maintenance') return 'warning';
  return 'muted';
}

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
  const [form, setForm] = useState<FuelMasterDataForm>({ ...MASTER_DATA_DEFAULTS.stations });
  const [saving, setSaving] = useState(false);

  const labels: Record<Kind, string> = {
    stations: t('stations'), products: t('fuelProducts'), tanks: t('tanks'), pumps: t('pumps'), nozzles: t('nozzles'),
  };

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api<{ data: Item[] }>(ENDPOINTS.stations), api<{ data: Item[] }>(ENDPOINTS.products),
      api<{ data: Item[] }>(ENDPOINTS.tanks), api<{ data: Item[] }>(ENDPOINTS.pumps),
      api<{ data: Item[] }>(ENDPOINTS.nozzles), api<{ data: Branch[] }>('/branches'),
      api<{ data: Product[] }>('/products'), api<{ data: Warehouse[] }>('/warehouses'),
    ] as const)
      .then(([stations, fuelProducts, tanks, pumps, nozzles, branchResponse, productResponse, warehouseResponse]) => {
        setRows({ stations: stations.data, products: fuelProducts.data, tanks: tanks.data, pumps: pumps.data, nozzles: nozzles.data });
        setBranches(branchResponse.data);
        setProducts(productResponse.data);
        setWarehouses(warehouseResponse.data);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('loadFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const tankOptions = useMemo(
    () => filteredTanksForPump(form.fuel_pump_id ?? '', rows.pumps, rows.tanks),
    [form.fuel_pump_id, rows.pumps, rows.tanks],
  );
  const fuelProductOptions = useMemo(
    () => kind === 'nozzles' ? filteredProductsForTank(form.fuel_tank_id ?? '', rows.products, rows.tanks) : rows.products,
    [form.fuel_tank_id, kind, rows.products, rows.tanks],
  );

  function reset(nextKind = kind) {
    setEditing(null);
    setForm(formForRow(nextKind));
    setError(null);
  }

  function startCreate() { reset(); }
  function startEdit(row: Item) {
    setEditing(row);
    setForm(formForRow(kind, row));
    setError(null);
  }
  function set(key: string, value: string) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (kind === 'stations' && key === 'branch_id') next.warehouse_id = '';
      if (kind === 'nozzles' && key === 'fuel_pump_id') {
        next.fuel_tank_id = '';
        next.fuel_product_id = '';
      }
      if (kind === 'nozzles' && key === 'fuel_tank_id') {
        const tank = rows.tanks.find((row) => row.id === value);
        next.fuel_product_id = tank?.fuel_product_id ? String(tank.fuel_product_id) : '';
      }
      return next;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const path = editing ? `${ENDPOINTS[kind]}/${editing.id}` : ENDPOINTS[kind];
      await api(path, { method: editing ? 'PUT' : 'POST', body: masterDataPayload(kind, form) });
      success(editing ? t('updated') : t('created'));
      reset();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: Item) {
    if (!window.confirm(t('confirmDelete'))) return;
    try {
      await api(`${ENDPOINTS[kind]}/${row.id}`, { method: 'DELETE' });
      success(t('deleted'));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('deleteFailed'));
    }
  }

  function selectOptions(key: string) {
    if (key === 'branch_id') return branches.map((row) => ({ value: row.id, label: `${row.name} · ${row.code}` }));
    if (key === 'warehouse_id') return warehouses
      .filter((row) => row.is_active !== false && (!row.branch_id || row.branch_id === form.branch_id))
      .map((row) => ({ value: row.id, label: `${row.name} · ${row.code}` }));
    if (key === 'product_id') return products.map((row) => ({ value: row.id, label: row.sku ? `${row.name} · ${row.sku}` : row.name }));
    if (key === 'fuel_station_id') return rows.stations.map((row) => ({ value: row.id, label: `${row.name ?? '—'} · ${row.code ?? '—'}` }));
    if (key === 'fuel_product_id') return fuelProductOptions.map((row) => ({ value: row.id, label: `${row.name ?? '—'} · ${row.code ?? '—'}` }));
    if (key === 'fuel_tank_id') return tankOptions.map((row) => ({ value: row.id, label: `${row.name ?? '—'} · ${row.code ?? '—'}` }));
    if (key === 'fuel_pump_id') return rows.pumps.map((row) => ({ value: row.id, label: `${row.pump_number ?? '—'} · ${row.name ?? '—'}` }));
    return null;
  }

  const fieldLabel = (key: string) => ({
    branch_id: t('branch'), warehouse_id: t('warehouse'), code: t('code'), name: t('name'), city: t('city'), timezone: t('timezone'),
    status: t('status'), product_id: t('product'), density_kg_per_m3: t('density'), tax_category: t('taxCategory'),
    fuel_station_id: t('station'), fuel_product_id: t('fuelProduct'), capacity_milliliters: t('capacity'),
    safe_capacity_milliliters: t('safeCapacity'), minimum_level_milliliters: t('minimumLevel'), dead_stock_milliliters: t('deadStock'),
    opening_volume_milliliters: t('openingVolume'), pump_number: t('pumpNumber'), fuel_pump_id: t('pump'), fuel_tank_id: t('tank'),
    nozzle_number: t('nozzleNumber'), meter_opening_milliliters: t('meterOpening'), is_active: t('status'),
  }[key] ?? key);

  function displayStatus(row: Item) {
    if (kind === 'products') return row.is_active === false ? t('inactive') : t('active');
    const value = String(row.status ?? '');
    return value === 'maintenance' ? t('maintenance') : value === 'inactive' ? t('inactive') : t('active');
  }

  if (loading) return <div className="space-y-4" aria-busy="true">{[0, 1].map((row) => <Skeleton key={row} className="h-44 w-full" />)}</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/fuel-stations" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            <ArrowRight className="h-4 w-4" strokeWidth={1.7} />{t('backWorkspace')}
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-text">{t('title')}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{t('subtitle')}</p>
        </div>
        <Button onClick={startCreate}><Plus className="h-4 w-4" strokeWidth={1.7} />{t('add')} {labels[kind]}</Button>
      </div>

      <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-muted">{t('manageHint')}</p>
      {kind === 'stations' && rows.stations.some((row) => !row.warehouse_id) && (
        <p role="note" className="rounded-md border border-border bg-primary-soft px-3 py-2 text-xs leading-relaxed text-text">{t('warehouseUnsetWarning')}</p>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
        {(Object.keys(labels) as Kind[]).map((tab) => (
          <Button key={tab} type="button" size="sm" className="shrink-0" variant={kind === tab ? 'primary' : 'outline'}
            onClick={() => { setKind(tab); reset(tab); }}>{labels[tab]}</Button>
        ))}
      </div>

      {error && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.68fr)]">
        <Card>
          <CardHeader><CardTitle>{labels[kind]}</CardTitle></CardHeader>
          <CardContent>
            {rows[kind].length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted">{t('empty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead className="border-b border-border text-xs text-muted">
                    <tr><th className="px-2 py-2 text-start">{t('name')}</th><th className="px-2 py-2 text-start">{t('code')}</th><th className="px-2 py-2 text-start">{t('status')}</th><th className="px-2 py-2" /></tr>
                  </thead>
                  <tbody>
                    {rows[kind].map((row) => (
                      <tr key={row.id} className="border-b border-border/70 last:border-0">
                        <td className="px-2 py-3 font-medium text-text">{String(row.name ?? row.pump_number ?? row.nozzle_number ?? '—')}</td>
                        <td className="num px-2 py-3 text-muted">{String(row.code ?? row.pump_number ?? row.nozzle_number ?? '—')}</td>
                        <td className="px-2 py-3"><Badge tone={statusTone(kind === 'products' ? row.is_active : row.status)}>{displayStatus(row)}</Badge></td>
                        <td className="px-2 py-3"><div className="flex justify-end gap-1">
                          <Button type="button" variant="ghost" size="icon" aria-label={t('edit')} onClick={() => startEdit(row)}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button>
                          <Button type="button" variant="ghost" size="icon" aria-label={t('delete')} onClick={() => remove(row)}><Trash2 className="h-4 w-4" strokeWidth={1.7} /></Button>
                        </div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{editing ? t('edit') : t('add')} {labels[kind]}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              {FIELDS[kind].map((field) => {
                const key = field.key;
                const options = selectOptions(key);
                const status = key === 'status';
                const boolean = key === 'is_active';
                return (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={key}>{fieldLabel(key)}</Label>
                    {options || status || boolean ? (
                      <>
                        <Select id={key} value={form[key] ?? ''} onChange={(event) => set(key, event.target.value)} required={field.required}>
                          {options && <><option value="">—</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</>}
                          {status && <><option value="active">{t('active')}</option><option value="inactive">{t('inactive')}</option><option value="maintenance">{t('maintenance')}</option></>}
                          {boolean && <><option value="true">{t('active')}</option><option value="false">{t('inactive')}</option></>}
                        </Select>
                        {key === 'warehouse_id' && <p className="text-xs leading-relaxed text-muted">{t('warehouseHint')}</p>}
                      </>
                    ) : (
                      <Input id={key} value={form[key] ?? ''} type={field.volume || field.numeric ? 'number' : 'text'}
                        inputMode={field.volume || field.numeric ? 'decimal' : undefined} min={field.volume ? '0' : undefined}
                        step={field.volume ? '0.001' : field.numeric ? '1' : undefined} dir={key === 'code' ? 'ltr' : undefined}
                        onChange={(event) => set(key, event.target.value)} required={field.required} />
                    )}
                  </div>
                );
              })}
              <div className="flex justify-end gap-2 pt-2 sm:col-span-2 xl:col-span-1">
                <Button type="button" variant="outline" onClick={() => reset()}>{t('cancel')}</Button>
                <Button type="submit" disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />}{t('save')}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
