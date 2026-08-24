'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { BadgeCheck, CircleAlert, Fingerprint, KeyRound, Plus, ShieldCheck } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { formatMillilitersAsLiters, litersToMilliliters } from '@/lib/fuel-quantity';

interface Partner { id: string; name: string; type: string }
interface Contract { id: string; number: string; partner_id: string; status: string }
interface Vehicle { id: string; plate_number: string; partner_id: string; corporate_fuel_contract_id: string | null; status: string }
interface Driver { id: string; name: string; identifier: string; partner_id: string; corporate_fuel_contract_id: string | null; status: string }
interface Station { id: string; name: string; code: string; status: string }
interface Nozzle { id: string; nozzle_number: string; fuel_station_id: string; status: string }
interface Tag {
  id: string; public_identifier: string; identity_type: string; partner_id: string; corporate_fuel_contract_id: string;
  fuel_fleet_vehicle_id: string | null; fuel_fleet_driver_id: string | null; status: string; effective_from: string; effective_until: string | null;
}
interface Authorization {
  id: string; fuel_station_id: string; fuel_nozzle_id: string; vehicle_identity_tag_id: string | null; driver_identity_tag_id: string | null;
  partner_id: string | null; fuel_fleet_vehicle_id: string | null; quantity_milliliters: number; decision: 'approved' | 'denied';
  reason_code: string | null; suspicion_signals: string[]; authorized_at: string; expires_at: string | null; fuel_sale_id: string | null;
}

const TYPES = ['vehicle_rfid', 'driver_card', 'vehicle_qr', 'driver_qr', 'vehicle_pin', 'driver_pin'] as const;
const VEHICLE_TYPES = new Set<string>(['vehicle_rfid', 'vehicle_qr', 'vehicle_pin']);
const TAG_TONES: Record<string, 'positive' | 'warning' | 'negative' | 'neutral'> = {
  active: 'positive', suspended: 'warning', lost: 'warning', blacklisted: 'negative', expired: 'neutral', cancelled: 'neutral', replaced: 'neutral',
};

