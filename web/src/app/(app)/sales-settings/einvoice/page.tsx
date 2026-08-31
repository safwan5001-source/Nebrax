'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, KeyRound, LockKeyhole, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/formatting';

type SubmissionMode = 'manual' | 'automatic';
type ZatcaEnvironment = 'developer' | 'simulation' | 'production';
type CredentialStage = 'compliance' | 'production';

type Readiness = { ready: boolean; environment: string; blockers: string[] };

interface ZatcaSettingsResponse {
  data: { submission_mode: SubmissionMode; active_environment: ZatcaEnvironment };
  meta: {
    signing_readiness: Readiness & { credential_stage: CredentialStage | null };
    transport_readiness: Readiness & { enabled: boolean; queue_connection: string };
  };
}

interface ZatcaCredential {
  id: string;
  environment: ZatcaEnvironment;
  stage: CredentialStage;
  status: string;
  has_binary_security_token: boolean;
  has_secret: boolean;
  has_private_key: boolean;
  has_request_id: boolean;
  public_key_curve: string | null;
  certificate_chain_length: number;
  certificate_fingerprint: string | null;
  configured_at: string | null;
  expires_at: string | null;
  updated_at: string | null;
}

interface ApplicationNavStateResponse { data: Record<string, boolean> }

const ENVIRONMENTS: ZatcaEnvironment[] = ['developer', 'simulation', 'production'];
const environmentLabelKey = (environment: ZatcaEnvironment) => `zatca_environment_${environment}` as const;

