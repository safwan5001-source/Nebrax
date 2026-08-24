'use client';
import { DISPLAY_LOCALE } from '@/lib/formatting';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
  Save,
  ServerCog,
  ShieldCheck,
  TestTube2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { isPlatformAuthenticated } from '@/lib/platform-auth';
import { platformApi } from '@/lib/platform-api';
import { payloadFor, type IntegrationFormState, type IntegrationKey } from './payload';

type Translate = (key: any, values?: any) => string;

interface IntegrationSummary {
  key: IntegrationKey;
  provider: string | null;
  enabled: boolean;
  configured: boolean;
  configuration: Record<string, unknown>;
  configured_at: string | null;
}

interface RuntimeSummary {
  queue_connection: string;
  queue_configured: boolean;
  worker_status: 'online' | 'offline';
  worker_last_seen_at: string | null;
  queued_runs: number;
  running_runs: number;
  failed_runs: number;
}

interface OverviewResponse {
  data: {
    integrations: IntegrationSummary[];
    runtime: RuntimeSummary;
  };
}

type FormState = IntegrationFormState;

const emptyForm: FormState = {
  enabled: false,
  provider: '',
  endpoint: '',
  bucket: '',
  region: 'auto',
  access_key_id: '',
  secret_access_key: '',
  use_path_style_endpoint: true,
  host: '',
  port: '3310',
  timeout_seconds: '10',
  max_attempts: '3',
  backoff_seconds: '30,120,300',
  model: '',
  api_key: '',
  current_password: '',
};

