'use client';

import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { platformApi } from '@/lib/platform-api';
import { ConfirmDialog } from './confirm-dialog';
import {
  CAPABILITIES,
  MAX_REASON,
  controlsPath,
  grantEnabled,
  readPlatform,
  readTenant,
  reasonValid,
  type Capability,
  type ControlEvent,
  type PlatformControls,
  type TenantControls,
} from './ai-action-controls';

interface Pending {
  actionType: string;
  capability: Capability;
  next: boolean;
}

/**
 * ضوابط المشغّل لإجراءات المساعد (IMP-X-01d): بلا `tenantId` = مساحة المنصة (المفتاح الرئيسي وتوفّر كل نوع + سجل التدقيق)،
 * ومعه = منحة هذا المستأجر لكل نوع مع القرار الفعّال وسببه. كل تغيير بسببٍ إلزامي في حوار تأكيد، والخادم يكتب الحدث ثم نعيد التحميل.
 * الأعلام البيئية تُعرض للقراءة فقط (أرضية صلبة، D-10). الضوابط شرط لازم لا كافٍ: لا تمنح صلاحية ولا تتجاوز المعاينة والموافقة.
 */
export function AiActionControlsCard({ tenantId }: { tenantId?: string }): JSX.Element {
  const t = useTranslations('platformAiActions');
  const [platform, setPlatform] = useState<PlatformControls | null>(null);
  const [tenant, setTenant] = useState<TenantControls | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const seq = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setLoadError(false);
    try {
      const payload = await platformApi<unknown>(controlsPath(tenantId));
      if (mine !== seq.current) return;
      if (tenantId) {
        const data = readTenant(payload);
        if (!data) throw new Error('shape');
        setTenant(data);
      } else {
        const data = readPlatform(payload);
        if (!data) throw new Error('shape');
        setPlatform(data);
      }
    } catch {
      if (mine === seq.current) setLoadError(true);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const label = (code: string): string => (t.has(`reasons.${code}`) ? t(`reasons.${code}`) : code);
  const stateText = (on: boolean): string => (on ? t('granted') : t('notGranted'));

  const ask = (event: React.MouseEvent<HTMLElement>, actionType: string, capability: Capability, current: boolean): void => {
    returnFocus.current = event.currentTarget;
    setReason('');
    setNotice(null);
    setPending({ actionType, capability, next: !current });
  };

  const confirm = async (): Promise<void> => {
    if (!pending || !reasonValid(reason)) return;
    setBusy(true);
    try {
      await platformApi(controlsPath(tenantId), {
        method: 'PUT',
        body: { action_type: pending.actionType, capability: pending.capability, enabled: pending.next, reason: reason.trim() },
      });
      setPending(null);
      setNotice({ ok: true, message: t('saved') });
      await load();
    } catch (error) {
      setNotice({ ok: false, message: error instanceof ApiError ? error.message : t('saveFailed') });
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (actionType: string, capability: Capability, current: boolean, name: string): JSX.Element => (
    <Button
      type="button"
      variant={current ? 'primary' : 'outline'}
      size="sm"
      aria-pressed={current}
      aria-label={t('toggleLabel', { target: name, capability: t(`capability.${capability}`) })}
      onClick={(event) => ask(event, actionType, capability, current)}
    >
      {stateText(current)}
    </Button>
  );

  const events: ControlEvent[] = (tenantId ? tenant?.events : platform?.events) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tenantId ? t('tenantTitle') : t('title')}</CardTitle>
        <p className="text-sm text-muted">{t('hint')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice ? (
          <p role={notice.ok ? 'status' : 'alert'} className={notice.ok ? 'text-sm text-positive' : 'text-sm text-negative'}>
            {notice.message}
          </p>
        ) : null}
        {loading ? <Skeleton className="h-24 w-full" /> : null}
        {loadError ? (
          <div role="alert" className="flex items-center justify-between gap-2 text-sm text-negative">
            <span>{t('loadFailed')}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              {t('retry')}
            </Button>
          </div>
        ) : null}

        {!loading && !loadError && platform && !tenantId ? (
          <>
            <section aria-label={t('envFloor')} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{t('envFloor')}</span>
              {CAPABILITIES.map((capability) => (
                <Badge wrap key={capability} tone={platform.env_floor[capability] ? 'positive' : 'muted'}>
                  {t(`capability.${capability}`)}: {platform.env_floor[capability] ? t('floorOn') : t('floorOff')}
                </Badge>
              ))}
              <span className="text-muted">{t('envFloorHint')}</span>
            </section>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-start text-muted">
                    <th className="p-2 text-start">{t('columns.target')}</th>
                    {CAPABILITIES.map((capability) => (
                      <th key={capability} className="p-2 text-start">{t(`capability.${capability}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border">
                    <td className="p-2 font-medium">{t('master')}</td>
                    {CAPABILITIES.map((capability) => (
                      <td key={capability} className="p-2">{toggle('*', capability, platform.master[capability].enabled, t('master'))}</td>
                    ))}
                  </tr>
                  {platform.types.map((row) => (
                    <tr key={row.action_type} className="border-t border-border">
                      <td className="p-2" dir="ltr">{row.action_type}</td>
                      {CAPABILITIES.map((capability) => (
                        <td key={capability} className="p-2">{toggle(row.action_type, capability, row.state[capability].enabled, row.action_type)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {!loading && !loadError && tenant && tenantId ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-muted">
                  <th className="p-2 text-start">{t('columns.target')}</th>
                  {CAPABILITIES.map((capability) => (
                    <th key={capability} className="p-2 text-start">{t(`capability.${capability}`)}</th>
                  ))}
                  <th className="p-2 text-start">{t('columns.effective')}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(tenant.effective).map(([type, decisions]) => (
                  <tr key={type} className="border-t border-border align-top">
                    <td className="p-2" dir="ltr">{type}</td>
                    {CAPABILITIES.map((capability) => (
                      <td key={capability} className="p-2">{toggle(type, capability, grantEnabled(tenant, type, capability), type)}</td>
                    ))}
                    <td className="space-y-1 p-2">
                      {(['preview', 'review', 'execution'] as const).map((capability) => (
                        <div key={capability} className="flex flex-wrap items-center gap-2">
                          <Badge wrap tone={decisions[capability].allowed ? 'positive' : 'muted'}>{t(`effective.${capability}`)}</Badge>
                          <span className="text-xs text-muted">{decisions[capability].allowed ? t('allowed') : label(decisions[capability].reason)}</span>
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {!loading && !loadError ? (
          <section aria-label={t('events')} className="space-y-1">
            <h3 className="text-sm font-medium">{t('events')}</h3>
            {events.length === 0 ? <p className="text-sm text-muted">{t('noEvents')}</p> : null}
            <ul className="space-y-1 text-xs text-muted">
              {events.map((event) => (
                <li key={`${event.action_type}-${event.capability}-${event.version}-${event.occurred_at}`}>
                  <span dir="ltr">{event.action_type === '*' ? t('master') : event.action_type}</span> · {t(`capability.${event.capability}`)} · {stateText(event.previous_enabled)} → {stateText(event.new_enabled)} · {event.reason}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={pending !== null}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirm()}
        title={pending?.next ? t('confirmGrantTitle') : t('confirmRevokeTitle')}
        description={pending ? t(pending.next ? 'confirmGrant' : 'confirmRevoke', { target: pending.actionType === '*' ? t('master') : pending.actionType, capability: t(`capability.${pending.capability}`) }) : ''}
        confirmLabel={t('confirm')}
        cancelLabel={t('cancel')}
        closeLabel={t('close')}
        confirmVariant={pending?.next ? 'primary' : 'danger'}
        busy={busy}
        confirmDisabled={!reasonValid(reason)}
        returnFocusTo={returnFocus.current}
      >
        <div className="space-y-1">
          <Label htmlFor="ai-control-reason">{t('reason')}</Label>
          <Textarea id="ai-control-reason" value={reason} maxLength={MAX_REASON} onChange={(event) => setReason(event.target.value)} aria-describedby="ai-control-reason-hint" />
          <p id="ai-control-reason-hint" className="text-xs text-muted">{t('reasonHint')}</p>
        </div>
      </ConfirmDialog>
    </Card>
  );
}
