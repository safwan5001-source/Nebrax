'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Archive, ArrowRight, Link2, Loader2, TestTube2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { executeCashDrawerAction, type CashDrawerAction, type CashDrawerBridgeResult } from '@/lib/cash-drawer-bridge';
import { api, ApiError } from '@/lib/api';

interface CashDrawerSettings {
  cash_drawer_driver: 'unavailable' | 'local_bridge';
  cash_drawer_enabled: boolean;
  cash_drawer_auto_open_after_cash: boolean;
}
interface CashDrawerConfig {
  configured: boolean;
  bridge_url: string | null;
  printer_identifier: string | null;
  drawer_channel: number | null;
  pulse_on_ms: number | null;
  pulse_off_ms: number | null;
  paired_at: string | null;
  last_result: { status: string; error_code: string | null; at: string } | null;
  last_success_at: string | null;
}
interface PosDevice {
  id: string;
  name: string;
  code: string | null;
  warehouse: { id: string; name: string; code: string } | null;
  cash_drawer: CashDrawerConfig;
  is_active: boolean;
}
interface PairResponse {
  ok: boolean;
  status: 'paired' | string;
  pairing_secret: string;
  printer_identifier: string;
  drawer_channel: number;
  pulse_on_ms: number;
  pulse_off_ms: number;
}

const DEFAULTS: CashDrawerSettings = {
  cash_drawer_driver: 'unavailable',
  cash_drawer_enabled: false,
  cash_drawer_auto_open_after_cash: false,
};
const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:17463';

