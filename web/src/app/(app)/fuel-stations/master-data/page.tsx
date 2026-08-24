'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, ChevronDown, CircleAlert, Fuel, Loader2, Pencil, Plus, Power, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatMillilitersAsLiters, litersToMilliliters, millilitersToLiters } from '@/lib/fuel-quantity';
import { nozzleSelectionForTank, tanksForPump, tanksForStation } from '@/lib/fuel-master-data';

type Kind = 'stations' | 'products' | 'tanks' | 'pumps' | 'nozzles';
type Status = 'active' | 'inactive' | 'maintenance';
type Ref = { id: string; name?: string | null; code?: string | null; pump_number?: string | null; unit?: string | null };
type Station = { id: string; code: string; name: string; branch_id: string; warehouse_id?: string | null; city?: string | null; timezone?: string | null; status: Status; branch?: Ref | null; warehouse?: Ref | null };
type FuelProduct = { id: string; product_id: string; code: string; name: string; density_kg_per_m3?: number | null; tax_category?: string | null; is_active: boolean; product?: Ref | null };
type Tank = { id: string; fuel_station_id: string; fuel_product_id: string; code: string; name: string; capacity_milliliters: number; safe_capacity_milliliters: number; minimum_level_milliliters: number; dead_stock_milliliters: number; opening_volume_milliliters: number; atg_source_key?: string | null; status: Status; station?: Ref | null; fuel_product?: Ref | null };
type Pump = { id: string; fuel_station_id: string; pump_number: string; name?: string | null; controller_key?: string | null; status: Status; nozzles_count?: number; station?: Ref | null };
type Nozzle = { id: string; fuel_pump_id: string; fuel_tank_id: string; fuel_product_id: string; nozzle_number: string; controller_key?: string | null; meter_opening_milliliters: number; status: Status; pump?: Ref | null; tank?: Ref | null; fuel_product?: Ref | null };
type Branch = { id: string; name: string; code: string };
type Product = { id: string; name: string; sku?: string | null; unit?: string | null; is_active?: boolean };
type Warehouse = { id: string; name: string; code: string; branch_id?: string | null; is_active?: boolean };
type Rows = { stations: Station[]; products: FuelProduct[]; tanks: Tank[]; pumps: Pump[]; nozzles: Nozzle[] };
type Form = Record<string, string>;
type Editor = { kind: Kind; id?: string; form: Form } | null;

const ENDPOINTS: Record<Kind, string> = {
  stations: '/fuel-stations/stations',
  products: '/fuel-stations/products',
  tanks: '/fuel-stations/tanks',
  pumps: '/fuel-stations/pumps',
  nozzles: '/fuel-stations/nozzles',
};

const EMPTY_ROWS: Rows = { stations: [], products: [], tanks: [], pumps: [], nozzles: [] };
const EMPTY_FORMS: Record<Kind, Form> = {
  stations: { branch_id: '', warehouse_id: '', code: '', name: '', city: '', timezone: 'Asia/Riyadh', status: 'active' },
  products: { product_id: '', code: '', name: '', density_kg_per_m3: '', tax_category: '', is_active: 'true' },
  tanks: { fuel_station_id: '', fuel_product_id: '', code: '', name: '', capacity_liters: '', safe_capacity_liters: '', minimum_liters: '0', dead_stock_liters: '0', opening_liters: '0', status: 'active', atg_source_key: '' },
  pumps: { fuel_station_id: '', pump_number: '', name: '', status: 'active', controller_key: '' },
  nozzles: { fuel_pump_id: '', fuel_tank_id: '', fuel_product_id: '', nozzle_number: '', meter_opening_liters: '0', status: 'active', controller_key: '' },
};