export default function PlatformIntegrationsPage() {
  const t = useTranslations('platformIntegrations');
  const router = useRouter();
  const [overview, setOverview] = useState<OverviewResponse['data'] | null>(null);
  const [forms, setForms] = useState<Record<IntegrationKey, FormState>>({
    document_storage: { ...emptyForm, provider: 'r2' },
    malware_scanner: { ...emptyForm, provider: 'clamav_tcp' },
    document_processing: { ...emptyForm, provider: 'redis' },
    document_ai: { ...emptyForm, provider: 'openai' },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<IntegrationKey | null>(null);
  const [testing, setTesting] = useState<IntegrationKey | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await platformApi<OverviewResponse>('/platform/integrations');
      setOverview(response.data);
      setForms((current) => hydrateForms(current, response.data.integrations));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!isPlatformAuthenticated()) {
      router.replace('/platform/login');
      return;
    }
    load();
  }, [load, router]);

  const summaries = useMemo(
    () => Object.fromEntries((overview?.integrations ?? []).map((item) => [item.key, item])) as Partial<Record<IntegrationKey, IntegrationSummary>>,
    [overview],
  );

  function update(key: IntegrationKey, field: keyof FormState, value: string | boolean) {
    setForms((current) => ({ ...current, [key]: { ...current[key], [field]: value } }));
  }

  async function save(key: IntegrationKey) {
    setBusy(key);
    setNotice(null);
    try {
      const response = await platformApi<OverviewResponse>(`/platform/integrations/${key}`, {
        method: 'PUT',
        body: payloadFor(key, forms[key]),
      });
      setOverview(response.data);
      setForms((current) => hydrateForms(current, response.data.integrations));
      setNotice({ ok: true, message: t('saved') });
    } catch (reason) {
      setNotice({ ok: false, message: reason instanceof ApiError ? reason.message : t('saveFailed') });
    } finally {
      setBusy(null);
    }
  }

  async function testConnection(key: IntegrationKey) {
    setTesting(key);
    setNotice(null);
    try {
      const response = await platformApi<{ data: { ok: boolean; message: string } }>(`/platform/integrations/${key}/test`, {
        method: 'POST',
      });
      setNotice(response.data);
      await load();
    } catch (reason) {
      setNotice({ ok: false, message: reason instanceof ApiError ? reason.message : t('testFailed') });
    } finally {
      setTesting(null);
    }
  }

  if (loading && !overview) {
    return <main className="min-h-screen bg-background p-5"><Skeleton className="mx-auto h-[42rem] max-w-6xl" /></main>;
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-start gap-3">
            <ServerCog className="mt-0.5 h-6 w-6 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold text-primary">{t('eyebrow')}</p>
              <h1 className="mt-0.5 text-xl font-semibold text-text">{t('title')}</h1>
              <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push('/platform')}>
              <ArrowRight className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              {t('back')}
            </Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.7} aria-hidden="true" />
              {t('refresh')}
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        {notice && (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-surface p-3 text-sm" role="status">
            {notice.ok
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" strokeWidth={1.7} aria-hidden="true" />
              : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-negative" strokeWidth={1.7} aria-hidden="true" />}
            <span className="text-text">{notice.message}</span>
          </div>
        )}

        {error ? (
          <Card><CardContent className="flex items-center justify-between gap-4 p-5">
            <p className="text-sm text-negative" role="alert">{error}</p>
            <Button variant="outline" onClick={load}>{t('retry')}</Button>
          </CardContent></Card>
        ) : (
          <>
            {overview && <RuntimeCard runtime={overview.runtime} t={t} />}

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <SettingsCard
                title={t('storageTitle')}
                description={t('storageDescription')}
                icon={Database}
                enabled={forms.document_storage.enabled}
                configuredAt={summaries.document_storage?.configured_at}
                onEnabled={(value) => update('document_storage', 'enabled', value)}
                actions={<CardActions integration="document_storage" busy={busy} testing={testing} save={save} test={testConnection} t={t} />}
              >
                <Field label={t('provider')}><Select value={forms.document_storage.provider} onChange={(value) => update('document_storage', 'provider', value)} options={[['r2', 'Cloudflare R2'], ['s3', 'Amazon S3'], ['s3_compatible', 'S3 Compatible']]} /></Field>
                <Field label={t('endpoint')}><Input value={forms.document_storage.endpoint} onChange={(e) => update('document_storage', 'endpoint', e.target.value)} dir="ltr" /></Field>
                <Field label={t('bucket')}><Input value={forms.document_storage.bucket} onChange={(e) => update('document_storage', 'bucket', e.target.value)} dir="ltr" /></Field>
                <Field label={t('region')}><Input value={forms.document_storage.region} onChange={(e) => update('document_storage', 'region', e.target.value)} dir="ltr" /></Field>
                <SecretField label={t('accessKey')} masked={String(summaries.document_storage?.configuration.access_key_id_masked ?? '')} value={forms.document_storage.access_key_id} onChange={(value) => update('document_storage', 'access_key_id', value)} />
                <SecretField label={t('secretKey')} masked={String(summaries.document_storage?.configuration.secret_access_key_masked ?? '')} value={forms.document_storage.secret_access_key} onChange={(value) => update('document_storage', 'secret_access_key', value)} />
                <AdminPasswordField value={forms.document_storage.current_password} onChange={(value) => update('document_storage', 'current_password', value)} />
              </SettingsCard>

              <SettingsCard
                title={t('scannerTitle')}
                description={t('scannerDescription')}
                icon={ShieldCheck}
                enabled={forms.malware_scanner.enabled}
                configuredAt={summaries.malware_scanner?.configured_at}
                onEnabled={(value) => update('malware_scanner', 'enabled', value)}
                actions={<CardActions integration="malware_scanner" busy={busy} testing={testing} save={save} test={testConnection} t={t} />}
              >
                <Field label={t('provider')}><Select value={forms.malware_scanner.provider} onChange={(value) => update('malware_scanner', 'provider', value)} options={[['clamav_tcp', 'ClamAV TCP']]} /></Field>
                <Field label={t('host')}><Input value={forms.malware_scanner.host} onChange={(e) => update('malware_scanner', 'host', e.target.value)} dir="ltr" /></Field>
                <Field label={t('port')}><Input type="number" value={forms.malware_scanner.port} onChange={(e) => update('malware_scanner', 'port', e.target.value)} dir="ltr" /></Field>
                <Field label={t('timeout')}><Input type="number" value={forms.malware_scanner.timeout_seconds} onChange={(e) => update('malware_scanner', 'timeout_seconds', e.target.value)} dir="ltr" /></Field>
                <AdminPasswordField value={forms.malware_scanner.current_password} onChange={(value) => update('malware_scanner', 'current_password', value)} />
              </SettingsCard>

              <SettingsCard
                title={t('processingTitle')}
                description={t('processingDescription')}
                icon={ServerCog}
                enabled={forms.document_processing.enabled}
                configuredAt={summaries.document_processing?.configured_at}
                onEnabled={(value) => update('document_processing', 'enabled', value)}
                actions={<CardActions integration="document_processing" busy={busy} testing={testing} save={save} test={testConnection} t={t} />}
              >
                <Field label={t('maxAttempts')}><Input type="number" min={1} max={5} value={forms.document_processing.max_attempts} onChange={(e) => update('document_processing', 'max_attempts', e.target.value)} dir="ltr" /></Field>
                <Field label={t('timeout')}><Input type="number" min={10} max={120} value={forms.document_processing.timeout_seconds} onChange={(e) => update('document_processing', 'timeout_seconds', e.target.value)} dir="ltr" /></Field>
                <Field label={t('backoff')}><Input value={forms.document_processing.backoff_seconds} onChange={(e) => update('document_processing', 'backoff_seconds', e.target.value)} dir="ltr" placeholder="30,120,300" /></Field>
                <AdminPasswordField value={forms.document_processing.current_password} onChange={(value) => update('document_processing', 'current_password', value)} />
              </SettingsCard>

              <SettingsCard
                title={t('aiTitle')}
                description={t('aiDescription')}
                icon={Bot}
                enabled={forms.document_ai.enabled}
                configuredAt={summaries.document_ai?.configured_at}
                onEnabled={(value) => update('document_ai', 'enabled', value)}
                actions={<CardActions integration="document_ai" busy={busy} testing={testing} save={save} test={testConnection} t={t} disableTest />}
              >
                <div className="rounded-lg border border-border bg-primary-soft p-3 text-xs leading-relaxed text-text">{t('aiDeferred')}</div>
                <Field label={t('provider')}><Input value={forms.document_ai.provider} onChange={(e) => update('document_ai', 'provider', e.target.value)} dir="ltr" /></Field>
                <Field label={t('endpoint')}><Input value={forms.document_ai.endpoint} onChange={(e) => update('document_ai', 'endpoint', e.target.value)} dir="ltr" /></Field>
                <Field label={t('model')}><Input value={forms.document_ai.model} onChange={(e) => update('document_ai', 'model', e.target.value)} dir="ltr" /></Field>
                <SecretField label={t('apiKey')} masked={String(summaries.document_ai?.configuration.api_key_masked ?? '')} value={forms.document_ai.api_key} onChange={(value) => update('document_ai', 'api_key', value)} />
                <AdminPasswordField value={forms.document_ai.current_password} onChange={(value) => update('document_ai', 'current_password', value)} />
              </SettingsCard>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function RuntimeCard({ runtime, t }: { runtime: RuntimeSummary; t: Translate }) {
  const online = runtime.worker_status === 'online';
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div><CardTitle>{t('runtimeTitle')}</CardTitle><p className="mt-1 text-sm text-muted">{t('runtimeDescription')}</p></div>
        <span className="flex items-center gap-1.5 text-xs text-text">
          {online ? <CheckCircle2 className="h-4 w-4 text-positive" /> : <XCircle className="h-4 w-4 text-negative" />}
          {online ? t('online') : t('offline')}
        </span>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-5">
        <Metric label={t('queueDriver')} value={runtime.queue_connection} />
        <Metric label={t('queued')} value={runtime.queued_runs} />
        <Metric label={t('running')} value={runtime.running_runs} />
        <Metric label={t('failed')} value={runtime.failed_runs} />
        <Metric label={t('lastHeartbeat')} value={runtime.worker_last_seen_at ? new Date(runtime.worker_last_seen_at).toLocaleString(DISPLAY_LOCALE) : t('never')} />
      </CardContent>
    </Card>
  );
}

function SettingsCard({ title, description, icon: Icon, enabled, configuredAt, onEnabled, actions, children }: {
  title: string; description: string; icon: typeof Database; enabled: boolean; configuredAt?: string | null;
  onEnabled: (value: boolean) => void; actions: ReactNode; children: ReactNode;
}) {
  const t = useTranslations('platformIntegrations');
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3"><Icon className="mt-0.5 h-5 w-5 text-muted" strokeWidth={1.7} /><div><CardTitle>{title}</CardTitle><p className="mt-1 text-sm leading-relaxed text-muted">{description}</p></div></div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-text">
            <input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} className="h-4 w-4 accent-primary" />
            {enabled ? t('enabled') : t('disabled')}
          </label>
        </div>
        {configuredAt && <p className="mt-2 text-xs text-muted">{t('configuredAt', { date: new Date(configuredAt).toLocaleString(DISPLAY_LOCALE) })}</p>}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
        <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-border pt-4">{actions}</div>
      </CardContent>
    </Card>
  );
}