export default function EInvoiceSettingsPage() {
  const t = useTranslations('salesSettings');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { success } = useToast();
  const [zatcaAvailable, setZatcaAvailable] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<ZatcaSettingsResponse | null>(null);
  const [credentials, setCredentials] = useState<ZatcaCredential[]>([]);
  const [environment, setEnvironment] = useState<ZatcaEnvironment>('developer');
  const [mode, setMode] = useState<SubmissionMode>('manual');
  const [credentialEnvironment, setCredentialEnvironment] = useState<ZatcaEnvironment>('developer');
  const [stage, setStage] = useState<CredentialStage>('compliance');
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [requestId, setRequestId] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [productionConfirmed, setProductionConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingCredential, setSavingCredential] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const applyConnection = useCallback((nextSettings: ZatcaSettingsResponse, nextCredentials: ZatcaCredential[]) => {
    setSettings(nextSettings);
    setCredentials(nextCredentials);
    setEnvironment(nextSettings.data.active_environment);
    setMode(nextSettings.data.submission_mode);
    setCredentialEnvironment(nextSettings.data.active_environment);
  }, []);

  const loadConnection = useCallback(async () => {
    const [settingsResponse, credentialsResponse] = await Promise.all([
      api<ZatcaSettingsResponse>('/zatca-settings'),
      api<{ data: ZatcaCredential[] }>('/zatca-credentials'),
    ]);
    applyConnection(settingsResponse, credentialsResponse.data);
  }, [applyConnection]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const navState = await api<ApplicationNavStateResponse>('/applications/nav-state');
        if (cancelled) return;
        const available = !Array.isArray(navState.data) && navState.data['compliance.zatca'] === true;
        setZatcaAvailable(available);
        if (!available) return;
        const [settingsResponse, credentialsResponse] = await Promise.all([
          api<ZatcaSettingsResponse>('/zatca-settings'),
          api<{ data: ZatcaCredential[] }>('/zatca-credentials'),
        ]);
        if (!cancelled) applyConnection(settingsResponse, credentialsResponse.data);
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof ApiError ? requestError.message : tc('loadFailed'));
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [applyConnection, tc]);

  const selectedCredential = useMemo(
    () => credentials.find((credential) => credential.environment === credentialEnvironment) ?? null,
    [credentialEnvironment, credentials],
  );

  useEffect(() => {
    setStage(selectedCredential?.stage ?? (credentialEnvironment === 'production' ? 'production' : 'compliance'));
    setToken(''); setSecret(''); setPrivateKey(''); setRequestId(''); setCurrentPassword('');
    setProductionConfirmed(false);
  }, [credentialEnvironment, selectedCredential?.id, selectedCredential?.stage]);

  async function refreshReadiness() {
    setRefreshing(true); setError(null);
    try { await loadConnection(); }
    catch (requestError) { setError(requestError instanceof ApiError ? requestError.message : tc('loadFailed')); }
    finally { setRefreshing(false); }
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!settings || zatcaAvailable !== true) return;
    setSavingSettings(true); setError(null);
    try {
      await api('/zatca-settings', { method: 'PUT', body: { submission_mode: mode, active_environment: environment } });
      await loadConnection();
      success(tc('updated'));
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : tc('saveFailed'));
    } finally { setSavingSettings(false); }
  }

  async function saveCredential(event: React.FormEvent) {
    event.preventDefault();
    if (credentialEnvironment === 'production' && !productionConfirmed) return;
    setSavingCredential(true); setError(null);
    try {
      const body: Record<string, string> = { stage, current_password: currentPassword };
      if (token.trim()) body.binary_security_token = token.trim();
      if (secret.trim()) body.secret = secret.trim();
      if (privateKey.trim()) body.private_key = privateKey.trim();
      if (requestId.trim()) body.request_id = requestId.trim();
      await api(`/zatca-credentials/${credentialEnvironment}`, { method: 'PUT', body });
      const savedEnvironment = credentialEnvironment;
      await loadConnection();
      setCredentialEnvironment(savedEnvironment);
      success(t('zatca_connection.credential_saved'));
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : tc('saveFailed'));
    } finally { setSavingCredential(false); }
  }

  const signingReady = settings?.meta.signing_readiness.ready === true;
  const transportReady = settings?.meta.transport_readiness.ready === true;
  const automaticAllowed = transportReady && environment === settings?.data.active_environment;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">{t('zatca_connection.title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('zatca_connection.subtitle')}</p>
        </div>
        {zatcaAvailable && settings && (
          <Button type="button" variant="outline" onClick={refreshReadiness} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} strokeWidth={1.7} />
            {t('zatca_connection.refresh')}
          </Button>
        )}
      </div>

      {zatcaAvailable === null && !error ? (
        <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-32 w-full" />)}</div>
      ) : zatcaAvailable === false ? (
        <Card className="max-w-2xl"><CardContent className="space-y-3 pt-4">
          <p className="text-sm leading-relaxed text-muted">{t('zatca_application_inactive')}</p>
          <Button asChild><Link href="/applications">{t('zatca_open_applications')}</Link></Button>
        </CardContent></Card>
      ) : !settings ? (
        <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-sm text-negative">{error ?? tc('loadFailed')}</p>
      ) : (
        <>
          <section aria-label={t('zatca_connection.readiness_title')} className="grid gap-4 lg:grid-cols-3">
            <StatusCard title={t('zatca_connection.active_environment')} ready={Boolean(credentials.find((item) => item.environment === settings.data.active_environment))} value={t(environmentLabelKey(settings.data.active_environment))} detail={t('zatca_connection.active_environment_detail')} />
            <StatusCard title={t('zatca_connection.signing')} ready={signingReady} value={signingReady ? t('zatca_connection.ready') : t('zatca_connection.blocked')} detail={readinessDetail(settings.meta.signing_readiness.blockers, t)} />
            <StatusCard title={t('zatca_connection.transport')} ready={transportReady} value={transportReady ? t('zatca_connection.ready') : t('zatca_connection.blocked')} detail={readinessDetail(settings.meta.transport_readiness.blockers, t)} />
          </section>

          {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}

          <Card>
            <CardHeader className="border-b border-border pb-4"><div className="flex items-start gap-3">
              <KeyRound className="mt-0.5 h-5 w-5 text-muted" strokeWidth={1.7} aria-hidden="true" />
              <div><CardTitle className="text-text">{t('zatca_connection.credentials_title')}</CardTitle><p className="mt-1 text-sm leading-relaxed text-muted">{t('zatca_connection.credentials_description')}</p></div>
            </div></CardHeader>
            <Tabs tabs={ENVIRONMENTS.map((item) => ({ id: item, label: t(environmentLabelKey(item)) }))} value={credentialEnvironment} onChange={(value) => setCredentialEnvironment(value as ZatcaEnvironment)} />
            <TabPanel id={credentialEnvironment}>
              <CardContent className="grid gap-5 pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.55fr)]">
                <form onSubmit={saveCredential} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5"><Label htmlFor="credential-stage">{t('zatca_connection.stage')}</Label><Select id="credential-stage" value={stage} disabled={savingCredential} onChange={(event) => setStage(event.target.value as CredentialStage)}><option value="compliance">{t('zatca_connection.stage_compliance')}</option><option value="production">{t('zatca_connection.stage_production')}</option></Select></div>
                    <div className="space-y-1.5"><Label htmlFor="request-id">{t('zatca_connection.request_id')}</Label><Input id="request-id" dir="ltr" value={requestId} disabled={savingCredential} autoComplete="off" onChange={(event) => setRequestId(event.target.value)} placeholder={selectedCredential?.has_request_id ? t('zatca_connection.keep_existing') : ''} /></div>
                  </div>
                  <SecretTextarea id="binary-security-token" label={t('zatca_connection.binary_security_token')} value={token} configured={selectedCredential?.has_binary_security_token === true} required={!selectedCredential} disabled={savingCredential} onChange={setToken} placeholder={t('zatca_connection.keep_existing')} />
                  <div className="space-y-1.5"><Label htmlFor="credential-secret">{t('zatca_connection.secret')}</Label><Input id="credential-secret" type="password" dir="ltr" value={secret} required={!selectedCredential} disabled={savingCredential} autoComplete="new-password" onChange={(event) => setSecret(event.target.value)} placeholder={selectedCredential?.has_secret ? t('zatca_connection.keep_existing') : ''} /></div>
                  <SecretTextarea id="private-key" label={t('zatca_connection.private_key')} value={privateKey} configured={selectedCredential?.has_private_key === true} required={!selectedCredential} disabled={savingCredential} onChange={setPrivateKey} placeholder={t('zatca_connection.keep_existing')} />

                  <div className="rounded border border-border bg-background p-3">
                    <div className="flex items-start gap-2"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} aria-hidden="true" /><p className="text-xs leading-relaxed text-muted">{t('zatca_connection.security_notice')}</p></div>
                    <div className="mt-3 space-y-1.5"><Label htmlFor="current-password">{t('zatca_connection.current_password')}</Label><Input id="current-password" type="password" value={currentPassword} required disabled={savingCredential} autoComplete="current-password" onChange={(event) => setCurrentPassword(event.target.value)} /></div>
                  </div>

                  {credentialEnvironment === 'production' && (
                    <label className="flex items-start gap-2 rounded border border-warning/30 bg-warning/10 p-3 text-sm text-text"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-primary/40" checked={productionConfirmed} disabled={savingCredential} onChange={(event) => setProductionConfirmed(event.target.checked)} /><span>{t('zatca_connection.production_confirmation')}</span></label>
                  )}
                  <div className="flex justify-end"><Button type="submit" disabled={savingCredential || (credentialEnvironment === 'production' && !productionConfirmed)}>{selectedCredential ? t('zatca_connection.update_credential') : t('zatca_connection.configure_credential')}</Button></div>
                </form>
                <CredentialSummary credential={selectedCredential} locale={locale} t={t} />
              </CardContent>
            </TabPanel>
          </Card>

          <Card className="max-w-3xl"><CardHeader><CardTitle className="text-text">{t('zatca_submission_mode')}</CardTitle></CardHeader><CardContent>
            <form onSubmit={saveSettings} className="space-y-4">
              <div className="space-y-1.5"><Label htmlFor="active-environment">{t('zatca_active_environment')}</Label><Select id="active-environment" value={environment} disabled={savingSettings} onChange={(event) => setEnvironment(event.target.value as ZatcaEnvironment)}>{ENVIRONMENTS.map((item) => <option key={item} value={item} disabled={item !== settings.data.active_environment && !credentials.some((credential) => credential.environment === item)}>{t(environmentLabelKey(item))}</option>)}</Select><p className="text-xs leading-relaxed text-muted">{t('zatca_environment_hint')} {t('zatca_connection.environment_requires_credentials')}</p></div>
              {environment === 'production' && <p className="rounded bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">{t('zatca_environment_production_warning')}</p>}
              <div className="space-y-1.5"><Label htmlFor="submission-mode">{t('zatca_submission_mode')}</Label><Select id="submission-mode" value={mode} disabled={savingSettings} onChange={(event) => setMode(event.target.value as SubmissionMode)}><option value="manual">{t('zatca_submission_manual')}</option><option value="automatic" disabled={!automaticAllowed}>{t('zatca_submission_automatic')}</option></Select><p className="text-xs leading-relaxed text-muted">{automaticAllowed ? t('zatca_submission_hint') : t('zatca_connection.automatic_blocked')}</p></div>
              <p className="text-xs leading-relaxed text-muted">{t('zatca_manual_retry_hint')}</p>
              <div className="flex justify-end pt-1"><Button type="submit" disabled={savingSettings || (mode === 'automatic' && !automaticAllowed)}>{tc('save')}</Button></div>
            </form>
          </CardContent></Card>
        </>
      )}
    </div>
  );
}