export default function FuelAviRfidPage() {
  const t = useTranslations('fuelStationsAvi');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [tags, setTags] = useState<Tag[]>([]); const [authorizations, setAuthorizations] = useState<Authorization[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]); const [contracts, setContracts] = useState<Contract[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]); const [drivers, setDrivers] = useState<Driver[]>([]);
  const [stations, setStations] = useState<Station[]>([]); const [nozzles, setNozzles] = useState<Nozzle[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [lastDecision, setLastDecision] = useState<Authorization | null>(null);
  const [tagOpen, setTagOpen] = useState(false); const [authorizationOpen, setAuthorizationOpen] = useState(false);
  const [tagIdentifier, setTagIdentifier] = useState(''); const [tagCredential, setTagCredential] = useState(''); const [tagType, setTagType] = useState<string>('vehicle_rfid');
  const [tagPartnerId, setTagPartnerId] = useState(''); const [tagContractId, setTagContractId] = useState(''); const [tagVehicleId, setTagVehicleId] = useState(''); const [tagDriverId, setTagDriverId] = useState('');
  const [stationId, setStationId] = useState(''); const [nozzleId, setNozzleId] = useState(''); const [vehicleCredential, setVehicleCredential] = useState(''); const [driverCredential, setDriverCredential] = useState(''); const [quantity, setQuantity] = useState('');

  const can = useCallback((permission: string) => permissions.includes('*') || permissions.includes(permission), [permissions]);
  const nameFor = useCallback((id: string | null, list: Array<{ id: string; name?: string; plate_number?: string; number?: string }>) => {
    if (!id) return '—'; const item = list.find((candidate) => candidate.id === id); return item?.name ?? item?.plate_number ?? item?.number ?? '—';
  }, []);
  const stationName = useCallback((id: string) => stations.find((station) => station.id === id)?.name ?? '—', [stations]);
  const nozzleName = useCallback((id: string) => nozzles.find((nozzle) => nozzle.id === id)?.nozzle_number ?? '—', [nozzles]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [tagResult, authorizationResult, partnerResult, contractResult, vehicleResult, driverResult, stationResult, nozzleResult] = await Promise.all([
        api<{ data: Tag[] }>('/fuel-stations/avi-rfid/tags'), api<{ data: Authorization[] }>('/fuel-stations/avi-rfid/authorizations'),
        api<{ data: Partner[] }>('/partners?type=customer'), api<{ data: Contract[] }>('/fuel-stations/corporate-contracts'),
        api<{ data: Vehicle[] }>('/fuel-stations/fleet/vehicles'), api<{ data: Driver[] }>('/fuel-stations/fleet/drivers'),
        api<{ data: Station[] }>('/fuel-stations/stations'), api<{ data: Nozzle[] }>('/fuel-stations/nozzles'),
      ]);
      setTags(tagResult.data); setAuthorizations(authorizationResult.data); setPartners(partnerResult.data.filter((partner) => partner.type === 'customer'));
      setContracts(contractResult.data); setVehicles(vehicleResult.data); setDrivers(driverResult.data);
      setStations(stationResult.data.filter((station) => station.status === 'active')); setNozzles(nozzleResult.data.filter((nozzle) => nozzle.status === 'active'));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : tc('loadFailed')); } finally { setLoading(false); }
  }, [tc]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const user = currentUser(); if (user?.permissions) setPermissions(user.permissions); else api<{ user: { permissions?: string[] } }>('/me').then((result) => setPermissions(result.user.permissions ?? [])).catch(() => {}); }, []);

  const partnerContracts = useMemo(() => contracts.filter((contract) => contract.partner_id === tagPartnerId && contract.status === 'active'), [contracts, tagPartnerId]);
  const targetIsVehicle = VEHICLE_TYPES.has(tagType);
  const targetVehicles = useMemo(() => vehicles.filter((vehicle) => vehicle.partner_id === tagPartnerId && (!tagContractId || !vehicle.corporate_fuel_contract_id || vehicle.corporate_fuel_contract_id === tagContractId)), [vehicles, tagPartnerId, tagContractId]);
  const targetDrivers = useMemo(() => drivers.filter((driver) => driver.partner_id === tagPartnerId && (!tagContractId || !driver.corporate_fuel_contract_id || driver.corporate_fuel_contract_id === tagContractId)), [drivers, tagPartnerId, tagContractId]);
  const stationNozzles = useMemo(() => nozzles.filter((nozzle) => nozzle.fuel_station_id === stationId), [nozzles, stationId]);

  function resetTagForm() { setTagIdentifier(''); setTagCredential(''); setTagType('vehicle_rfid'); setTagPartnerId(''); setTagContractId(''); setTagVehicleId(''); setTagDriverId(''); }
  function resetAuthorizationForm() { setStationId(''); setNozzleId(''); setVehicleCredential(''); setDriverCredential(''); setQuantity(''); setLastDecision(null); }

  async function createTag() {
    if (!tagIdentifier.trim() || !tagCredential.trim() || !tagPartnerId || !tagContractId || (targetIsVehicle ? !tagVehicleId : !tagDriverId)) return;
    setBusy(true); setError(null);
    try {
      await api('/fuel-stations/avi-rfid/tags', { method: 'POST', body: {
        public_identifier: tagIdentifier.trim(), credential: tagCredential, identity_type: tagType, partner_id: tagPartnerId, corporate_fuel_contract_id: tagContractId,
        fuel_fleet_vehicle_id: targetIsVehicle ? tagVehicleId : null, fuel_fleet_driver_id: targetIsVehicle ? null : tagDriverId,
        effective_from: new Date().toISOString(),
      }});
      success(t('created')); setTagOpen(false); resetTagForm(); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  async function authorizeFueling() {
    const requested = litersToMilliliters(quantity);
    if (!stationId || !nozzleId || !requested || (!vehicleCredential.trim() && !driverCredential.trim())) return;
    setBusy(true); setError(null);
    try {
      const result = await api<{ data: Authorization }>('/fuel-stations/avi-rfid/authorizations', { method: 'POST', body: {
        fuel_station_id: stationId, fuel_nozzle_id: nozzleId, vehicle_credential: vehicleCredential || null, driver_credential: driverCredential || null,
        quantity_milliliters: requested, idempotency_key: crypto.randomUUID(),
      }});
      setLastDecision(result.data); success(t('decisionRecorded')); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  const tagColumns = useMemo<ColumnDef<Tag, unknown>[]>(() => [
    { accessorKey: 'public_identifier', header: t('publicIdentifier'), cell: ({ row }) => <span className="num font-medium">{row.original.public_identifier}</span> },
    { accessorKey: 'identity_type', header: t('identityType'), cell: ({ row }) => <span>{t(`type${camel(row.original.identity_type)}`)}</span> },
    { id: 'target', header: t('vehicle'), cell: ({ row }) => row.original.fuel_fleet_vehicle_id ? <span>{nameFor(row.original.fuel_fleet_vehicle_id, vehicles)}</span> : <span>{nameFor(row.original.fuel_fleet_driver_id, drivers)}</span> },
    { id: 'customer', header: t('customer'), cell: ({ row }) => nameFor(row.original.partner_id, partners) },
    { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={TAG_TONES[row.original.status] ?? 'neutral'}>{t(`tag${camel(row.original.status)}`)}</Badge> },
    { accessorKey: 'effective_from', header: t('effectiveFrom'), cell: ({ row }) => <span className="num">{new Date(row.original.effective_from).toLocaleDateString()}</span> },
  ], [drivers, nameFor, partners, t, vehicles]);
  const authorizationColumns = useMemo<ColumnDef<Authorization, unknown>[]>(() => [
    { accessorKey: 'authorized_at', header: t('issuedAt'), cell: ({ row }) => <span className="num">{new Date(row.original.authorized_at).toLocaleString()}</span> },
    { id: 'station', header: t('station'), cell: ({ row }) => <span>{stationName(row.original.fuel_station_id)} · <span className="num text-muted">{nozzleName(row.original.fuel_nozzle_id)}</span></span> },
    { accessorKey: 'quantity_milliliters', header: t('quantity'), cell: ({ row }) => <span className="num">{formatMillilitersAsLiters(row.original.quantity_milliliters)}</span> },
    { accessorKey: 'decision', header: t('decision'), cell: ({ row }) => <Badge tone={row.original.decision === 'approved' ? 'positive' : 'negative'}>{row.original.decision === 'approved' ? t('decisionApproved') : t('decisionDenied')}</Badge> },
    { accessorKey: 'reason_code', header: t('reasonCode'), cell: ({ row }) => <span className="num text-xs">{row.original.reason_code ?? '—'}</span> },
    { accessorKey: 'suspicion_signals', header: t('signals'), cell: ({ row }) => row.original.suspicion_signals.length ? <span className="text-xs text-warning">{row.original.suspicion_signals.join(' · ')}</span> : <span className="text-muted">—</span> },
  ], [nozzleName, stationName, t]);

  if (loading && tags.length === 0) return <div className="space-y-4"><Skeleton className="h-9 w-72" /><Skeleton className="h-64 w-full" /></div>;
  return <div className="space-y-5">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><p className="text-sm text-muted">{t('eyebrow')}</p><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 max-w-3xl text-sm text-muted">{t('subtitle')}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!can('fuel.avi.authorize')} title={!can('fuel.avi.authorize') ? t('noPermission') : undefined} onClick={() => { resetAuthorizationForm(); setAuthorizationOpen(true); setError(null); }}><ShieldCheck className="h-4 w-4" />{t('authorize')}</Button><Button disabled={!can('fuel.avi.manage')} title={!can('fuel.avi.manage') ? t('noPermission') : undefined} onClick={() => { resetTagForm(); setTagOpen(true); setError(null); }}><Plus className="h-4 w-4" />{t('newTag')}</Button></div></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={<Fingerprint />} label={t('totalTags')} value={String(tags.length)} /><Metric icon={<KeyRound />} label={t('activeTags')} value={String(tags.filter((tag) => tag.status === 'active').length)} /><Metric icon={<BadgeCheck />} label={t('approved')} value={String(authorizations.filter((item) => item.decision === 'approved').length)} /><Metric icon={<CircleAlert />} label={t('denied')} value={String(authorizations.filter((item) => item.decision === 'denied').length)} /></div>
    <p className="rounded-md border border-border bg-primary-soft px-3 py-2 text-xs text-text">{t('separationNotice')}</p>
    {error && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}
    <section className="space-y-3"><div><h2 className="text-base font-semibold text-text">{t('tags')}</h2><p className="text-sm text-muted">{t('tagHint')}</p></div><DataTable columns={tagColumns} data={tags} loading={loading} searchPlaceholder={t('tagSearch')} emptyLabel={t('emptyTags')} exportName="avi-rfid-identity-tags" /></section>
    <section className="space-y-3"><div><h2 className="text-base font-semibold text-text">{t('authorizations')}</h2><p className="text-sm text-muted">{t('authorizationHint')}</p></div><DataTable columns={authorizationColumns} data={authorizations} loading={loading} searchPlaceholder={t('authorizationSearch')} emptyLabel={t('emptyAuthorizations')} exportName="avi-rfid-authorizations" /></section>

    <Dialog open={tagOpen} onClose={() => setTagOpen(false)} title={t('tagTitle')}><form onSubmit={(event) => { event.preventDefault(); void createTag(); }} className="space-y-3"><p className="rounded-md bg-primary-soft px-3 py-2 text-xs text-text">{t('tagHint')}</p><div className="grid gap-3 sm:grid-cols-2"><TextField id="avi-tag-identifier" label={t('publicIdentifier')} value={tagIdentifier} onChange={setTagIdentifier} disabled={busy} /><TextField id="avi-tag-credential" label={t('credential')} value={tagCredential} onChange={setTagCredential} disabled={busy} secret /></div><div className="grid gap-3 sm:grid-cols-2"><SelectField id="avi-tag-type" label={t('identityType')} value={tagType} onChange={(value) => { setTagType(value); setTagVehicleId(''); setTagDriverId(''); }} disabled={busy} options={TYPES.map((type) => ({ value: type, label: t(`type${camel(type)}`) }))} placeholder={t('selectType')} /><SelectField id="avi-tag-partner" label={t('customer')} value={tagPartnerId} onChange={(value) => { setTagPartnerId(value); setTagContractId(''); setTagVehicleId(''); setTagDriverId(''); }} disabled={busy} options={partners.map((partner) => ({ value: partner.id, label: partner.name }))} placeholder={t('selectCustomer')} /></div><div className="grid gap-3 sm:grid-cols-2"><SelectField id="avi-tag-contract" label={t('contract')} value={tagContractId} onChange={(value) => { setTagContractId(value); setTagVehicleId(''); setTagDriverId(''); }} disabled={busy || !tagPartnerId} options={partnerContracts.map((contract) => ({ value: contract.id, label: contract.number }))} placeholder={t('selectContract')} />{targetIsVehicle ? <SelectField id="avi-tag-vehicle" label={t('vehicle')} value={tagVehicleId} onChange={setTagVehicleId} disabled={busy || !tagContractId} options={targetVehicles.map((vehicle) => ({ value: vehicle.id, label: vehicle.plate_number }))} placeholder={t('selectVehicle')} /> : <SelectField id="avi-tag-driver" label={t('driver')} value={tagDriverId} onChange={setTagDriverId} disabled={busy || !tagContractId} options={targetDrivers.map((driver) => ({ value: driver.id, label: `${driver.name} · ${driver.identifier}` }))} placeholder={t('selectDriver')} />}</div><DialogActions busy={busy} disabled={!tagIdentifier.trim() || !tagCredential.trim() || !tagPartnerId || !tagContractId || (targetIsVehicle ? !tagVehicleId : !tagDriverId)} onCancel={() => setTagOpen(false)} saveLabel={t('create')} /></form></Dialog>

    <Dialog open={authorizationOpen} onClose={() => setAuthorizationOpen(false)} title={t('authorizationTitle')}><form onSubmit={(event) => { event.preventDefault(); void authorizeFueling(); }} className="space-y-3"><p className="rounded-md bg-primary-soft px-3 py-2 text-xs text-text">{t('authorizationHint')}</p><div className="grid gap-3 sm:grid-cols-2"><SelectField id="avi-station" label={t('station')} value={stationId} onChange={(value) => { setStationId(value); setNozzleId(''); }} disabled={busy} options={stations.map((station) => ({ value: station.id, label: `${station.name} · ${station.code}` }))} placeholder={t('station')} /><SelectField id="avi-nozzle" label={t('nozzle')} value={nozzleId} onChange={setNozzleId} disabled={busy || !stationId} options={stationNozzles.map((nozzle) => ({ value: nozzle.id, label: nozzle.nozzle_number }))} placeholder={t('nozzle')} /></div><div className="grid gap-3 sm:grid-cols-2"><TextField id="avi-vehicle-credential" label={t('vehicleCredential')} value={vehicleCredential} onChange={setVehicleCredential} disabled={busy} secret optional /><TextField id="avi-driver-credential" label={t('driverCredential')} value={driverCredential} onChange={setDriverCredential} disabled={busy} secret optional /></div><div className="space-y-1.5"><Label htmlFor="avi-quantity" className="text-sm">{t('quantity')}</Label><Input id="avi-quantity" inputMode="decimal" className="num text-end" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /><p className="text-xs text-muted">{t('quantityHint')}</p></div>{lastDecision && <DecisionSummary decision={lastDecision} t={t} />}<DialogActions busy={busy} disabled={!stationId || !nozzleId || !litersToMilliliters(quantity) || (!vehicleCredential.trim() && !driverCredential.trim())} onCancel={() => setAuthorizationOpen(false)} saveLabel={t('decide')} /></form></Dialog>
  </div>;
}

function camel(value: string) { return value.replace(/(?:^|_)([a-z])/g, (_, letter: string) => letter.toUpperCase()); }
function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) { return <div className="rounded-md border border-border bg-surface p-3"><div className="flex items-center gap-2 text-sm text-muted"><span aria-hidden="true" className="text-primary">{icon}</span>{label}</div><p className="num mt-2 text-xl font-semibold text-text">{value}</p></div>; }
function TextField({ id, label, value, onChange, disabled, secret = false, optional = false }: { id: string; label: string; value: string; onChange: (value: string) => void; disabled: boolean; secret?: boolean; optional?: boolean }) { return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} type={secret ? 'password' : 'text'} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required={!optional} /></div>; }
function SelectField({ id, label, value, onChange, disabled, options, placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; disabled: boolean; options: Array<{ value: string; label: string }>; placeholder: string }) { return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><option value="">{placeholder}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>; }
function DialogActions({ busy, disabled, onCancel, saveLabel }: { busy: boolean; disabled: boolean; onCancel: () => void; saveLabel: string }) { const tc = useTranslations('common'); return <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={onCancel}>{tc('cancel')}</Button><Button type="submit" disabled={busy || disabled}>{saveLabel}</Button></div>; }
function DecisionSummary({ decision, t }: { decision: Authorization; t: ReturnType<typeof useTranslations> }) { const approved = decision.decision === 'approved'; return <div role="status" className={`rounded-md border px-3 py-2 text-sm ${approved ? 'border-positive/30 bg-positive/10 text-text' : 'border-negative/30 bg-negative/10 text-text'}`}><div className="flex items-center gap-2 font-medium">{approved ? <BadgeCheck className="h-4 w-4 text-positive" /> : <CircleAlert className="h-4 w-4 text-negative" />}{approved ? t('decisionApproved') : t('decisionDenied')}</div>{decision.reason_code && <p className="num mt-1 text-xs">{t('reasonCode')}: {decision.reason_code}</p>}{approved && decision.expires_at && <p className="mt-1 text-xs">{t('expiresAt')}: {new Date(decision.expires_at).toLocaleString()}</p>}</div>; }