function CardActions({ integration, busy, testing, save, test, t, disableTest = false }: {
  integration: IntegrationKey; busy: IntegrationKey | null; testing: IntegrationKey | null;
  save: (key: IntegrationKey) => void; test: (key: IntegrationKey) => void;
  t: Translate; disableTest?: boolean;
}) {
  return <>
    <Button variant="outline" size="sm" onClick={() => test(integration)} disabled={disableTest || testing !== null || busy !== null}>
      {testing === integration ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}{t('test')}
    </Button>
    <Button size="sm" onClick={() => save(integration)} disabled={busy !== null || testing !== null}>
      {busy === integration ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t('save')}
    </Button>
  </>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}

function SecretField({ label, masked, value, onChange }: { label: string; masked: string; value: string; onChange: (value: string) => void }) {
  const t = useTranslations('platformIntegrations');
  return <Field label={label}><Input type="password" autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} dir="ltr" placeholder={masked || t('secretPlaceholder')} /><p className="text-xs text-muted">{t('secretHelp')}</p></Field>;
}

function AdminPasswordField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useTranslations('platformIntegrations');
  return <Field label={t('currentPassword')}><Input type="password" autoComplete="current-password" value={value} onChange={(e) => onChange(e.target.value)} /><p className="text-xs text-muted">{t('currentPasswordHelp')}</p></Field>;
}