function StatusCard({ title, ready, value, detail }: { title: string; ready: boolean; value: string; detail: string }) {
  const Icon = ready ? ShieldCheck : ShieldAlert;
  return <Card><CardContent className="flex items-start gap-3 pt-4"><Icon className={`mt-0.5 h-5 w-5 shrink-0 ${ready ? 'text-positive' : 'text-warning'}`} strokeWidth={1.7} aria-hidden="true" /><div className="min-w-0"><p className="text-xs font-medium text-muted">{title}</p><p className="mt-1 font-medium text-text">{value}</p><p className="mt-1 text-xs leading-relaxed text-muted">{detail}</p></div></CardContent></Card>;
}

function SecretTextarea({ id, label, value, configured, required, disabled, onChange, placeholder }: { id: string; label: string; value: string; configured: boolean; required: boolean; disabled: boolean; onChange: (value: string) => void; placeholder: string }) {
  return <div className="space-y-1.5"><div className="flex items-center justify-between gap-2"><Label htmlFor={id}>{label}</Label>{configured && <CheckCircle2 className="h-4 w-4 text-positive" strokeWidth={1.7} aria-label="configured" />}</div><Textarea id={id} dir="ltr" className="min-h-28 font-mono text-xs" value={value} required={required} disabled={disabled} autoComplete="off" spellCheck={false} onChange={(event) => onChange(event.target.value)} placeholder={configured ? placeholder : ''} /></div>;
}

