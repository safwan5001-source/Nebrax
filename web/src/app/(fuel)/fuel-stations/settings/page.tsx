'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BadgeDollarSign, CircleAlert, Cog, Database, Radio, RefreshCw, Save, Settings2, ShieldCheck, SlidersHorizontal, Timer, WalletCards } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { litersToMilliliters, millilitersToLiters } from '@/lib/fuel-quantity';
import { formatMinorRiyal, isValidRiyal, minorToRiyal, riyalToMinor, SAUDI_RIYAL_SYMBOL } from '@/lib/money';

type Settings = Record<string, string | number | boolean | string[] | null>;
type Station = {
  id: string;
  name: string;
  code: string;
  status: string;
  timezone?: string | null;
  operating_day_starts_at?: string | null;
  operating_hours?: Record<string, unknown> | null;
  default_inventory_account_id?: string | null;
  default_revenue_account_id?: string | null;
  default_cogs_account_id?: string | null;
};
type Account = { id: string; code: string; name: string; name_en?: string | null; type: string; is_group: boolean; is_active: boolean };
type PaymentMethod = { id: string; name: string; name_en?: string | null; settlement_type: string; is_active: boolean };
type Device = { id: string; name: string; device_key: string; device_type: string; status: string; health: string; sync_status: string; last_seen_at?: string | null; station?: { id: string; name: string; code: string } | null };
type Price = { id: string; fuel_station_id?: string | null; fuel_product_id: string; price_per_liter_minor: number; effective_from: string; effective_until?: string | null; status: string };
type FuelProduct = { id: string; name: string; code: string };
type Tone = 'positive' | 'warning' | 'negative' | 'muted';

const SHIFT_KEYS = [
  'shift_opening_meter_reading_required', 'shift_opening_tank_reading_required', 'shift_opening_cash_float_required',
  'shift_closing_meter_reading_required', 'shift_closing_tank_reading_required', 'shift_mandatory_staff_assignment',
  'shift_mandatory_cash_count', 'shift_supervisor_approval_required', 'shift_allow_close_with_pending_cash_variance',
  'shift_allow_close_with_unresolved_operational_variance',
] as const;
const AVI_KEYS = ['corporate_credit_enabled', 'require_active_contract', 'driver_required', 'vehicle_required', 'fuel_card_required', 'avi_rfid_enabled', 'avi_driver_identity_required', 'avi_enforce_vehicle_tank_capacity', 'fuel_sales_allow_deferred_payment'] as const;
const RECONCILIATION_KEYS = ['reconciliation_tolerance_absolute_milliliters', 'reconciliation_tolerance_basis_points'] as const;
const FUEL_ACCOUNT_KEYS = ['inventory_variance_account_id', 'inventory_gain_account_id', 'grni_account_id'] as const;
const ADVANCED_KEYS = ['device_event_max_lateness_seconds', 'offline_event_retention_days', 'device_max_future_skew_seconds', 'device_offline_after_seconds', 'device_max_retry_attempts', 'device_simulated_ingress_enabled', 'maintenance_default_calendar_interval_days', 'safety_permit_expiry_warning_days', 'fuel_station_alerts_enabled'] as const;
const DEVICE_TONES: Record<string, Tone> = { active: 'positive', inactive: 'muted', retired: 'muted', healthy: 'positive', degraded: 'warning', offline: 'negative', failed: 'negative', synced: 'positive', pending: 'warning' };