function Select({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:ring-2 focus:ring-primary">
    {options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}
  </select>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div><p className="text-xs text-muted">{label}</p><p className="num mt-1 break-all text-sm font-semibold text-text">{value}</p></div>;
}

function hydrateForms(current: Record<IntegrationKey, FormState>, integrations: IntegrationSummary[]): Record<IntegrationKey, FormState> {
  const next = { ...current };
  for (const item of integrations) {
    const configuration = item.configuration;
    next[item.key] = {
      ...current[item.key],
      enabled: item.enabled,
      provider: item.provider ?? current[item.key].provider,
      endpoint: String(configuration.endpoint ?? ''),
      bucket: String(configuration.bucket ?? ''),
      region: String(configuration.region ?? current[item.key].region),
      access_key_id: '',
      secret_access_key: '',
      use_path_style_endpoint: Boolean(configuration.use_path_style_endpoint ?? true),
      host: String(configuration.host ?? ''),
      port: String(configuration.port ?? current[item.key].port),
      timeout_seconds: String(configuration.timeout_seconds ?? current[item.key].timeout_seconds),
      max_attempts: String(configuration.max_attempts ?? current[item.key].max_attempts),
      backoff_seconds: Array.isArray(configuration.backoff_seconds) ? configuration.backoff_seconds.join(',') : current[item.key].backoff_seconds,
      model: String(configuration.model ?? ''),
      api_key: '',
      current_password: '',
    };
  }
  return next;
}