export default function PosCashDrawerSettingsPage() {
  const t = useTranslations('posSettings');
  const td = useTranslations('posDevices');
  const tc = useTranslations('common');
  const { success, error: errorToast } = useToast();
  const query = useSearchParams();
  const requestedDeviceId = query.get('device');
  const [settings, setSettings] = useState<CashDrawerSettings | null>(null);
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [bridgeUrl, setBridgeUrl] = useState(DEFAULT_BRIDGE_URL);
  const [pairingCode, setPairingCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsResult, devicesResult] = await Promise.all([
        api<{ data: Partial<CashDrawerSettings> }>('/sales-config/pos'),
        api<{ data: PosDevice[] }>('/pos-devices'),
      ]);
      setSettings({ ...DEFAULTS, ...settingsResult.data });
      setDevices(devicesResult.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (devices.length === 0) {
      setSelectedDeviceId(null);
      return;
    }
    setSelectedDeviceId((current) => {
      if (current && devices.some((device) => device.id === current)) return current;
      return devices.some((device) => device.id === requestedDeviceId) ? requestedDeviceId : devices[0].id;
    });
  }, [devices, requestedDeviceId]);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );
  const hasPairedDevice = devices.some((device) => device.is_active && device.cash_drawer?.configured);

  useEffect(() => {
    if (selectedDevice) setBridgeUrl(selectedDevice.cash_drawer?.bridge_url ?? DEFAULT_BRIDGE_URL);
  }, [selectedDevice]);

  function patch<Key extends keyof CashDrawerSettings>(key: Key, value: CashDrawerSettings[Key]) {
    setSettings((current) => current ? { ...current, [key]: value } : current);
  }
  function resultFromApiError(err: unknown): CashDrawerBridgeResult | null {
    const body = err instanceof ApiError ? err.body : null;
    const data = typeof body === 'object' && body !== null && 'data' in body ? (body as { data?: unknown }).data : null;
    return typeof data === 'object' && data !== null && 'status' in data ? data as CashDrawerBridgeResult : null;
  }
  function drawerStatus(device: PosDevice): { label: string; tone: 'positive' | 'negative' | 'warning' | 'muted' } {
    const status = device.cash_drawer?.last_result?.status;
    if (!device.cash_drawer?.configured) return { label: t('drawer_status_not_configured'), tone: 'muted' };
    if (status === 'opened') return { label: t('drawer_status_opened'), tone: 'positive' };
    if (status === 'bridge_unavailable') return { label: t('drawer_status_bridge_unavailable'), tone: 'warning' };
    if (status === 'printer_unavailable') return { label: t('drawer_status_printer_unavailable'), tone: 'warning' };
    if (status === 'failed' || status === 'permission_denied') return { label: t('drawer_status_failed'), tone: 'negative' };
    return { label: t('drawer_status_connected'), tone: 'positive' };
  }
  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      await api('/sales-config/pos', { method: 'PUT', body: { data: settings } });
      success(tc('updated'));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }
  async function pairDrawer(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedDevice || !pairingCode.trim()) return;
    setPairing(true);
    setError(null);
    try {
      const pairResponse = await fetch(`${bridgeUrl.replace(/\/+$/, '')}/v1/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: selectedDevice.id, pairing_code: pairingCode.trim() }),
      });
      const bridge = await pairResponse.json() as PairResponse;
      if (!pairResponse.ok || bridge.status !== 'paired' || !bridge.pairing_secret) throw new Error('pairing_failed');
      await api(`/pos-devices/${selectedDevice.id}/cash-drawer/pair`, {
        method: 'POST',
        body: {
          bridge_url: bridgeUrl.replace(/\/+$/, ''),
          pairing_secret: bridge.pairing_secret,
          printer_identifier: bridge.printer_identifier,
          drawer_channel: bridge.drawer_channel,
          pulse_on_ms: bridge.pulse_on_ms,
          pulse_off_ms: bridge.pulse_off_ms,
        },
      });
      setPairingCode('');
      success(t('drawer_pairing_success'));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('drawer_pairing_failed'));
    } finally {
      setPairing(false);
    }
  }
  async function testDrawer() {
    if (!selectedDevice) return;
    setTesting(true);
    setError(null);
    try {
      let action: CashDrawerAction;
      try {
        action = (await api<{ data: CashDrawerAction }>(`/pos-devices/${selectedDevice.id}/cash-drawer/test`, { method: 'POST' })).data;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          errorToast(t('drawer_session_required'));
          return;
        }
        throw err;
      }
      const settle = async (path: string, body: Record<string, unknown>) => {
        try {
          return (await api<{ data: CashDrawerBridgeResult }>(path, { method: 'POST', body })).data;
        } catch (err) {
          const result = resultFromApiError(err);
          if (result) return result;
          throw err;
        }
      };
      const result = await executeCashDrawerAction(
        action,
        (actionId, bridgeResult) => settle(`/pos-devices/${selectedDevice.id}/cash-drawer/test/complete`, { action_id: actionId, result: bridgeResult }),
        (actionId) => settle(`/pos-devices/${selectedDevice.id}/cash-drawer/test/unavailable`, { action_id: actionId }),
      );
      if (result.status === 'opened') success(td('cash_drawer_opened'));
      else errorToast(t('drawer_test_failed'));
      await load();
    } catch (err) {
      errorToast(err instanceof ApiError ? err.message : t('drawer_test_failed'));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back_to_settings')}>
          <Link href="/pos/settings"><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold text-text">{t('cash_drawer_title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('cash_drawer_subtitle')}</p>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : !settings ? (
        <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-sm text-negative">{error ?? t('load_failed')}</p>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <Card>
            <CardHeader>
              <CardTitle>{t('cash_drawer_operation')}</CardTitle>
              <p className="mt-1 text-sm text-muted">{t('cash_drawer_operation_hint')}</p>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveSettings} className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="cash-drawer-driver">{t('cash_drawer_driver')}</Label>
                  <Select id="cash-drawer-driver" value={settings.cash_drawer_driver} onChange={(event) => patch('cash_drawer_driver', event.target.value as CashDrawerSettings['cash_drawer_driver'])}>
                    <option value="unavailable">{t('cash_drawer_driver_unavailable')}</option>
                    <option value="local_bridge">{t('cash_drawer_driver_local_bridge')}</option>
                  </Select>
                </div>
                <label className="flex items-start gap-2 text-sm text-text">
                  <input className="mt-0.5 h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-primary/40" type="checkbox" checked={settings.cash_drawer_enabled} disabled={settings.cash_drawer_driver !== 'local_bridge' || !hasPairedDevice} onChange={(event) => patch('cash_drawer_enabled', event.target.checked)} />
                  <span>{t('cash_drawer_enable')}</span>
                </label>
                {!hasPairedDevice && <p className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-text">{t('drawer_enable_requires_pairing')}</p>}
                <label className="flex items-start gap-2 text-sm text-text">
                  <input className="mt-0.5 h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-primary/40" type="checkbox" checked={settings.cash_drawer_auto_open_after_cash} disabled={!settings.cash_drawer_enabled || settings.cash_drawer_driver !== 'local_bridge'} onChange={(event) => patch('cash_drawer_auto_open_after_cash', event.target.checked)} />
                  <span>{t('cash_drawer_auto_open_after_cash')}</span>
                </label>
                {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
                <div className="flex justify-end"><Button type="submit" disabled={saving}>{tc('save')}</Button></div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('cash_drawer_devices')}</CardTitle>
              <p className="mt-1 text-sm text-muted">{t('cash_drawer_devices_hint')}</p>
            </CardHeader>
            <CardContent>
              {devices.length === 0 ? (
                <p className="rounded border border-border bg-background px-3 py-3 text-sm text-muted">{t('drawer_no_devices')}</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {devices.map((device) => {
                    const status = drawerStatus(device);
                    const selected = device.id === selectedDeviceId;
                    return <button key={device.id} type="button" onClick={() => setSelectedDeviceId(device.id)} aria-pressed={selected} className={`rounded border p-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${selected ? 'border-primary bg-primary-soft' : 'border-border bg-background hover:border-primary'}`}>
                      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-medium text-text">{device.name}</p>{device.code && <p className="num mt-0.5 text-xs text-muted">{device.code}</p>}</div><Badge tone={device.is_active ? 'positive' : 'muted'}>{device.is_active ? td('active') : td('inactive')}</Badge></div>
                      <p className="mt-2 truncate text-xs text-muted">{device.warehouse ? `${device.warehouse.name} · ${device.warehouse.code}` : '—'}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2"><Badge tone={status.tone}>{status.label}</Badge>{device.cash_drawer?.printer_identifier && <span className="max-w-32 truncate text-xs text-muted" title={device.cash_drawer.printer_identifier}>{device.cash_drawer.printer_identifier}</span>}</div>
                    </button>;
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>{t('cash_drawer_local_bridge')}</CardTitle>
              <p className="mt-1 text-sm text-muted">{t('cash_drawer_local_bridge_hint')}</p>
            </CardHeader>
            <CardContent>
              {!selectedDevice ? (
                <p className="rounded border border-border bg-background px-3 py-3 text-sm text-muted">{t('drawer_select_device')}</p>
              ) : (
                <div className="grid gap-5 lg:grid-cols-2">
                  <form onSubmit={pairDrawer} className="space-y-4">
                    <div className="flex items-center gap-2"><Link2 className="h-4 w-4 text-muted" strokeWidth={1.7} aria-hidden="true" /><h3 className="font-medium text-text">{t('drawer_pairing_title')}</h3></div>
                    <div className="space-y-1.5"><Label htmlFor="bridge-url">{td('bridge_url')}</Label><Input id="bridge-url" dir="ltr" className="num" value={bridgeUrl} onChange={(event) => setBridgeUrl(event.target.value)} required disabled={pairing} /></div>
                    <div className="space-y-1.5"><Label htmlFor="pairing-code">{td('pairing_code')}</Label><Input id="pairing-code" dir="ltr" className="num" type="password" autoComplete="one-time-code" value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} required disabled={pairing} /></div>
                    <p className="text-xs leading-relaxed text-muted">{t('drawer_pairing_hint')}</p>
                    <Button type="submit" disabled={pairing || !pairingCode.trim()}>{pairing && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />}{td('pairing')}</Button>
                  </form>
                  <section className="space-y-4 border-t border-border pt-5 lg:border-s lg:border-t-0 lg:ps-5 lg:pt-0" aria-labelledby="drawer-status-heading">
                    <div className="flex items-center gap-2"><Archive className="h-4 w-4 text-muted" strokeWidth={1.7} aria-hidden="true" /><h3 id="drawer-status-heading" className="font-medium text-text">{t('cash_drawer_status')}</h3></div>
                    {(() => {
                      const status = drawerStatus(selectedDevice);
                      return <div className="space-y-3"><Badge tone={status.tone}>{status.label}</Badge><dl className="grid gap-2 text-sm"><div className="flex justify-between gap-3 border-b border-border pb-2"><dt className="text-muted">{t('drawer_printer')}</dt><dd className="num max-w-48 truncate text-text" dir="ltr">{selectedDevice.cash_drawer?.printer_identifier ?? '—'}</dd></div><div className="flex justify-between gap-3 border-b border-border pb-2"><dt className="text-muted">{t('drawer_channel')}</dt><dd className="num text-text">{selectedDevice.cash_drawer?.drawer_channel ?? '—'}</dd></div><div className="flex justify-between gap-3 border-b border-border pb-2"><dt className="text-muted">{t('drawer_pulse_on')}</dt><dd className="num text-text">{selectedDevice.cash_drawer?.pulse_on_ms ?? '—'}</dd></div><div className="flex justify-between gap-3 border-b border-border pb-2"><dt className="text-muted">{t('drawer_pulse_off')}</dt><dd className="num text-text">{selectedDevice.cash_drawer?.pulse_off_ms ?? '—'}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted">{t('drawer_last_test')}</dt><dd className="num text-text">{selectedDevice.cash_drawer?.last_result?.at ? new Date(selectedDevice.cash_drawer.last_result.at).toLocaleString() : '—'}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted">{t('drawer_last_success')}</dt><dd className="num text-text">{selectedDevice.cash_drawer?.last_success_at ? new Date(selectedDevice.cash_drawer.last_success_at).toLocaleString() : '—'}</dd></div></dl></div>;
                    })()}
                    <Button type="button" variant="outline" disabled={!selectedDevice.cash_drawer?.configured || testing} onClick={() => void testDrawer()}><TestTube2 className="h-4 w-4" strokeWidth={1.7} />{testing ? t('drawer_testing') : t('drawer_test')}</Button>
                    {!selectedDevice.cash_drawer?.configured && <p className="text-xs text-muted">{t('drawer_test_requires_pairing')}</p>}
                  </section>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