function CredentialSummary({ credential, locale, t }: { credential: ZatcaCredential | null; locale: string; t: ReturnType<typeof useTranslations<'salesSettings'>> }) {
  if (!credential) return <aside className="rounded border border-dashed border-border p-4"><AlertTriangle className="h-5 w-5 text-warning" strokeWidth={1.7} aria-hidden="true" /><p className="mt-3 text-sm font-medium text-text">{t('zatca_connection.not_configured')}</p><p className="mt-1 text-xs leading-relaxed text-muted">{t('zatca_connection.not_configured_detail')}</p></aside>;
  const complete = credential.has_binary_security_token && credential.has_secret && credential.has_private_key;
  return <aside className="rounded border border-border bg-background p-4"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-text">{t('zatca_connection.credential_summary')}</p><Badge tone={complete ? 'positive' : 'warning'}>{complete ? t('zatca_connection.configured') : t('zatca_connection.incomplete')}</Badge></div><dl className="mt-4 space-y-3 text-xs"><SummaryRow label={t('zatca_connection.stage')} value={t(`zatca_connection.stage_${credential.stage}`)} /><SummaryRow label={t('zatca_connection.certificate_expiry')} value={formatDateTime(credential.expires_at, locale)} mono /><SummaryRow label={t('zatca_connection.configured_at')} value={formatDateTime(credential.configured_at, locale)} mono /><SummaryRow label={t('zatca_connection.public_key_curve')} value={credential.public_key_curve ?? '—'} mono /><SummaryRow label={t('zatca_connection.certificate_chain')} value={String(credential.certificate_chain_length)} mono /><div className="border-t border-border pt-3"><dt className="text-muted">{t('zatca_connection.fingerprint')}</dt><dd className="num mt-1 break-all text-text" dir="ltr">{credential.certificate_fingerprint ?? '—'}</dd></div></dl><p className="mt-4 flex items-start gap-2 border-t border-border pt-3 text-xs leading-relaxed text-muted"><LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.7} aria-hidden="true" />{t('zatca_connection.secrets_hidden')}</p></aside>;
}

function SummaryRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex items-start justify-between gap-3 border-b border-border pb-3"><dt className="text-muted">{label}</dt><dd className={`${mono ? 'num' : ''} text-end text-text`} dir={mono ? 'ltr' : undefined}>{value}</dd></div>;
}

function readinessDetail(blockers: string[], t: ReturnType<typeof useTranslations<'salesSettings'>>) {
  if (blockers.length === 0) return t('zatca_connection.no_blockers');
  const knownBlockers: Record<string, string> = {
    credential_unavailable: 'zatca_connection.blockers.credential_unavailable',
    signature_policy_unavailable: 'zatca_connection.blockers.signature_policy_unavailable',
    dispatch_disabled: 'zatca_connection.blockers.dispatch_disabled',
    unsafe_queue_connection: 'zatca_connection.blockers.unsafe_queue_connection',
    transport_credential_unavailable: 'zatca_connection.blockers.transport_credential_unavailable',
    submission_endpoint_unavailable: 'zatca_connection.blockers.submission_endpoint_unavailable',
  };
  return blockers.map((blocker) => t(knownBlockers[blocker] ?? 'zatca_connection.blockers.unknown')).join(' · ');
}
