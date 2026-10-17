'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { EmptyState, LoadingState, PageHeader } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { fetchAuditEvents, saveSettings } from '@/modules/intelligence/api';
import type { AuditEvent, DataCategoryKey } from '@/modules/intelligence/contract';
import { classifyError, type ClassifiedError } from '@/modules/intelligence/state';
import { useIntelligence } from '@/modules/intelligence/store';
import { AuditActivity } from './audit-activity';
import { StateNotice } from './state-notice';

type Pending =
  | { kind: 'enable' }
  | { kind: 'grant'; category: DataCategoryKey }
  | { kind: 'disable' };

/**
 * موافقة المؤسسة على المساعد (مالك/مدير فقط — `ai.consent.manage`). كل منح يمرّ بحوار إقرار صريح؛ السحب والتعطيل
 * متاحان دائماً. الخادم هو السلطة: الواجهة لا تفترض نجاحاً، وتعتمد الحالة المُعادة منه فقط.
 */
export function ConsentSettings() {
  const t = useTranslations('intelligence.settings');
  const tn = useTranslations('intelligence');
  const store = useIntelligence();
  const { status, statusPhase, statusError, identity, refreshStatus, applyStatus } = store;

  const [pending, setPending] = useState<Pending | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [saved, setSaved] = useState(false);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [auditFailed, setAuditFailed] = useState(false);
  const identityRef = useRef(identity);
  identityRef.current = identity;

  useEffect(() => { if (identity) void refreshStatus(); }, [identity, refreshStatus]);

  const canAudit = status?.abilities.view_audit === true;
  const loadAudit = async (forIdentity: string) => {
    try {
      const rows = await fetchAuditEvents(10);
      if (identityRef.current !== forIdentity) return; // تبدّلت الهوية أثناء الطيران
      setEvents(rows);
      setAuditFailed(false);
    } catch {
      if (identityRef.current === forIdentity) setAuditFailed(true);
    }
  };
  useEffect(() => {
    setEvents(null);
    if (identity && canAudit) void loadAudit(identity);
  }, [identity, canAudit]); // eslint-disable-line react-hooks/exhaustive-deps

  async function commit(payload: { enabled: boolean; categories: DataCategoryKey[]; acknowledge?: boolean }) {
    if (!status || saving) return;
    const forIdentity = identity;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await saveSettings({
        enabled: payload.enabled,
        consented_categories: payload.categories,
        ...(payload.acknowledge ? { acknowledge_privacy: true } : {}),
      });
      if (identityRef.current !== forIdentity) return;
      applyStatus(next);
      setSaved(true);
      setPending(null);
      setAcknowledged(false);
      if (next.abilities.view_audit) void loadAudit(forIdentity);
    } catch (caught) {
      if (identityRef.current !== forIdentity) return;
      const classified = classifyError(caught);
      setError(classified);
      setPending(null);
      setAcknowledged(false);
      if (classified.refreshStatus) void refreshStatus();
    } finally {
      if (identityRef.current === forIdentity) setSaving(false);
    }
  }

  if (!status) {
    if (statusPhase === 'error' && statusError) {
      return <StateNotice notice={statusError.notice} code={statusError.code} onRetry={() => void refreshStatus()} />;
    }
    return <LoadingState variant="cards" rows={3} label={t('loading')} />;
  }

  if (!status.abilities.manage_consent) {
    return <EmptyState titleAs="h1" title={t('denied_title')} description={t('denied_body')} />;
  }

  const consented = new Set(status.tenant.consented_categories);
  const enabled = status.tenant.enabled;
  const platformOn = status.platform_enabled;

  const onMaster = (next: boolean) => setPending(next ? { kind: 'enable' } : { kind: 'disable' });
  const onCategory = (key: DataCategoryKey, next: boolean) => {
    if (next) return setPending({ kind: 'grant', category: key });
    void commit({ enabled: true, categories: [...consented].filter((c) => c !== key) });
  };

  function confirm() {
    if (!pending) return;
    if (pending.kind === 'disable') return void commit({ enabled: false, categories: [] });
    const categories = pending.kind === 'grant' ? [...consented, pending.category] : [...consented];
    void commit({ enabled: true, categories, acknowledge: true });
  }

  const needsAck = pending !== null && pending.kind !== 'disable';

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actionsSlot={
          <Button asChild variant="outline">
            <Link href="/intelligence"><ArrowRight className="h-4 w-4 ltr:rotate-180" strokeWidth={1.7} aria-hidden="true" />{t('back')}</Link>
          </Button>
        }
      />

      {!platformOn ? <StateNotice notice="platform_disabled" compact /> : null}
      {error ? <StateNotice notice={error.notice} code={error.code} canManageConsent /> : null}
      {saved && !error ? <p role="status" className="rounded border border-positive/40 bg-positive/10 p-3 text-sm text-text">{t('saved')}</p> : null}

      <section className="divide-y divide-border rounded border border-border bg-surface" aria-label={t('master')}>
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <p id="ai-master-label" className="text-sm font-medium">{t('master')}</p>
            <p className="mt-0.5 text-xs text-muted">{t('master_help')}</p>
          </div>
          <Switch
            checked={enabled}
            disabled={saving || (!enabled && !platformOn)}
            aria-labelledby="ai-master-label"
            onCheckedChange={onMaster}
          />
        </div>

        <div className="p-4">
          <h2 className="text-xs font-medium text-muted">{t('categories')}</h2>
          <ul className="mt-2 divide-y divide-border">
            {status.categories.map((category) => {
              const isOn = consented.has(category.key);
              const labelId = `ai-cat-${category.key}`;
              const locked = !category.available || !enabled || saving || (!isOn && !platformOn);
              return (
                <li key={category.key} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p id={labelId} className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {t(`category.${category.key}`)}
                      {!category.available ? <Badge tone="muted">{t('unavailable')}</Badge> : <Badge tone={isOn ? 'positive' : 'muted'}>{isOn ? t('granted') : t('not_granted')}</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">{t(`category_help.${category.key}`)}</p>
                  </div>
                  <Switch checked={isOn} disabled={locked} aria-labelledby={labelId} onCheckedChange={(next) => onCategory(category.key, next)} />
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-muted">{t('document_center_note')}</p>
        </div>
      </section>

      {status.provider_mode === 'mock' ? <p className="text-xs text-muted">{t('mock_note')}</p> : null}
      {saving ? <p role="status" className="text-xs text-muted">{t('saving')}</p> : null}

      {canAudit ? <AuditActivity events={events} failed={auditFailed} /> : null}

      <Dialog
        open={pending !== null}
        onClose={() => { if (!saving) { setPending(null); setAcknowledged(false); } }}
        title={pending?.kind === 'disable' ? t('revoke_confirm') : t('confirm_title')}
        closeLabel={t('cancel')}
      >
        {pending ? (
          <div className="space-y-4">
            {needsAck ? (
              <>
                <p className="text-sm">
                  {pending.kind === 'grant'
                    ? t('confirm_enable', { categories: t(`category.${pending.category}`) })
                    : t('confirm_enable_only')}
                </p>
                <div className="rounded border border-border bg-background p-3">
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-medium"><ShieldCheck className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />{t('privacy_title')}</p>
                  <ul className="list-disc space-y-1 ps-5 text-xs text-muted">
                    {(['p1', 'p2', 'p3', 'p4'] as const).map((key) => (<li key={key}>{t(`privacy_points.${key}`)}</li>))}
                  </ul>
                </div>
                <label className="flex min-h-11 cursor-pointer items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
                  <span>{t('acknowledge')}</span>
                </label>
              </>
            ) : (
              <p className="text-sm">{t('master_help')}</p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={() => { setPending(null); setAcknowledged(false); }}>{t('cancel')}</Button>
              <Button type="button" variant={pending.kind === 'disable' ? 'danger' : 'primary'} disabled={saving || (needsAck && !acknowledged)} onClick={confirm}>
                {pending.kind === 'disable' ? t('revoke_confirm') : t('confirm')}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
      <span className="sr-only">{tn('title')}</span>
    </div>
  );
}
