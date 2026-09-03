'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { api, ApiError, hasApiStatus } from '@/lib/api';
import { POS_RETURN_HREF, POS_SELLING_HREF, POS_START_HREF } from '@/lib/pos-workspace';
import {
  buildPosSessionOpenPayload,
  canSubmitPosSessionOpen,
  findMyOpenSession,
  selectableActiveRecords,
} from '@/lib/pos-open-session';

interface PosDevice {
  id: string;
  name: string;
  code: string | null;
  is_active: boolean;
  warehouse?: { id: string; name: string; code: string } | null;
}

interface PosShift {
  id: string;
  name: string;
  code: string | null;
  is_active: boolean;
}

interface PosSession {
  id: string;
  status: string;
}

function deviceLabel(device: PosDevice): string {
  const code = device.code ? ` · ${device.code}` : '';
  const warehouse = device.warehouse ? ` — ${device.warehouse.name}` : '';
  return `${device.name}${code}${warehouse}`;
}

function shiftLabel(shift: PosShift): string {
  return shift.code ? `${shift.name} · ${shift.code}` : shift.name;
}

function OpenSellingSessionForm() {
  const t = useTranslations('posOpenSession');
  const tc = useTranslations('common');
  const locale = useLocale();
  const rtl = locale === 'ar';
  const router = useRouter();
  const searchParams = useSearchParams();
  const closedRemote = searchParams.get('reason') === 'closed';

  const [ready, setReady] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [shifts, setShifts] = useState<PosShift[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [amount, setAmount] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const activeDevices = useMemo(() => selectableActiveRecords(devices), [devices]);
  const activeShifts = useMemo(() => selectableActiveRecords(shifts), [shifts]);
  // التصفية أعلاه UX للقائمة فقط. الخادم يبقى مصدر الحقيقة لعزل المستأجر/الفرع
  // ولرفض الجهاز أو الوردية المعطّلين عند POST /pos-sessions/open.
  const submitEnabled = canSubmitPosSessionOpen({
    openingBalanceRiyal: amount,
    posDeviceId: deviceId,
    posShiftId: shiftId,
  }, busy);

  const adoptOpenSession = useCallback(async (): Promise<boolean> => {
    const result = await api<{ data: PosSession[] }>('/pos-sessions?mine=1');
    const current = findMyOpenSession(result.data);
    if (!current) return false;
    router.replace(POS_SELLING_HREF);
    return true;
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<{ data: PosSession[] }>('/pos-sessions?mine=1'),
      api<{ data: PosDevice[] }>('/pos-devices'),
      api<{ data: PosShift[] }>('/pos-shifts'),
    ])
      .then(([sessions, deviceResult, shiftResult]) => {
        if (cancelled) return;
        const current = findMyOpenSession(sessions.data);
        if (current) {
          setResuming(true);
          router.replace(POS_SELLING_HREF);
          return;
        }
        setDevices(deviceResult.data);
        setShifts(shiftResult.data);
        setReady(true);
      })
      .catch((cause) => {
        if (cancelled) return;
        setLoadError(cause instanceof ApiError ? cause.message : tc('loadFailed'));
        setReady(true);
      });
    return () => { cancelled = true; };
  }, [router, tc]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submittingRef.current || busy) return;

    const parsed = buildPosSessionOpenPayload({
      openingBalanceRiyal: amount,
      posDeviceId: deviceId,
      posShiftId: shiftId,
    });
    if (!parsed.ok) {
      setError(t(parsed.error));
      return;
    }

    submittingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await api('/pos-sessions/open', { method: 'POST', body: parsed.payload });
      router.replace(POS_SELLING_HREF);
    } catch (cause) {
      if (hasApiStatus(cause, 422)) {
        try {
          if (await adoptOpenSession()) return;
        } catch {
          // نعرض خطأ الفتح الأصلي إن تعذّر التبنّي.
        }
      }
      setError(cause instanceof ApiError ? cause.message : tc('saveFailed'));
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div
      dir={rtl ? 'rtl' : 'ltr'}
      className="flex h-full overflow-y-auto bg-background"
      data-testid="pos-open-session-page"
    >
      <div className="mx-auto flex w-full max-w-lg flex-col justify-center px-4 py-6">
        <Card>
          <CardHeader className="space-y-2">
            <h1 className="text-lg font-semibold text-text">{t('title')}</h1>
            <p className="text-sm leading-relaxed text-muted">{t('description')}</p>
          </CardHeader>
          <CardContent>
            {closedRemote && (
              <p role="alert" data-testid="pos-session-invalid-banner" className="mb-4 rounded bg-negative/10 px-3 py-2 text-sm text-negative">
                {t('session_closed_remote')}
              </p>
            )}

            {!ready || resuming ? (
              <p className="text-sm text-muted">{resuming ? t('resuming') : tc('loading')}</p>
            ) : loadError ? (
              <div className="space-y-4">
                <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-sm text-negative">{loadError}</p>
                <Button asChild type="button" variant="outline" className="min-h-11">
                  <Link href={POS_START_HREF}>{tc('retry')}</Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="pos-open-device">{t('device')}</Label>
                  <Select
                    id="pos-open-device"
                    value={deviceId}
                    required
                    disabled={busy || activeDevices.length === 0}
                    className="h-11 min-h-11"
                    onChange={(event) => setDeviceId(event.target.value)}
                  >
                    <option value="">{t('select_device')}</option>
                    {activeDevices.map((device) => (
                      <option key={device.id} value={device.id}>{deviceLabel(device)}</option>
                    ))}
                  </Select>
                  {activeDevices.length === 0 && <p className="text-xs text-warning">{t('no_device')}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="pos-open-shift">{t('pos_shift')}</Label>
                  <Select
                    id="pos-open-shift"
                    value={shiftId}
                    required
                    disabled={busy || activeShifts.length === 0}
                    className="h-11 min-h-11"
                    onChange={(event) => setShiftId(event.target.value)}
                  >
                    <option value="">{t('select_shift')}</option>
                    {activeShifts.map((shift) => (
                      <option key={shift.id} value={shift.id}>{shiftLabel(shift)}</option>
                    ))}
                  </Select>
                  {activeShifts.length === 0 && <p className="text-xs text-warning">{t('no_shift')}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="pos-open-opening-cash">{t('opening_cash')}</Label>
                  <p className="text-xs text-muted">{t('opening_cash_hint')}</p>
                  <Input
                    id="pos-open-opening-cash"
                    className="num min-h-11 text-end"
                    inputMode="decimal"
                    value={amount}
                    disabled={busy}
                    autoFocus
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </div>

                {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

                <div className="flex justify-end gap-2 pt-1">
                  <Button asChild type="button" variant="outline" className="min-h-11">
                    <Link href={POS_RETURN_HREF}>{t('cancel')}</Link>
                  </Button>
                  <Button type="submit" className="min-h-11" disabled={!submitEnabled}>
                    {t('submit')}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function OpenSellingSessionPage() {
  return (
    <Suspense fallback={<div className="grid h-full place-items-center bg-background text-sm text-muted">…</div>}>
      <OpenSellingSessionForm />
    </Suspense>
  );
}