export default function FuelStationsSettingsPage() {
  const t = useTranslations('fuelStationsSettings');
  const locale = useLocale();
  const { success } = useToast();
  const [tenant, setTenant] = useState<Settings | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [products, setProducts] = useState<FuelProduct[]>([]);
  const [stationId, setStationId] = useState('');
  const [stationSettings, setStationSettings] = useState<Settings | null>(null);
  const [tenantPatch, setTenantPatch] = useState<Partial<Settings>>({});
  const [stationPatch, setStationPatch] = useState<Partial<Settings>>({});
  const [stationRecordPatch, setStationRecordPatch] = useState<Partial<Station>>({});
  const [reason, setReason] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManage = permissions.includes('*') || permissions.includes('fuel_stations.manage');
  const canManageScope = canManage && (stationId === '' || stationSettings !== null);
  const selectedStation = stations.find((station) => station.id === stationId) ?? null;
  const isStationScope = stationId !== '' && stationSettings !== null;
  const scopeValues = isStationScope ? stationSettings : tenant;
  const stationRecordValue = <K extends keyof Station>(key: K): Station[K] | undefined => Object.prototype.hasOwnProperty.call(stationRecordPatch, key) ? stationRecordPatch[key] : selectedStation?.[key];
  const patches = isStationScope ? stationPatch : tenantPatch;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [settingsResponse, stationsResponse, accountsResponse, paymentResponse, productResponse, deviceResponse] = await Promise.all([
        api<{ data: Settings }>('/fuel-stations/settings'),
        api<{ data: Station[] }>('/fuel-stations/stations'),
        api<{ data: Account[] | { data: Account[] } }>('/accounts').catch(() => ({ data: [] })),
        api<{ data: PaymentMethod[] | { data: PaymentMethod[] } }>('/payment-methods').catch(() => ({ data: [] })),
        api<{ data: FuelProduct[] | { data: FuelProduct[] } }>('/fuel-stations/products').catch(() => ({ data: [] })),
        api<{ data: Device[] | { data: Device[] } }>('/fuel-stations/devices').catch(() => ({ data: [] })),
      ]);
      setTenant(settingsResponse.data);
      setStations(asList<Station>(stationsResponse.data).filter((station) => station.status === 'active'));
      setAccounts(asList<Account>(accountsResponse.data));
      setPaymentMethods(asList<PaymentMethod>(paymentResponse.data).filter((method) => method.is_active));
      setProducts(asList<FuelProduct>(productResponse.data));
      setDevices(asList<Device>(deviceResponse.data));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadStationScope = useCallback(async (id: string) => {
    if (!id) { setStationSettings(null); setStationPatch({}); setStationRecordPatch({}); setPrices([]); return; }
    setError(null);
    try {
      const [settingsResponse, priceResponse] = await Promise.all([
        api<{ data: Settings }>(`/fuel-stations/stations/${id}/settings`),
        api<{ data: Price[] | { data: Price[] } }>(`/fuel-stations/prices?station_id=${encodeURIComponent(id)}`).catch(() => ({ data: [] })),
      ]);
      setStationSettings(settingsResponse.data);
      setStationPatch({}); setStationRecordPatch({});
      setPrices(asList<Price>(priceResponse.data));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('loadFailed'));
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const user = currentUser(); if (user?.permissions) setPermissions(user.permissions); else api<{ user: { permissions?: string[] } }>('/me').then((response) => setPermissions(response.user.permissions ?? [])).catch(() => {}); }, []);
  useEffect(() => { void loadStationScope(stationId); }, [stationId, loadStationScope]);

  const value = useCallback((key: string): Settings[string] => {
    if (!scopeValues) return null;
    if (isStationScope && Object.prototype.hasOwnProperty.call(stationPatch, key)) {
      return stationPatch[key] === null ? (tenant?.[key] ?? null) : stationPatch[key] ?? null;
    }
    return (patches[key] ?? scopeValues[key] ?? null) as Settings[string];
  }, [isStationScope, patches, scopeValues, stationPatch, tenant]);

  const patchValue = useCallback((key: string, next: Settings[string]) => {
    if (isStationScope) setStationPatch((current) => ({ ...current, [key]: next }));
    else setTenantPatch((current) => ({ ...current, [key]: next }));
  }, [isStationScope]);

  const resetToInherited = useCallback((key: string) => setStationPatch((current) => ({ ...current, [key]: null })), []);
  const hasChanges = useCallback((keys: readonly string[], record = false) => {
    const source = record ? stationRecordPatch : patches;
    return keys.some((key) => Object.prototype.hasOwnProperty.call(source, key));
  }, [patches, stationRecordPatch]);

  async function saveSettings(section: string, keys: readonly string[]): Promise<boolean> {
    const source = isStationScope ? stationPatch : tenantPatch;
    const payload = Object.fromEntries(keys.filter((key) => Object.prototype.hasOwnProperty.call(source, key)).map((key) => [key, source[key]]));
    if (Object.keys(payload).length === 0) return true;
    setSaving(section); setError(null);
    try {
      const body = { ...payload, ...(reason.trim() ? { reason: reason.trim() } : {}) };
      const response = isStationScope
        ? await api<{ data: Settings }>(`/fuel-stations/stations/${stationId}/settings`, { method: 'PUT', body })
        : await api<{ data: Settings }>('/fuel-stations/settings', { method: 'PUT', body });
      if (isStationScope) {
        setStationSettings(response.data);
        setStationPatch((current) => omitKeys(current, keys));
      } else {
        setTenant(response.data);
        setTenantPatch((current) => omitKeys(current, keys));
      }
      success(t('saved'));
      return true;
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('saveFailed'));
      return false;
    } finally { setSaving(null); }
  }

  async function saveStationRecord(section: string, keys: readonly (keyof Station)[]) {
    if (!selectedStation || !hasChanges(keys as string[], true)) return;
    const payload = Object.fromEntries(keys.filter((key) => Object.prototype.hasOwnProperty.call(stationRecordPatch, key)).map((key) => [key, stationRecordPatch[key]]));
    setSaving(section); setError(null);
    try {
      const response = await api<{ data: Station }>(`/fuel-stations/stations/${selectedStation.id}`, { method: 'PUT', body: payload });
      setStations((current) => current.map((station) => station.id === response.data.id ? response.data : station));
      setStationRecordPatch((current) => omitKeys(current, keys as string[]));
      success(t('saved'));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('saveFailed'));
    } finally { setSaving(null); }
  }

  if (loading || !tenant) return <Loading />;
  const scopeLabel = isStationScope ? `${selectedStation?.name ?? ''} · ${selectedStation?.code ?? ''}` : t('tenantScope');
  const activeSettings = scopeValues ?? tenant;
  const selectedPayments = Array.isArray(value('fuel_sales_allowed_payment_method_ids')) ? value('fuel_sales_allowed_payment_method_ids') as string[] : [];

  return <div className="space-y-5">
    <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div><p className="text-sm text-muted">{t('eyebrow')}</p><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{t('subtitle')}</p></div>
      <Button className="min-h-11" variant="outline" onClick={() => void load()} disabled={saving !== null}><RefreshCw className="h-4 w-4" />{t('refresh')}</Button>
    </header>

    {error && <ErrorBanner message={error} retry={load} label={t('retry')} />}

    <Card><CardContent className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
      <FieldSelect label={t('scope')} value={stationId} onChange={setStationId} options={[{ value: '', label: t('tenantScope') }, ...stations.map((station) => ({ value: station.id, label: `${station.name} · ${station.code}` }))]} />
      <FieldInput label={t('changeReason')} value={reason} onChange={setReason} placeholder={t('changeReasonHint')} disabled={!canManageScope} />
      <div className="rounded-md border border-border bg-primary-soft px-3 py-2 text-sm text-text"><span className="text-muted">{t('editing')}</span><p className="mt-0.5 font-medium">{scopeLabel}</p></div>
    </CardContent></Card>

    {isStationScope && <p className="rounded-md border border-border bg-primary-soft px-3 py-2 text-sm leading-relaxed text-text">{t('inheritanceNotice')}</p>}

    <SettingsSection id="operating" icon={<Cog />} title={t('groups.operating')} description={t('groups.operatingDescription')} saving={saving === 'operating'} canSave={canManageScope && isStationScope && hasChanges(['timezone', 'operating_day_starts_at'], true)} onSave={() => void saveStationRecord('operating', ['timezone', 'operating_day_starts_at'])} saveLabel={t('save')}>
      {isStationScope ? <div className="grid gap-4 md:grid-cols-2">
        <FieldInput label={t('timezone')} value={String(stationRecordValue('timezone') ?? '')} onChange={(next) => setStationRecordPatch((current) => ({ ...current, timezone: next || null }))} placeholder="Asia/Riyadh" hint={t('timezoneHint')} disabled={!canManageScope} />
        <FieldInput label={t('operatingDayStart')} type="time" value={String(stationRecordValue('operating_day_starts_at') ?? '')} onChange={(next) => setStationRecordPatch((current) => ({ ...current, operating_day_starts_at: next || null }))} disabled={!canManageScope} />
        <ReadOnlyRow label={t('volumeUnit')} value={t('liters')} description={t('volumeUnitFixed')} />
        <ReadOnlyRow label={t('operatingHours')} value={selectedStation?.operating_hours ? t('configured') : t('notSpecified')} description={t('operatingHoursMasterData')} />
      </div> : <Empty text={t('selectStationForOperating')} />}
    </SettingsSection>

    <SettingsSection id="reconciliation" icon={<SlidersHorizontal />} title={t('groups.reconciliation')} description={t('groups.reconciliationDescription')} saving={saving === 'reconciliation'} canSave={canManageScope && hasChanges(RECONCILIATION_KEYS)} onSave={() => void saveSettings('reconciliation', RECONCILIATION_KEYS)} saveLabel={t('save')}>
      <div className="grid gap-4 md:grid-cols-2"><VolumeInput label={t('absoluteTolerance')} value={millilitersToLiters(value('reconciliation_tolerance_absolute_milliliters') as number ?? 0)} onChange={(next) => { const parsed = litersToMilliliters(next, true); if (parsed !== null) patchValue('reconciliation_tolerance_absolute_milliliters', parsed); }} disabled={!canManageScope} hint={t('liters')} /><FieldInput label={t('percentageTolerance')} value={basisPointsToPercent(value('reconciliation_tolerance_basis_points') as number ?? 0)} type="number" min="0" step="0.01" onChange={(next) => { const parsed = percentToBasisPoints(next); if (parsed !== null) patchValue('reconciliation_tolerance_basis_points', parsed); }} disabled={!canManageScope} hint="%" /></div>
      <ReadOnlyRow label={t('varianceBehavior')} value={t('varianceAlwaysRecorded')} description={t('varianceBehaviorDescription')} />
    </SettingsSection>

    <SettingsSection id="accounts" icon={<WalletCards />} title={t('groups.accounts')} description={t('groups.accountsDescription')} saving={saving === 'accounts'} canSave={canManageScope && (hasChanges(FUEL_ACCOUNT_KEYS) || (isStationScope && hasChanges(['default_inventory_account_id', 'default_revenue_account_id', 'default_cogs_account_id'], true)))} onSave={async () => { const settingsSaved = await saveSettings('accounts', FUEL_ACCOUNT_KEYS); if (settingsSaved && isStationScope) await saveStationRecord('accounts', ['default_inventory_account_id', 'default_revenue_account_id', 'default_cogs_account_id']); }} saveLabel={t('save')}>
      {isStationScope && <div className="mb-5 grid gap-4 border-b border-border pb-5 md:grid-cols-3"><AccountSelect label={t('inventoryAccount')} value={String(stationRecordValue('default_inventory_account_id') ?? '')} onChange={(next) => setStationRecordPatch((current) => ({ ...current, default_inventory_account_id: next || null }))} accounts={accounts.filter((account) => account.type === 'asset')} locale={locale} disabled={!canManageScope} emptyLabel={t('notSpecified')} /><AccountSelect label={t('revenueAccount')} value={String(stationRecordValue('default_revenue_account_id') ?? '')} onChange={(next) => setStationRecordPatch((current) => ({ ...current, default_revenue_account_id: next || null }))} accounts={accounts.filter((account) => account.type === 'revenue')} locale={locale} disabled={!canManageScope} emptyLabel={t('notSpecified')} /><AccountSelect label={t('cogsAccount')} value={String(stationRecordValue('default_cogs_account_id') ?? '')} onChange={(next) => setStationRecordPatch((current) => ({ ...current, default_cogs_account_id: next || null }))} accounts={accounts.filter((account) => account.type === 'expense')} locale={locale} disabled={!canManageScope} emptyLabel={t('notSpecified')} /></div>}
      <div className="grid gap-4 md:grid-cols-3"><AccountSelect label={t('varianceAccount')} value={String(value('inventory_variance_account_id') ?? '')} onChange={(next) => patchValue('inventory_variance_account_id', next || null)} accounts={accounts.filter((account) => account.type === 'expense')} locale={locale} disabled={!canManageScope} emptyLabel={t('useDefault')} /><AccountSelect label={t('gainAccount')} value={String(value('inventory_gain_account_id') ?? '')} onChange={(next) => patchValue('inventory_gain_account_id', next || null)} accounts={accounts.filter((account) => ['expense', 'revenue'].includes(account.type))} locale={locale} disabled={!canManageScope} emptyLabel={t('useDefault')} /><AccountSelect label={t('grniAccount')} value={String(value('grni_account_id') ?? '')} onChange={(next) => patchValue('grni_account_id', next || null)} accounts={accounts.filter((account) => account.type === 'liability')} locale={locale} disabled={!canManageScope} emptyLabel={t('notSpecified')} /></div>
    </SettingsSection>

    <SettingsSection id="pricing" icon={<BadgeDollarSign />} title={t('groups.pricing')} description={t('groups.pricingDescription')} saving={saving === 'pricing'} canSave={canManageScope && hasChanges(['fuel_price_tax_mode'])} onSave={() => void saveSettings('pricing', ['fuel_price_tax_mode'])} saveLabel={t('save')}>
      <div className="grid gap-4 md:grid-cols-2"><FieldSelect label={t('fuelPriceTaxMode')} value={String(value('fuel_price_tax_mode') ?? '')} onChange={(next) => patchValue('fuel_price_tax_mode', next)} options={[{ value: 'tax_inclusive', label: t('taxInclusive') }, { value: 'tax_exclusive', label: t('taxExclusive') }]} disabled={!canManageScope} /><ReadOnlyRow label={t('priceRecords')} value={isStationScope ? t('priceRecordsCount', { count: prices.length }) : t('selectStation')} description={t('priceRecordsDescription')} /></div>
      {isStationScope && <PriceList prices={prices} products={products} locale={locale} t={t} />}
    </SettingsSection>

    <SettingsSection id="shifts" icon={<Timer />} title={t('groups.shifts')} description={t('groups.shiftsDescription')} saving={saving === 'shifts'} canSave={canManageScope && hasChanges([...SHIFT_KEYS, 'shift_meter_tolerance_milliliters', 'shift_tank_tolerance_milliliters'])} onSave={() => void saveSettings('shifts', [...SHIFT_KEYS, 'shift_meter_tolerance_milliliters', 'shift_tank_tolerance_milliliters'])} saveLabel={t('save')}>
      <div className="grid gap-3 lg:grid-cols-2">{SHIFT_KEYS.map((key) => <ToggleRow key={key} label={t(`fields.${key}`)} checked={Boolean(value(key))} onChange={(next) => patchValue(key, next)} disabled={!canManageScope} onInherit={isStationScope ? () => resetToInherited(key) : undefined} inheritLabel={t('useInherited')} />)}</div>
      <div className="mt-4 grid gap-4 border-t border-border pt-4 md:grid-cols-2"><VolumeInput label={t('fields.shift_meter_tolerance_milliliters')} value={millilitersToLiters(value('shift_meter_tolerance_milliliters') as number ?? 0)} onChange={(next) => { const parsed = litersToMilliliters(next, true); if (parsed !== null) patchValue('shift_meter_tolerance_milliliters', parsed); }} disabled={!canManageScope} hint={t('liters')} /><VolumeInput label={t('fields.shift_tank_tolerance_milliliters')} value={millilitersToLiters(value('shift_tank_tolerance_milliliters') as number ?? 0)} onChange={(next) => { const parsed = litersToMilliliters(next, true); if (parsed !== null) patchValue('shift_tank_tolerance_milliliters', parsed); }} disabled={!canManageScope} hint={t('liters')} /></div>
    </SettingsSection>

    <SettingsSection id="avi" icon={<Radio />} title={t('groups.avi')} description={t('groups.aviDescription')} saving={saving === 'avi'} canSave={canManageScope && hasChanges([...AVI_KEYS, 'default_corporate_credit_limit_minor', 'odometer_policy', 'avi_min_refill_interval_seconds', 'avi_denial_window_seconds', 'avi_repeated_denial_threshold', 'avi_authorization_ttl_seconds', 'fuel_sales_allowed_payment_method_ids'])} onSave={() => void saveSettings('avi', [...AVI_KEYS, 'default_corporate_credit_limit_minor', 'odometer_policy', 'avi_min_refill_interval_seconds', 'avi_denial_window_seconds', 'avi_repeated_denial_threshold', 'avi_authorization_ttl_seconds', 'fuel_sales_allowed_payment_method_ids'])} saveLabel={t('save')}>
      <div className="grid gap-3 lg:grid-cols-2">{AVI_KEYS.map((key) => <ToggleRow key={key} label={t(`fields.${key}`)} checked={Boolean(value(key))} onChange={(next) => patchValue(key, next)} disabled={!canManageScope} onInherit={isStationScope ? () => resetToInherited(key) : undefined} inheritLabel={t('useInherited')} />)}</div>
      <div className="mt-4 grid gap-4 border-t border-border pt-4 md:grid-cols-2"><MoneyInput label={t('fields.default_corporate_credit_limit_minor')} value={minorToRiyal(value('default_corporate_credit_limit_minor') as number ?? 0)} onChange={(next) => { if (!next.trim()) { patchValue('default_corporate_credit_limit_minor', 0); return; } if (isValidRiyal(next)) patchValue('default_corporate_credit_limit_minor', riyalToMinor(next)); }} disabled={!canManageScope} /><FieldSelect label={t('fields.odometer_policy')} value={String(value('odometer_policy') ?? 'optional')} onChange={(next) => patchValue('odometer_policy', next)} options={[{ value: 'disabled', label: t('odometerDisabled') }, { value: 'optional', label: t('odometerOptional') }, { value: 'required', label: t('odometerRequired') }]} disabled={!canManageScope} /><SecondsInput label={t('fields.avi_min_refill_interval_seconds')} value={Number(value('avi_min_refill_interval_seconds') ?? 0)} onChange={(next) => patchValue('avi_min_refill_interval_seconds', next)} disabled={!canManageScope} hint={t('seconds')} /><SecondsInput label={t('fields.avi_denial_window_seconds')} value={Number(value('avi_denial_window_seconds') ?? 0)} onChange={(next) => patchValue('avi_denial_window_seconds', next)} disabled={!canManageScope} hint={t('seconds')} /><FieldInput label={t('fields.avi_repeated_denial_threshold')} value={String(value('avi_repeated_denial_threshold') ?? 0)} type="number" min="1" step="1" onChange={(next) => { const number = asNonNegativeInteger(next); if (number !== null) patchValue('avi_repeated_denial_threshold', number); }} disabled={!canManageScope} hint={t('attempts')} /><SecondsInput label={t('fields.avi_authorization_ttl_seconds')} value={Number(value('avi_authorization_ttl_seconds') ?? 0)} onChange={(next) => patchValue('avi_authorization_ttl_seconds', next)} disabled={!canManageScope} hint={t('seconds')} /></div>
      <div className="mt-4 border-t border-border pt-4"><p className="text-sm font-medium text-text">{t('allowedPaymentMethods')}</p><p className="mt-1 text-sm text-muted">{t('allowedPaymentMethodsDescription')}</p><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{paymentMethods.map((method) => <PaymentMethodToggle key={method.id} method={method} locale={locale} t={t} checked={selectedPayments.includes(method.id)} disabled={!canManageScope} onChange={(checked) => patchValue('fuel_sales_allowed_payment_method_ids', checked ? [...selectedPayments, method.id] : selectedPayments.filter((id) => id !== method.id))} />)}</div></div>
    </SettingsSection>

    <SettingsSection id="devices" icon={<Database />} title={t('groups.devices')} description={t('groups.devicesDescription')}>
      {devices.length === 0 ? <Empty text={t('devicesUnavailable')} /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{devices.slice(0, 9).map((device) => <article key={device.id} className="rounded-md border border-border p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate font-medium text-text">{device.name}</h3><p className="mt-1 text-sm text-muted">{device.station?.name ?? t('notSpecified')}</p></div><Badge tone={DEVICE_TONES[device.health] ?? 'muted'}>{t(`deviceHealth.${device.health}`)}</Badge></div><dl className="mt-3 grid gap-2 border-t border-border pt-3 text-sm"><Detail label={t('deviceType')} value={humanDeviceType(device.device_type, t)} /><Detail label={t('lastSeen')} value={date(device.last_seen_at, locale)} /></dl></article>)}</div>}
    </SettingsSection>

    <SettingsSection id="advanced" icon={<Settings2 />} title={t('groups.advanced')} description={t('groups.advancedDescription')}>
      <p className="mb-4 rounded-md border border-border bg-primary-soft px-3 py-2 text-sm leading-relaxed text-text">{t('advancedReadOnlyNotice')}</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{ADVANCED_KEYS.map((key) => <AdvancedRow key={key} settingKey={key} label={t(`fields.${key}`)} value={value(key)} t={t} />)}</div>
    </SettingsSection>
  </div>;
}