export default function FuelStationsMasterDataPage() {
  const t = useTranslations('fuelStationsMasterData');
  const locale = useLocale();
  const { success } = useToast();
  const [kind, setKind] = useState<Kind>('stations');
  const [rows, setRows] = useState<Rows>(EMPTY_ROWS);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [saving, setSaving] = useState(false);

  const labels: Record<Kind, string> = {
    stations: t('stations'), products: t('fuelProducts'), tanks: t('tanks'), pumps: t('pumps'), nozzles: t('nozzles'),
  };

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api<{ data: Station[] }>(ENDPOINTS.stations),
      api<{ data: FuelProduct[] }>(ENDPOINTS.products),
      api<{ data: Tank[] }>(ENDPOINTS.tanks),
      api<{ data: Pump[] }>(ENDPOINTS.pumps),
      api<{ data: Nozzle[] }>(ENDPOINTS.nozzles),
      api<{ data: Branch[] }>('/branches'),
      api<{ data: Product[] }>('/products'),
      api<{ data: Warehouse[] }>('/warehouses'),
    ] as const)
      .then(([stations, fuelProducts, tanks, pumps, nozzles, branchResponse, productResponse, warehouseResponse]) => {
        setRows({ stations: stations.data, products: fuelProducts.data, tanks: tanks.data, pumps: pumps.data, nozzles: nozzles.data });
        setBranches(branchResponse.data);
        setProducts(productResponse.data.filter((product) => product.is_active !== false));
        setWarehouses(warehouseResponse.data);
      })
      .catch((reason) => setError(reason instanceof ApiError ? reason.message : t('loadFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const activeRows = rows[kind];
  const hasMissingWarehouse = rows.stations.some((station) => !station.warehouse_id);

  function beginCreate(nextKind = kind) {
    setKind(nextKind);
    setError(null);
    setEditor({ kind: nextKind, form: { ...EMPTY_FORMS[nextKind] } });
  }

  function beginEdit(row: Station | FuelProduct | Tank | Pump | Nozzle) {
    const nextKind = entityKind(row);
    setKind(nextKind);
    setError(null);
    setEditor({ kind: nextKind, id: row.id, form: formFor(row, nextKind) });
  }

  function updateForm(key: string, value: string) {
    setEditor((current) => current ? { ...current, form: { ...current.form, [key]: value } } : current);
  }

  function chooseNozzleTank(tankId: string) {
    setEditor((current) => {
      if (!current || current.kind !== 'nozzles') return current;
      const tank = rows.tanks.find((item) => item.id === tankId);
      const selection = nozzleSelectionForTank(current.form.fuel_pump_id, tank);
      return { ...current, form: { ...current.form, fuel_tank_id: tankId, fuel_product_id: selection?.fuelProductId ?? '' } };
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!editor) return;
    setSaving(true);
    setError(null);

    try {
      const body = payloadFor(editor.kind, editor.form, t);
      const path = editor.id ? `${ENDPOINTS[editor.kind]}/${editor.id}` : ENDPOINTS[editor.kind];
      await api(path, { method: editor.id ? 'PUT' : 'POST', body });
      success(editor.id ? t('updated') : t('created'));
      setEditor(null);
      load();
    } catch (reason) {
      setError(reason instanceof ApiError || reason instanceof Error ? reason.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function retire(row: Station | FuelProduct | Tank | Pump | Nozzle) {
    const rowKind = entityKind(row);
    const confirmation = window.confirm(t('confirmRetire', { name: displayName(row) }));
    if (!confirmation) return;
    setError(null);

    try {
      const body = rowKind === 'products' ? { is_active: false } : { status: 'inactive' };
      await api(`${ENDPOINTS[rowKind]}/${row.id}`, { method: 'PUT', body });
      success(t('retired'));
      load();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t('retireFailed'));
    }
  }

  const selectedPump = editor?.kind === 'nozzles' ? rows.pumps.find((pump) => pump.id === editor.form.fuel_pump_id) : undefined;
  const selectableTanks = editor?.kind === 'nozzles' ? tanksForPump(rows.pumps, rows.tanks, editor.form.fuel_pump_id) : [];
  const selectedTank = editor?.kind === 'nozzles' ? rows.tanks.find((tank) => tank.id === editor.form.fuel_tank_id) : undefined;

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/fuel-stations" className="inline-flex min-h-11 items-center gap-1 text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <ArrowRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.7} />{t('backWorkspace')}
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-text">{t('title')}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{t('subtitle')}</p>
        </div>
        <Button className="min-h-11" onClick={() => beginCreate()}><Plus className="h-4 w-4" strokeWidth={1.7} />{t('add')} {labels[kind]}</Button>
      </header>

      <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-muted">{t('manageHint')}</p>
      {hasMissingWarehouse && <p role="note" className="rounded-md border border-border bg-primary-soft px-3 py-2 text-sm leading-relaxed text-text">{t('warehouseUnsetWarning')}</p>}
      {error && <ErrorBanner message={error} retry={load} retryLabel={t('retry')} />}

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={t('entityTabs')}>
        {(Object.keys(labels) as Kind[]).map((tab) => (
          <Button key={tab} type="button" className="min-h-11 shrink-0" size="sm" variant={kind === tab ? 'primary' : 'outline'} role="tab" aria-selected={kind === tab} onClick={() => { setKind(tab); setEditor(null); setError(null); }}>
            {labels[tab]} <span className="num text-xs opacity-75">{rows[tab].length}</span>
          </Button>
        ))}
      </div>

      {editor && <EditorCard editor={editor} branches={branches} products={products} warehouses={warehouses} rows={rows} selectableTanks={selectableTanks} selectedPump={selectedPump} selectedTank={selectedTank} t={t} saving={saving} onChange={updateForm} onChooseTank={chooseNozzleTank} onSubmit={submit} onCancel={() => setEditor(null)} />}

      <EntityList kind={kind} rows={activeRows} locale={locale} t={t} onEdit={beginEdit} onRetire={retire} />
    </div>
  );
}

function EditorCard({ editor, branches, products, warehouses, rows, selectableTanks, selectedPump, selectedTank, t, saving, onChange, onChooseTank, onSubmit, onCancel }: {
  editor: Exclude<Editor, null>; branches: Branch[]; products: Product[]; warehouses: Warehouse[]; rows: Rows; selectableTanks: Tank[]; selectedPump?: Pump; selectedTank?: Tank; t: ReturnType<typeof useTranslations>; saving: boolean; onChange: (key: string, value: string) => void; onChooseTank: (tankId: string) => void; onSubmit: (event: React.FormEvent) => void; onCancel: () => void;
}) {
  const form = editor.form;
  const title = editor.id ? t('editEntity', { entity: labelForKind(editor.kind, t) }) : t('addEntity', { entity: labelForKind(editor.kind, t) });
  const stationTanks = editor.kind === 'tanks' ? tanksForStation(rows.tanks, form.fuel_station_id) : [];

  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-5">
          {editor.kind === 'stations' && <StationFields form={form} branches={branches} warehouses={warehouses} t={t} onChange={onChange} />}
          {editor.kind === 'products' && <FuelProductFields form={form} products={products} t={t} onChange={onChange} />}
          {editor.kind === 'tanks' && <TankFields form={form} stations={rows.stations} fuelProducts={rows.products} existingAtStation={stationTanks} t={t} onChange={onChange} />}
          {editor.kind === 'pumps' && <PumpFields form={form} stations={rows.stations} t={t} onChange={onChange} />}
          {editor.kind === 'nozzles' && <NozzleFields form={form} pumps={rows.pumps} tanks={selectableTanks} selectedPump={selectedPump} selectedTank={selectedTank} t={t} onChange={onChange} onChooseTank={onChooseTank} />}
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button type="button" className="min-h-11" variant="outline" onClick={onCancel}>{t('cancel')}</Button>
            <Button type="submit" className="min-h-11" disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />}{t('save')}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function StationFields({ form, branches, warehouses, t, onChange }: { form: Form; branches: Branch[]; warehouses: Warehouse[]; t: ReturnType<typeof useTranslations>; onChange: (key: string, value: string) => void }) {
  const availableWarehouses = warehouses.filter((warehouse) => warehouse.is_active !== false && (!warehouse.branch_id || warehouse.branch_id === form.branch_id));
  return <>
    <FormSection title={t('stationDetails')}><div className="grid gap-4 md:grid-cols-2">
      <FieldSelect label={t('branch')} value={form.branch_id} required onChange={(value) => { onChange('branch_id', value); onChange('warehouse_id', ''); }} options={branches.map((branch) => ({ value: branch.id, label: `${branch.name} · ${branch.code}` }))} />
      <FieldSelect label={t('warehouse')} value={form.warehouse_id} hint={t('warehouseHint')} onChange={(value) => onChange('warehouse_id', value)} options={availableWarehouses.map((warehouse) => ({ value: warehouse.id, label: `${warehouse.name} · ${warehouse.code}` }))} />
      <FieldInput label={t('stationCode')} value={form.code} required dir="ltr" onChange={(value) => onChange('code', value)} />
      <FieldInput label={t('stationName')} value={form.name} required onChange={(value) => onChange('name', value)} />
      <FieldInput label={t('city')} value={form.city} onChange={(value) => onChange('city', value)} />
      <FieldSelect label={t('status')} value={form.status} required onChange={(value) => onChange('status', value)} options={statusOptions(t)} />
    </div></FormSection>
    <AdvancedFields title={t('operatingDetails')}><div className="grid gap-4 md:grid-cols-2"><FieldInput label={t('timezone')} value={form.timezone} required onChange={(value) => onChange('timezone', value)} /><p className="self-end text-sm leading-relaxed text-muted">{t('stationAdvancedHint')}</p></div></AdvancedFields>
  </>;
}

function FuelProductFields({ form, products, t, onChange }: { form: Form; products: Product[]; t: ReturnType<typeof useTranslations>; onChange: (key: string, value: string) => void }) {
  return <FormSection title={t('fuelProductDetails')}><div className="grid gap-4 md:grid-cols-2">
    <FieldSelect label={t('product')} value={form.product_id} required onChange={(value) => onChange('product_id', value)} options={products.map((product) => ({ value: product.id, label: product.sku ? `${product.name} · ${product.sku}` : product.name }))} />
    <FieldInput label={t('fuelProductCode')} value={form.code} required dir="ltr" onChange={(value) => onChange('code', value)} />
    <FieldInput label={t('fuelProductName')} value={form.name} required onChange={(value) => onChange('name', value)} />
    <FieldInput label={t('density')} value={form.density_kg_per_m3} type="number" min="1" step="1" onChange={(value) => onChange('density_kg_per_m3', value)} />
    <FieldInput label={t('taxCategory')} value={form.tax_category} onChange={(value) => onChange('tax_category', value)} />
    <FieldSelect label={t('availability')} value={form.is_active} required onChange={(value) => onChange('is_active', value)} options={[{ value: 'true', label: t('active') }, { value: 'false', label: t('inactive') }]} />
  </div></FormSection>;
}

function TankFields({ form, stations, fuelProducts, existingAtStation, t, onChange }: { form: Form; stations: Station[]; fuelProducts: FuelProduct[]; existingAtStation: Tank[]; t: ReturnType<typeof useTranslations>; onChange: (key: string, value: string) => void }) {
  return <>
    <FormSection title={t('tankMapping')}><div className="grid gap-4 md:grid-cols-2">
      <FieldSelect label={t('station')} value={form.fuel_station_id} required onChange={(value) => onChange('fuel_station_id', value)} options={stations.map(stationOption)} />
      <FieldSelect label={t('fuelProduct')} value={form.fuel_product_id} required onChange={(value) => onChange('fuel_product_id', value)} options={fuelProducts.filter((product) => product.is_active).map(fuelProductOption)} />
      <FieldInput label={t('tankCode')} value={form.code} required dir="ltr" onChange={(value) => onChange('code', value)} />
      <FieldInput label={t('tankName')} value={form.name} required onChange={(value) => onChange('name', value)} />
      <FieldSelect label={t('status')} value={form.status} required onChange={(value) => onChange('status', value)} options={statusOptions(t)} />
    </div>{existingAtStation.length > 0 && <p className="mt-3 text-sm text-muted">{t('stationTankContext', { count: existingAtStation.length })}</p>}</FormSection>
    <FormSection title={t('tankCapacity')} hint={t('litersBoundaryHint')}><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <LiterField label={t('capacity')} value={form.capacity_liters} required onChange={(value) => onChange('capacity_liters', value)} />
      <LiterField label={t('safeCapacity')} value={form.safe_capacity_liters} required onChange={(value) => onChange('safe_capacity_liters', value)} />
      <LiterField label={t('minimumLevel')} value={form.minimum_liters} onChange={(value) => onChange('minimum_liters', value)} />
      <LiterField label={t('deadStock')} value={form.dead_stock_liters} onChange={(value) => onChange('dead_stock_liters', value)} />
      <LiterField label={t('openingVolume')} value={form.opening_liters} onChange={(value) => onChange('opening_liters', value)} />
    </div></FormSection>
    <AdvancedFields title={t('integrationFields')} hint={t('integrationFieldsHint')}><FieldInput label={t('atgKey')} value={form.atg_source_key} dir="ltr" onChange={(value) => onChange('atg_source_key', value)} /></AdvancedFields>
  </>;
}

function PumpFields({ form, stations, t, onChange }: { form: Form; stations: Station[]; t: ReturnType<typeof useTranslations>; onChange: (key: string, value: string) => void }) {
  return <>
    <FormSection title={t('pumpDetails')}><div className="grid gap-4 md:grid-cols-2">
      <FieldSelect label={t('station')} value={form.fuel_station_id} required onChange={(value) => onChange('fuel_station_id', value)} options={stations.map(stationOption)} />
      <FieldInput label={t('pumpNumber')} value={form.pump_number} required dir="ltr" onChange={(value) => onChange('pump_number', value)} />
      <FieldInput label={t('pumpName')} value={form.name} onChange={(value) => onChange('name', value)} />
      <FieldSelect label={t('status')} value={form.status} required onChange={(value) => onChange('status', value)} options={statusOptions(t)} />
    </div></FormSection>
    <AdvancedFields title={t('integrationFields')} hint={t('integrationFieldsHint')}><FieldInput label={t('controllerKey')} value={form.controller_key} dir="ltr" onChange={(value) => onChange('controller_key', value)} /></AdvancedFields>
  </>;
}

function NozzleFields({ form, pumps, tanks, selectedPump, selectedTank, t, onChange, onChooseTank }: { form: Form; pumps: Pump[]; tanks: Tank[]; selectedPump?: Pump; selectedTank?: Tank; t: ReturnType<typeof useTranslations>; onChange: (key: string, value: string) => void; onChooseTank: (tankId: string) => void }) {
  const selectedFuel = selectedTank?.fuel_product;
  return <>
    <FormSection title={t('nozzleMapping')} hint={t('nozzleMappingHint')}><div className="grid gap-4 md:grid-cols-2">
      <FieldSelect label={t('pump')} value={form.fuel_pump_id} required onChange={(value) => { onChange('fuel_pump_id', value); onChooseTank(''); }} options={pumps.map(pumpOption)} />
      <FieldSelect label={t('tank')} value={form.fuel_tank_id} required disabled={!selectedPump} hint={!selectedPump ? t('choosePumpFirst') : undefined} onChange={onChooseTank} options={tanks.map(tankOption)} />
      <ReadOnlyField label={t('fuelProduct')} value={selectedFuel ? `${selectedFuel.name ?? ''}${selectedFuel.code ? ` · ${selectedFuel.code}` : ''}` : t('derivedAfterTank')} />
      <FieldInput label={t('nozzleNumber')} value={form.nozzle_number} required dir="ltr" onChange={(value) => onChange('nozzle_number', value)} />
      <LiterField label={t('meterOpening')} value={form.meter_opening_liters} onChange={(value) => onChange('meter_opening_liters', value)} />
      <FieldSelect label={t('status')} value={form.status} required onChange={(value) => onChange('status', value)} options={statusOptions(t)} />
    </div></FormSection>
    <AdvancedFields title={t('integrationFields')} hint={t('integrationFieldsHint')}><FieldInput label={t('controllerKey')} value={form.controller_key} dir="ltr" onChange={(value) => onChange('controller_key', value)} /></AdvancedFields>
  </>;
}

function EntityList({ kind, rows, locale, t, onEdit, onRetire }: { kind: Kind; rows: Array<Station | FuelProduct | Tank | Pump | Nozzle>; locale: string; t: ReturnType<typeof useTranslations>; onEdit: (row: Station | FuelProduct | Tank | Pump | Nozzle) => void; onRetire: (row: Station | FuelProduct | Tank | Pump | Nozzle) => void }) {
  if (rows.length === 0) return <Card><CardContent className="py-10 text-center"><Fuel className="mx-auto h-6 w-6 text-muted" strokeWidth={1.7} /><p className="mt-3 text-sm text-muted">{t('emptyEntity', { entity: labelForKind(kind, t) })}</p></CardContent></Card>;

  return <Card><CardHeader><CardTitle>{labelForKind(kind, t)}</CardTitle></CardHeader><CardContent>
    <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[54rem] text-sm"><thead className="border-b border-border text-start text-xs text-muted"><tr>{tableHeaders(kind, t).map((header) => <th key={header} className="px-3 py-3 font-medium">{header}</th>)}<th className="px-3 py-3 text-end font-medium">{t('actions')}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b border-border/70 last:border-0"><EntityCells kind={kind} row={row} locale={locale} t={t} /><td className="px-3 py-3"><RowActions row={row} t={t} onEdit={onEdit} onRetire={onRetire} /></td></tr>)}</tbody></table></div>
    <div className="space-y-3 lg:hidden">{rows.map((row) => <article key={row.id} className="rounded-md border border-border p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate font-medium text-text">{displayName(row)}</h2><p className="mt-1 text-sm text-muted">{entitySummary(kind, row, locale, t)}</p></div><StatusBadge row={row} t={t} /></div><div className="mt-3 border-t border-border pt-3"><RowActions row={row} t={t} onEdit={onEdit} onRetire={onRetire} /></div></article>)}</div>
  </CardContent></Card>;
}

function EntityCells({ kind, row, locale, t }: { kind: Kind; row: Station | FuelProduct | Tank | Pump | Nozzle; locale: string; t: ReturnType<typeof useTranslations> }) {
  if (kind === 'stations') { const station = row as Station; return <><td className="px-3 py-3 font-medium text-text">{station.name}</td><td className="num px-3 py-3 text-muted">{station.code}</td><td className="px-3 py-3 text-muted">{station.branch?.name ?? '—'}</td><td className="px-3 py-3"><StatusBadge row={station} t={t} /></td></>; }
  if (kind === 'products') { const product = row as FuelProduct; return <><td className="px-3 py-3 font-medium text-text">{product.name}</td><td className="num px-3 py-3 text-muted">{product.code}</td><td className="px-3 py-3 text-muted">{product.product?.name ?? '—'}</td><td className="px-3 py-3"><StatusBadge row={product} t={t} /></td></>; }
  if (kind === 'tanks') { const tank = row as Tank; return <><td className="px-3 py-3 font-medium text-text">{tank.name}</td><td className="num px-3 py-3 text-muted">{tank.code}</td><td className="px-3 py-3 text-muted">{tank.station?.name ?? '—'}</td><td className="px-3 py-3 text-end num text-text">{formatMillilitersAsLiters(tank.capacity_milliliters, locale)}</td><td className="px-3 py-3"><StatusBadge row={tank} t={t} /></td></>; }
  if (kind === 'pumps') { const pump = row as Pump; return <><td className="px-3 py-3 font-medium text-text">{pump.name || `${t('pump')} ${pump.pump_number}`}</td><td className="num px-3 py-3 text-muted">{pump.pump_number}</td><td className="px-3 py-3 text-muted">{pump.station?.name ?? '—'}</td><td className="num px-3 py-3 text-muted">{pump.nozzles_count ?? 0}</td><td className="px-3 py-3"><StatusBadge row={pump} t={t} /></td></>; }
  const nozzle = row as Nozzle; return <><td className="px-3 py-3 font-medium text-text">{nozzle.nozzle_number}</td><td className="px-3 py-3 text-muted">{nozzle.pump?.pump_number ?? '—'}</td><td className="px-3 py-3 text-muted">{nozzle.tank?.name ?? '—'}</td><td className="px-3 py-3 text-muted">{nozzle.fuel_product?.name ?? '—'}</td><td className="px-3 py-3"><StatusBadge row={nozzle} t={t} /></td></>;
}

function RowActions({ row, t, onEdit, onRetire }: { row: Station | FuelProduct | Tank | Pump | Nozzle; t: ReturnType<typeof useTranslations>; onEdit: (row: Station | FuelProduct | Tank | Pump | Nozzle) => void; onRetire: (row: Station | FuelProduct | Tank | Pump | Nozzle) => void }) {
  const retired = isInactive(row);
  return <div className="flex flex-wrap justify-end gap-2"><Button type="button" className="min-h-11" variant="outline" size="sm" onClick={() => onEdit(row)}><Pencil className="h-4 w-4" strokeWidth={1.7} />{t('edit')}</Button>{!retired && <Button type="button" className="min-h-11" variant="ghost" size="sm" onClick={() => onRetire(row)}><Power className="h-4 w-4" strokeWidth={1.7} />{t('retire')}</Button>}</div>;
}

function StatusBadge({ row, t }: { row: Station | FuelProduct | Tank | Pump | Nozzle; t: ReturnType<typeof useTranslations> }) {
  const status = 'is_active' in row ? (row.is_active ? 'active' : 'inactive') : row.status;
  return <Badge tone={status === 'active' ? 'positive' : status === 'maintenance' ? 'warning' : 'muted'}>{statusLabel(status, t)}</Badge>;
}

function FormSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <section className="space-y-3"><div><h2 className="font-medium text-text">{title}</h2>{hint && <p className="mt-1 text-sm leading-relaxed text-muted">{hint}</p>}</div>{children}</section>;
}