function SettingsSection({ id, icon, title, description, children, saving, canSave, onSave, saveLabel }: { id: string; icon: React.ReactNode; title: string; description: string; children: React.ReactNode; saving?: boolean; canSave?: boolean; onSave?: () => void | Promise<void>; saveLabel?: string }) { return <section id={id}><Card><CardHeader className="flex flex-row items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><span aria-hidden="true" className="text-primary">{icon}</span>{title}</CardTitle><p className="mt-1 text-sm leading-relaxed text-muted">{description}</p></div>{onSave && <Button size="sm" disabled={!canSave || saving} onClick={() => { void onSave(); }}>{saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saveLabel}</Button>}</CardHeader><CardContent>{children}</CardContent></Card></section>; }
function ToggleRow({ label, checked, onChange, disabled, onInherit, inheritLabel }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled: boolean; onInherit?: () => void; inheritLabel: string }) { return <div className="flex min-h-14 items-center justify-between gap-3 rounded-md border border-border px-3 py-2"><span className="text-sm text-text">{label}</span><span className="flex items-center gap-2">{onInherit && <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onInherit}>{inheritLabel}</Button>}<Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} /></span></div>; }
function PaymentMethodToggle({ method, locale, t, checked, disabled, onChange }: { method: PaymentMethod; locale: string; t: ReturnType<typeof useTranslations>; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) { const name = locale.startsWith('en') ? method.name_en || method.name : method.name; const settlement = method.settlement_type === 'cash' ? t('paymentMethods.cash') : method.settlement_type === 'bank' ? t('paymentMethods.bank') : t('paymentMethods.other'); return <div className="flex min-h-14 items-center justify-between gap-3 rounded-md border border-border px-3 py-2"><div><p className="text-sm text-text">{name}</p><p className="text-xs text-muted">{settlement}</p></div><Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={name} /></div>; }
function AccountSelect({ label, value, onChange, accounts, locale, disabled, emptyLabel }: { label: string; value: string; onChange: (value: string) => void; accounts: Account[]; locale: string; disabled: boolean; emptyLabel: string }) { return <FieldSelect label={label} value={value} onChange={onChange} disabled={disabled} options={[{ value: '', label: emptyLabel }, ...accounts.filter((account) => account.is_active && !account.is_group).map((account) => ({ value: account.id, label: `${account.code} · ${locale.startsWith('en') ? account.name_en || account.name : account.name}` }))]} />; }
function PriceList({ prices, products, locale, t }: { prices: Price[]; products: FuelProduct[]; locale: string; t: ReturnType<typeof useTranslations> }) { if (!prices.length) return <Empty text={t('noPriceRecords')} />; const productNames = new Map(products.map((product) => [product.id, `${product.name} · ${product.code}`])); return <div className="mt-4 space-y-2">{prices.slice(0, 5).map((price) => <div key={price.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"><div><p className="font-medium text-text">{productNames.get(price.fuel_product_id) ?? t('fuelProduct')}</p><p className="num mt-0.5 text-xs text-muted">{date(price.effective_from, locale)}</p></div><span className="num font-medium text-text">{formatMinorRiyal(price.price_per_liter_minor)} / {t('liter')}</span></div>)}</div>; }
function AdvancedRow({ settingKey, label, value, t }: { settingKey: string; label: string; value: Settings[string]; t: ReturnType<typeof useTranslations> }) { if (typeof value === 'boolean') return <div className="flex min-h-14 items-center justify-between rounded-md border border-border px-3 py-2"><span className="text-sm text-text">{label}</span><Switch checked={value} onCheckedChange={() => {}} disabled aria-label={label} /></div>; return <ReadOnlyRow label={label} value={advancedValue(settingKey, value, t)} />; }
function ReadOnlyRow({ label, value, description }: { label: string; value: string; description?: string }) { return <div className="rounded-md border border-border px-3 py-3"><p className="text-xs text-muted">{label}</p><p className="mt-1 text-sm font-medium text-text">{value}</p>{description && <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>}</div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-words text-text">{value}</dd></div>; }
function FieldInput({ label, value, onChange, type = 'text', min, step, hint, placeholder, disabled }: { label: string; value: string; onChange: (value: string) => void; type?: string; min?: string; step?: string; hint?: string; placeholder?: string; disabled?: boolean }) { return <div className="space-y-1.5"><Label>{label}</Label><Input value={value} type={type} min={min} step={step} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} />{hint && <p className="text-xs text-muted">{hint}</p>}</div>; }
function FieldSelect({ label, value, onChange, options, disabled }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; disabled?: boolean }) { return <div className="space-y-1.5"><Label>{label}</Label><Select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value || 'empty'} value={option.value}>{option.label}</option>)}</Select></div>; }
function VolumeInput({ label, value, onChange, disabled, hint }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean; hint: string }) { return <FieldInput label={label} value={value} type="number" min="0" step="0.001" onChange={onChange} disabled={disabled} hint={hint} />; }
function MoneyInput({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean }) { return <FieldInput label={label} value={value} type="number" min="0" step="0.01" onChange={onChange} disabled={disabled} hint={SAUDI_RIYAL_SYMBOL} />; }
function SecondsInput({ label, value, onChange, disabled, hint }: { label: string; value: number; onChange: (value: number) => void; disabled: boolean; hint: string }) { return <FieldInput label={label} value={String(value)} type="number" min="0" step="1" onChange={(next) => { const parsed = asNonNegativeInteger(next); if (parsed !== null) onChange(parsed); }} disabled={disabled} hint={hint} />; }
function ErrorBanner({ message, retry, label }: { message: string; retry: () => void; label: string }) { return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-negative/30 bg-negative/10 px-3 py-3 text-sm text-negative"><span className="flex items-center gap-2"><CircleAlert className="h-4 w-4" />{message}</span><Button variant="outline" size="sm" onClick={() => void retry()}><RefreshCw className="h-4 w-4" />{label}</Button></div>; }
function Empty({ text }: { text: string }) { return <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted">{text}</p>; }
function Loading() { return <div className="space-y-4" aria-busy="true"><Skeleton className="h-11 w-80" /><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /><Skeleton className="h-64 w-full" /></div>; }
function asList<T>(value: T[] | { data: T[] }): T[] { return Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []; }
function omitKeys<T extends Record<string, unknown>>(source: T, keys: readonly string[]) { return Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key))) as Partial<T>; }
function asNonNegativeInteger(value: string) { if (!/^\d+$/.test(value.trim())) return null; const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null; }
function basisPointsToPercent(value: number) { return Number.isFinite(value) ? String(value / 100) : '0'; }
function percentToBasisPoints(value: string) { if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null; const parsed = Math.round(Number(value) * 100); return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1000000 ? parsed : null; }
function date(value: string | null | undefined, locale: string) { return value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'; }
function advancedValue(key: string, value: Settings[string], t: ReturnType<typeof useTranslations>) { if (value === null || value === '') return t('notSpecified'); if (typeof value === 'number') { if (key.endsWith('_seconds')) return humanSeconds(value, t); if (key === 'offline_event_retention_days' || key.endsWith('_interval_days') || key.endsWith('_warning_days')) return t('daysValue', { count: value }); if (key.endsWith('_attempts')) return t('attemptsValue', { count: value }); return t('unitsValue', { count: value }); } if (Array.isArray(value)) return value.length ? t('selectedCount', { count: value.length }) : t('noneSelected'); return String(value); }
function humanSeconds(seconds: number, t: ReturnType<typeof useTranslations>) { if (seconds > 0 && seconds % 3600 === 0) return t('hoursValue', { count: seconds / 3600 }); if (seconds > 0 && seconds % 60 === 0) return t('minutesValue', { count: seconds / 60 }); return t('secondsValue', { count: seconds }); }
function humanDeviceType(value: string, t: ReturnType<typeof useTranslations>) { const labels: Record<string, string> = { forecourt_controller: 'forecourtController', atg: 'atg', rfid_reader: 'rfidReader', payment_terminal: 'paymentTerminal', station_gateway: 'stationGateway', other: 'other' }; return t(`deviceTypes.${labels[value] ?? 'other'}`); }