function AdvancedFields({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <details className="group rounded-md border border-border"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-text marker:hidden"><span>{title}</span><ChevronDown className="h-4 w-4 text-muted transition-transform group-open:rotate-180" strokeWidth={1.7} /></summary><div className="border-t border-border px-4 py-4">{hint && <p className="mb-4 text-sm leading-relaxed text-muted">{hint}</p>}{children}</div></details>;
}

function FieldInput({ label, value, onChange, type = 'text', required, min, step, dir }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; min?: string; step?: string; dir?: 'ltr' | 'rtl' }) {
  return <div className="space-y-1.5"><Label>{label}</Label><Input value={value} type={type} min={min} step={step} required={required} dir={dir} inputMode={type === 'number' ? 'decimal' : undefined} onChange={(event) => onChange(event.target.value)} /></div>;
}

function LiterField({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <div className="space-y-1.5"><Label>{label}</Label><div className="relative"><Input value={value} type="number" min="0" step="0.001" required={required} inputMode="decimal" className="pe-12" onChange={(event) => onChange(event.target.value)} /><span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted">L</span></div></div>;
}

function FieldSelect({ label, value, onChange, options, required, disabled, hint }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; required?: boolean; disabled?: boolean; hint?: string }) {
  return <div className="space-y-1.5"><Label>{label}</Label><Select value={value} required={required} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">—</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>{hint && <p className="text-xs leading-relaxed text-muted">{hint}</p>}</div>;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) { return <div className="space-y-1.5"><Label>{label}</Label><p className="flex min-h-10 items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-text">{value}</p></div>; }
function ErrorBanner({ message, retry, retryLabel }: { message: string; retry: () => void; retryLabel: string }) { return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-negative/30 bg-negative/10 px-3 py-3 text-sm text-negative"><span className="flex items-center gap-2"><CircleAlert className="h-4 w-4 shrink-0" strokeWidth={1.7} />{message}</span><Button type="button" className="min-h-11" variant="outline" size="sm" onClick={retry}><RefreshCw className="h-4 w-4" strokeWidth={1.7} />{retryLabel}</Button></div>; }
function LoadingState() { return <div className="space-y-4">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-36 w-full" />)}</div>; }

function entityKind(row: Station | FuelProduct | Tank | Pump | Nozzle): Kind { if ('capacity_milliliters' in row) return 'tanks'; if ('pump_number' in row) return 'pumps'; if ('nozzle_number' in row) return 'nozzles'; if ('product_id' in row) return 'products'; return 'stations'; }
function isInactive(row: Station | FuelProduct | Tank | Pump | Nozzle): boolean { return 'is_active' in row ? !row.is_active : row.status === 'inactive'; }
function displayName(row: Station | FuelProduct | Tank | Pump | Nozzle): string { if ('nozzle_number' in row) return row.nozzle_number; if ('pump_number' in row) return row.name || row.pump_number; return row.name; }
function labelForKind(kind: Kind, t: ReturnType<typeof useTranslations>) { return ({ stations: t('stations'), products: t('fuelProducts'), tanks: t('tanks'), pumps: t('pumps'), nozzles: t('nozzles') })[kind]; }
function statusLabel(status: string, t: ReturnType<typeof useTranslations>) { return status === 'active' ? t('active') : status === 'maintenance' ? t('maintenance') : t('inactive'); }
function statusOptions(t: ReturnType<typeof useTranslations>) { return [{ value: 'active', label: t('active') }, { value: 'inactive', label: t('inactive') }, { value: 'maintenance', label: t('maintenance') }]; }
function stationOption(station: Station) { return { value: station.id, label: `${station.name} · ${station.code}` }; }
function fuelProductOption(product: FuelProduct) { return { value: product.id, label: `${product.name} · ${product.code}` }; }
function tankOption(tank: Tank) { return { value: tank.id, label: `${tank.name} · ${tank.code}` }; }
function pumpOption(pump: Pump) { return { value: pump.id, label: `${pump.pump_number}${pump.name ? ` · ${pump.name}` : ''}${pump.station?.name ? ` — ${pump.station.name}` : ''}` }; }
function tableHeaders(kind: Kind, t: ReturnType<typeof useTranslations>) { return kind === 'stations' ? [t('stationName'), t('stationCode'), t('branch'), t('status')] : kind === 'products' ? [t('fuelProductName'), t('fuelProductCode'), t('product'), t('status')] : kind === 'tanks' ? [t('tankName'), t('tankCode'), t('station'), t('capacity'), t('status')] : kind === 'pumps' ? [t('pumpName'), t('pumpNumber'), t('station'), t('nozzlesCount'), t('status')] : [t('nozzleNumber'), t('pump'), t('tank'), t('fuelProduct'), t('status')]; }
function entitySummary(kind: Kind, row: Station | FuelProduct | Tank | Pump | Nozzle, locale: string, t: ReturnType<typeof useTranslations>) { if (kind === 'stations') { const item = row as Station; return `${item.code} · ${item.branch?.name ?? '—'}`; } if (kind === 'products') { const item = row as FuelProduct; return `${item.code} · ${item.product?.name ?? '—'}`; } if (kind === 'tanks') { const item = row as Tank; return `${item.station?.name ?? '—'} · ${formatMillilitersAsLiters(item.capacity_milliliters, locale)}`; } if (kind === 'pumps') { const item = row as Pump; return `${item.pump_number} · ${item.station?.name ?? '—'} · ${t('nozzlesCountValue', { count: item.nozzles_count ?? 0 })}`; } const item = row as Nozzle; return `${item.pump?.pump_number ?? '—'} · ${item.tank?.name ?? '—'} · ${item.fuel_product?.name ?? '—'}`; }

function formFor(row: Station | FuelProduct | Tank | Pump | Nozzle, kind: Kind): Form {
  if (kind === 'stations') { const item = row as Station; return { ...EMPTY_FORMS.stations, branch_id: item.branch_id, warehouse_id: item.warehouse_id ?? '', code: item.code, name: item.name, city: item.city ?? '', timezone: item.timezone ?? 'Asia/Riyadh', status: item.status }; }
  if (kind === 'products') { const item = row as FuelProduct; return { ...EMPTY_FORMS.products, product_id: item.product_id, code: item.code, name: item.name, density_kg_per_m3: item.density_kg_per_m3?.toString() ?? '', tax_category: item.tax_category ?? '', is_active: item.is_active ? 'true' : 'false' }; }
  if (kind === 'tanks') { const item = row as Tank; return { ...EMPTY_FORMS.tanks, fuel_station_id: item.fuel_station_id, fuel_product_id: item.fuel_product_id, code: item.code, name: item.name, capacity_liters: millilitersToLiters(item.capacity_milliliters), safe_capacity_liters: millilitersToLiters(item.safe_capacity_milliliters), minimum_liters: millilitersToLiters(item.minimum_level_milliliters), dead_stock_liters: millilitersToLiters(item.dead_stock_milliliters), opening_liters: millilitersToLiters(item.opening_volume_milliliters), atg_source_key: item.atg_source_key ?? '', status: item.status }; }
  if (kind === 'pumps') { const item = row as Pump; return { ...EMPTY_FORMS.pumps, fuel_station_id: item.fuel_station_id, pump_number: item.pump_number, name: item.name ?? '', controller_key: item.controller_key ?? '', status: item.status }; }
  const item = row as Nozzle; return { ...EMPTY_FORMS.nozzles, fuel_pump_id: item.fuel_pump_id, fuel_tank_id: item.fuel_tank_id, fuel_product_id: item.fuel_product_id, nozzle_number: item.nozzle_number, meter_opening_liters: millilitersToLiters(item.meter_opening_milliliters), controller_key: item.controller_key ?? '', status: item.status };
}

function payloadFor(kind: Kind, form: Form, t: ReturnType<typeof useTranslations>) {
  if (kind === 'stations') return nullable({ branch_id: form.branch_id, warehouse_id: form.warehouse_id, code: form.code, name: form.name, city: form.city, timezone: form.timezone, status: form.status });
  if (kind === 'products') return nullable({ product_id: form.product_id, code: form.code, name: form.name, density_kg_per_m3: form.density_kg_per_m3 === '' ? null : Number(form.density_kg_per_m3), tax_category: form.tax_category, is_active: form.is_active === 'true' });
  if (kind === 'tanks') return nullable({ fuel_station_id: form.fuel_station_id, fuel_product_id: form.fuel_product_id, code: form.code, name: form.name, capacity_milliliters: parseLiters(form.capacity_liters, false, t), safe_capacity_milliliters: parseLiters(form.safe_capacity_liters, false, t), minimum_level_milliliters: parseLiters(form.minimum_liters, true, t), dead_stock_milliliters: parseLiters(form.dead_stock_liters, true, t), opening_volume_milliliters: parseLiters(form.opening_liters, true, t), status: form.status, atg_source_key: form.atg_source_key });
  if (kind === 'pumps') return nullable({ fuel_station_id: form.fuel_station_id, pump_number: form.pump_number, name: form.name, status: form.status, controller_key: form.controller_key });
  return nullable({ fuel_pump_id: form.fuel_pump_id, fuel_tank_id: form.fuel_tank_id, fuel_product_id: form.fuel_product_id, nozzle_number: form.nozzle_number, meter_opening_milliliters: parseLiters(form.meter_opening_liters, true, t), status: form.status, controller_key: form.controller_key });
}

function parseLiters(value: string, allowZero: boolean, t: ReturnType<typeof useTranslations>): number { const parsed = litersToMilliliters(value, allowZero); if (parsed === null) throw new Error(t('invalidLiters')); return parsed; }
function nullable<T extends Record<string, string | number | boolean | null>>(body: T): T { return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, typeof value === 'string' && value.trim() === '' ? null : value])) as T; }
