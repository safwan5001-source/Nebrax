'use client';

import { Children, cloneElement, isValidElement, useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Bot,
  CheckCircle2,
  Database,
  Info,
  Loader2,
  RefreshCw,
  Save,
  ServerCog,
  ShieldCheck,
  TestTube2,
  XCircle,
} from 'lucide-react';
import { formatDateTime } from '@/lib/formatting';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { isPlatformAuthenticated } from '@/lib/platform-auth';
import { platformApi } from '@/lib/platform-api';
import { hydrateAiForm, isGoogleGeminiDirty } from './ai-form';
import { isolateAuto } from './isolate';
import { FileScanExceptions } from './file-scan-exceptions';
import {
  geminiErrorCodeFromUnknown,
  geminiDiagnosticMessage,
  geminiTestNoticeMessage,
} from './gemini-diagnostics';
import {
  AI_PROVIDER_KEYS,
  emptyDocumentAiForm,
  payloadFor,
  type AiProviderKey,
  type AiProviderFormState,
  type DocumentAiFormState,
  type IntegrationFormState,
  type IntegrationKey,
} from './payload';

type CoreIntegrationKey = Exclude<IntegrationKey, 'document_ai'>;
type Translate = (key: any, values?: any) => string;

interface IntegrationSummary {
  key: IntegrationKey;
  provider: string | null;
  enabled: boolean;
  configured: boolean;
  configuration: Record<string, any>;
  configured_at: string | null;
}

interface RuntimeSummary {
  processing_mode?: 'sync' | 'async';
  queue_connection: string;
  queue_configured: boolean;
  worker_required?: boolean;
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

const emptyForm: IntegrationFormState = {
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
  const [forms, setForms] = useState<Record<CoreIntegrationKey, IntegrationFormState>>({
    document_storage: { ...emptyForm, provider: 'r2' },
    malware_scanner: { ...emptyForm, provider: 'clamav_tcp' },
    document_processing: { ...emptyForm, provider: 'redis' },
  });
  const [aiForm, setAiForm] = useState<DocumentAiFormState>(emptyDocumentAiForm());
  const [aiFormSnapshot, setAiFormSnapshot] = useState<DocumentAiFormState>(emptyDocumentAiForm());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await platformApi<OverviewResponse>('/platform/integrations');
      setOverview(response.data);
      setForms((current) => hydrateCoreForms(current, response.data.integrations));
      const ai = response.data.integrations.find((item) => item.key === 'document_ai');
      const nextAiForm = hydrateAiForm(ai);
      setAiForm(nextAiForm);
      setAiFormSnapshot(nextAiForm);
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
  const geminiDirty = useMemo(() => isGoogleGeminiDirty(aiForm, aiFormSnapshot), [aiForm, aiFormSnapshot]);

  function update(key: CoreIntegrationKey, field: keyof IntegrationFormState, value: string | boolean) {
    setForms((current) => ({ ...current, [key]: { ...current[key], [field]: value } }));
  }

  function updateAi(field: keyof Omit<DocumentAiFormState, 'providers'>, value: string | boolean | AiProviderKey[]) {
    setAiForm((current) => ({ ...current, [field]: value }));
  }

  function updateProvider(provider: AiProviderKey, field: keyof DocumentAiFormState['providers'][AiProviderKey], value: string | boolean) {
    setAiForm((current) => ({
      ...current,
      providers: { ...current.providers, [provider]: { ...current.providers[provider], [field]: value } },
    }));
  }

  async function save(key: CoreIntegrationKey) {
    setBusy(key);
    setNotice(null);
    try {
      const response = await platformApi<OverviewResponse>(`/platform/integrations/${key}`, {
        method: 'PUT',
        body: payloadFor(key, forms[key]),
      });
      setOverview(response.data);
      setForms((current) => hydrateCoreForms(current, response.data.integrations));
      setNotice({ ok: true, message: t('saved') });
    } catch (reason) {
      setNotice({ ok: false, message: reason instanceof ApiError ? reason.message : t('saveFailed') });
    } finally {
      setBusy(null);
    }
  }

  async function saveAi() {
    setBusy('document_ai');
    setNotice(null);
    try {
      const response = await platformApi<OverviewResponse>('/platform/integrations/document_ai', {
        method: 'PUT',
        body: payloadFor('document_ai', aiForm),
      });
      setOverview(response.data);
      const nextAiForm = hydrateAiForm(response.data.integrations.find((item) => item.key === 'document_ai'));
      setAiForm(nextAiForm);
      setAiFormSnapshot(nextAiForm);
      setNotice({ ok: true, message: t('savedSuccessfully') });
    } catch (reason) {
      setNotice({ ok: false, message: reason instanceof ApiError ? reason.message : t('saveFailed') });
    } finally {
      setBusy(null);
    }
  }

  async function testConnection(key: CoreIntegrationKey) {
    setTesting(key);
    setNotice(null);
    try {
      const response = await platformApi<{ data: ConnectionTestResult }>(`/platform/integrations/${key}/test`, { method: 'POST' });
      // الاستجابات التي بلا `target` (خوادم أقدم، أو غير التخزين) تُعرض كما كانت: ok والرسالة. لا يُستنتج الهدف من واجهة محلية.
      setNotice(key === 'document_storage' && response.data.target ? storageTestNotice(response.data, t) : response.data);
      await load();
    } catch (reason) {
      setNotice({ ok: false, message: reason instanceof ApiError ? reason.message : t('testFailed') });
    } finally {
      setTesting(null);
    }
  }

  async function testAiProvider(provider: AiProviderKey) {
    if (provider === 'google_gemini' && isGoogleGeminiDirty(aiForm, aiFormSnapshot)) {
      setNotice({ ok: false, message: t('saveBeforeTest') });
      return;
    }
    setTesting(`ai:${provider}`);
    setNotice(null);
    try {
      const response = await platformApi<{ data: { ok: boolean; message: string; error_code?: string | null } }>('/platform/integrations/document_ai/test', {
        method: 'POST',
        body: { provider },
      });
      setNotice({
        ok: response.data.ok,
        message: provider === 'google_gemini'
          ? geminiTestNoticeMessage(response.data.ok, response.data.error_code, t)
          : response.data.message,
      });
      try {
        const overviewResponse = await platformApi<OverviewResponse>('/platform/integrations');
        setOverview(overviewResponse.data);
      } catch {
        // Keep the current form; last-test metadata may stay stale until an explicit refresh.
      }
    } catch (reason) {
      setNotice({
        ok: false,
        message: provider === 'google_gemini'
          ? geminiDiagnosticMessage(geminiErrorCodeFromUnknown(reason), t)
          : (reason instanceof ApiError ? reason.message : t('testFailed')),
      });
    } finally {
      setTesting(null);
    }
  }

  if (loading && !overview) {
    return <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8" aria-busy="true"><Skeleton className="h-[42rem] w-full" /></main>;
  }

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 lg:px-8" aria-busy={loading}>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <ServerCog className="mt-0.5 h-6 w-6 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-primary">{t('eyebrow')}</p>
            <h1 className="mt-0.5 text-xl font-semibold text-text">{t('title')}</h1>
            <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{t('statusNote')}</p>
          </div>
        </div>
        <Button variant="outline" className="h-11 w-full shrink-0 sm:w-auto" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.7} aria-hidden="true" />{t('refresh')}
        </Button>
      </header>

      {notice && <Notice notice={notice} />}
      {error && (
        <Card>
          <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5">
            <p className="min-w-0 flex-1 text-sm text-negative" role="alert">{error}</p>
            <Button variant="outline" className="h-11" onClick={load}>{t('retry')}</Button>
          </CardContent>
        </Card>
      )}
      {overview && <>
          <RuntimeCard runtime={overview.runtime} t={t} />
          <section aria-labelledby="core-integrations">
          <h2 id="core-integrations" className="sr-only">{t('coreTitle')}</h2>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <SettingsCard title={t('storageTitle')} description={t('storageDescription')} icon={Database} enabled={forms.document_storage.enabled} summary={summaries.document_storage} onEnabled={(value) => update('document_storage', 'enabled', value)} actions={<CardActions name="document_storage" busy={busy} testing={testing} save={() => save('document_storage')} test={() => testConnection('document_storage')} t={t} />}>
              <Field label={t('provider')}><Select value={forms.document_storage.provider} onChange={(value) => update('document_storage', 'provider', value)} options={[["r2", 'Cloudflare R2'], ['s3', 'Amazon S3'], ['s3_compatible', 'S3 Compatible']]} /></Field>
              <Field label={t('endpoint')}><Input className="h-11" value={forms.document_storage.endpoint} onChange={(event) => update('document_storage', 'endpoint', event.target.value)} dir="ltr" /></Field>
              <Field label={t('bucket')}><Input className="h-11" value={forms.document_storage.bucket} onChange={(event) => update('document_storage', 'bucket', event.target.value)} dir="ltr" /></Field>
              <Field label={t('region')}><Input className="h-11" value={forms.document_storage.region} onChange={(event) => update('document_storage', 'region', event.target.value)} dir="ltr" /></Field>
              <SecretField label={t('accessKey')} masked={String(summaries.document_storage?.configuration.access_key_id_masked ?? '')} value={forms.document_storage.access_key_id} onChange={(value) => update('document_storage', 'access_key_id', value)} />
              <SecretField label={t('secretKey')} masked={String(summaries.document_storage?.configuration.secret_access_key_masked ?? '')} value={forms.document_storage.secret_access_key} onChange={(value) => update('document_storage', 'secret_access_key', value)} />
              <AdminPasswordField value={forms.document_storage.current_password} onChange={(value) => update('document_storage', 'current_password', value)} />
            </SettingsCard>

            <SettingsCard title={t('scannerTitle')} description={t('scannerDescription')} icon={ShieldCheck} enabled={forms.malware_scanner.enabled} summary={summaries.malware_scanner} onEnabled={(value) => update('malware_scanner', 'enabled', value)} actions={<CardActions name="malware_scanner" busy={busy} testing={testing} save={() => save('malware_scanner')} test={() => testConnection('malware_scanner')} t={t} />}>
              <Field label={t('provider')}><Select value={forms.malware_scanner.provider} onChange={(value) => update('malware_scanner', 'provider', value)} options={[["clamav_tcp", 'ClamAV TCP']]} /></Field>
              <Field label={t('host')}><Input className="h-11" value={forms.malware_scanner.host} onChange={(event) => update('malware_scanner', 'host', event.target.value)} dir="ltr" /></Field>
              <Field label={t('port')}><Input className="h-11" type="number" value={forms.malware_scanner.port} onChange={(event) => update('malware_scanner', 'port', event.target.value)} dir="ltr" /></Field>
              <Field label={t('timeout')}><Input className="h-11" type="number" value={forms.malware_scanner.timeout_seconds} onChange={(event) => update('malware_scanner', 'timeout_seconds', event.target.value)} dir="ltr" /></Field>
              <AdminPasswordField value={forms.malware_scanner.current_password} onChange={(value) => update('malware_scanner', 'current_password', value)} />
            </SettingsCard>

            <FileScanExceptions />
            <SettingsCard title={t('processingTitle')} description={t('processingDescription')} icon={ServerCog} className="xl:col-span-2" enabled={forms.document_processing.enabled} summary={summaries.document_processing} onEnabled={(value) => update('document_processing', 'enabled', value)} actions={<CardActions name="document_processing" busy={busy} testing={testing} save={() => save('document_processing')} test={() => testConnection('document_processing')} t={t} />}>
              <p className="sm:col-span-2 text-xs leading-relaxed text-muted">{aiForm.processing_mode === 'sync' ? t('processingPolicyAsyncOnly') : t('processingPolicyApplies')}</p>
              <Field label={t('maxAttempts')}><Input className="h-11" type="number" min={1} max={5} value={forms.document_processing.max_attempts} onChange={(event) => update('document_processing', 'max_attempts', event.target.value)} dir="ltr" /></Field>
              <Field label={t('timeout')}><Input className="h-11" type="number" min={10} max={120} value={forms.document_processing.timeout_seconds} onChange={(event) => update('document_processing', 'timeout_seconds', event.target.value)} dir="ltr" /></Field>
              <Field label={t('backoff')}><Input className="h-11" value={forms.document_processing.backoff_seconds} onChange={(event) => update('document_processing', 'backoff_seconds', event.target.value)} dir="ltr" placeholder="30,120,300" /></Field>
              <AdminPasswordField value={forms.document_processing.current_password} onChange={(value) => update('document_processing', 'current_password', value)} />
            </SettingsCard>
          </div>
          </section>

          <section aria-labelledby="ai-provider-settings" className="space-y-5">
            <div><p className="text-xs font-semibold text-primary">{t('aiEyebrow')}</p><h2 id="ai-provider-settings" className="mt-1 text-lg font-semibold text-text">{t('aiTitle')}</h2><p className="mt-1 text-sm text-muted">{t('aiDescription')}</p></div>
            <DisabledNotice t={t} />
            <Card>
              <CardHeader><div className="flex items-start gap-3"><Bot className="mt-0.5 h-5 w-5 text-muted" strokeWidth={1.7} aria-hidden="true" /><div><CardTitle>{t('aiEngineTitle')}</CardTitle><p className="mt-1 text-sm leading-relaxed text-muted">{t('aiEngineDescription')}</p></div></div></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3 rounded-lg border border-border p-4">
                  <div>
                    <p className="text-sm font-medium text-text">{t('processingMode')}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{t('processingModeDescription')}</p>
                  </div>
                  <fieldset className="grid gap-3 md:grid-cols-2">
                    <legend className="sr-only">{t('processingMode')}</legend>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface p-3 text-sm text-text">
                      <input type="radio" name="document-extraction-processing-mode" className="mt-1 h-4 w-4 accent-primary" checked={aiForm.processing_mode === 'sync'} onChange={() => updateAi('processing_mode', 'sync')} />
                      <span>
                        <span className="font-medium">{t('processingModeSync')}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted">{t('processingModeSyncHelp')}</span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface p-3 text-sm text-text">
                      <input type="radio" name="document-extraction-processing-mode" className="mt-1 h-4 w-4 accent-primary" checked={aiForm.processing_mode !== 'sync'} onChange={() => updateAi('processing_mode', 'async')} />
                      <span>
                        <span className="font-medium">{t('processingModeAsync')}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted">{t('processingModeAsyncHelp')}</span>
                      </span>
                    </label>
                  </fieldset>
                  {aiForm.processing_mode === 'sync' ? <p className="text-xs leading-relaxed text-muted">{t('processingModeSyncTimeoutNote')}</p> : null}
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <ToggleField label={t('aiEngineEnabled')} checked={aiForm.enabled} onChange={(value) => updateAi('enabled', value)} />
                  <Field label={t('primaryProvider')}><Select value={aiForm.primary_provider} onChange={(value) => updateAi('primary_provider', value as AiProviderKey | '')} options={[["", t('noProvider')] as [string, string], ...AI_PROVIDER_KEYS.map((provider): [string, string] => [provider, providerLabel(provider, t)])]} /></Field>
                  <ToggleField label={t('fallbackEnabled')} checked={aiForm.fallback_enabled} onChange={(value) => updateAi('fallback_enabled', value)} />
                  <Field label={t('fallbackFirst')}><Select value={aiForm.fallback_providers[0] ?? ''} onChange={(value) => updateAi('fallback_providers', replaceFallback(aiForm.fallback_providers, 0, value as AiProviderKey | ''))} options={[["", t('noProvider')] as [string, string], ...AI_PROVIDER_KEYS.map((provider): [string, string] => [provider, providerLabel(provider, t)])]} /></Field>
                  <Field label={t('fallbackSecond')}><Select value={aiForm.fallback_providers[1] ?? ''} onChange={(value) => updateAi('fallback_providers', replaceFallback(aiForm.fallback_providers, 1, value as AiProviderKey | ''))} options={[["", t('noProvider')] as [string, string], ...AI_PROVIDER_KEYS.map((provider): [string, string] => [provider, providerLabel(provider, t)])]} /></Field>
                  <Field label={t('confidenceThreshold')}><Input className="h-11" type="number" min={0} max={100} value={aiForm.confidence_threshold_percent} onChange={(event) => updateAi('confidence_threshold_percent', event.target.value)} dir="ltr" /></Field>
                  <Field label={t('defaultLanguage')}><Input className="h-11" value={aiForm.default_language} onChange={(event) => updateAi('default_language', event.target.value)} dir="ltr" /></Field>
                  <Field label={t('maxFiles')}><Input className="h-11" type="number" min={1} max={100} value={aiForm.max_files_per_batch} onChange={(event) => updateAi('max_files_per_batch', event.target.value)} dir="ltr" /></Field>
                  <Field label={t('maxPages')}><Input className="h-11" type="number" min={1} max={1000} value={aiForm.max_pages_per_file} onChange={(event) => updateAi('max_pages_per_file', event.target.value)} dir="ltr" /></Field>
                  <Field label={t('maxFileSize')}><Input className="h-11" type="number" min={1} max={52428800} value={aiForm.max_file_size_bytes} onChange={(event) => updateAi('max_file_size_bytes', event.target.value)} dir="ltr" /></Field>
                  <ToggleField label={t('testMode')} checked={aiForm.test_mode} onChange={(value) => updateAi('test_mode', value)} />
                  <AdminPasswordField value={aiForm.current_password} onChange={(value) => updateAi('current_password', value)} />
                </div>
                <div className="flex justify-end border-t border-border pt-4"><Button size="sm" wrap className="min-h-11" onClick={saveAi} disabled={busy !== null || testing !== null}>{busy === 'document_ai' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t('save')}</Button></div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[repeat(auto-fit,minmax(min(100%,19rem),1fr))]">
              {AI_PROVIDER_KEYS.map((provider) => (
                <AiProviderCard
                  key={provider}
                  provider={provider}
                  form={aiForm.providers[provider]}
                  configuration={summaries.document_ai?.configuration.providers?.[provider] ?? {}}
                  busy={busy}
                  testing={testing}
                  update={(field, value) => updateProvider(provider, field, value)}
                  test={() => testAiProvider(provider)}
                  t={t}
                  onSave={provider === 'google_gemini' ? saveAi : undefined}
                  currentPassword={provider === 'google_gemini' ? aiForm.current_password : undefined}
                  onCurrentPasswordChange={provider === 'google_gemini' ? (value) => updateAi('current_password', value) : undefined}
                  testBlocked={provider === 'google_gemini' && geminiDirty}
                  testBlockedReason={provider === 'google_gemini' && geminiDirty ? t('saveBeforeTest') : undefined}
                />
              ))}
            </div>
          </section>
      </>}
    </main>
  );
}

function DisabledNotice({ t }: { t: Translate }) {
  return <div className="rounded-lg border border-warning/40 bg-surface p-4 text-sm leading-relaxed text-text" role="note">{t('aiDisabledNotice')}</div>;
}

type NoticeState = { ok: boolean; message: string; tone?: 'info'; detail?: string };

/** ما يعيده الخادم لاختبار الاتصال. `target` و`operational_storage` للتخزين فقط، وقد يغيبان في الاستجابات القديمة. */
type ConnectionTestResult = { ok: boolean; message: string; target?: string; operational_storage?: string };

/**
 * نتيجة اختبار التخزين بحسب **الهدف الذي أكّده الخادم**: اختبار القرص المحلي البديل ليس إثباتاً لاتصال R2/S3 ولو نجح،
 * فيُعرض بنبرة معلوماتية. ومكان تخزين المستندات الآن (`operational_storage`) سطرٌ منفصل: نجاح اختبار المزود لا يعني أن
 * المستندات تُكتب عليه. النصوص من ملفات الترجمة لا من رسالة الخادم العربية.
 */
function storageTestNotice(result: ConnectionTestResult, t: Translate): NoticeState {
  const detail = result.operational_storage === 'local' ? t('storageOperationalLocal') : result.operational_storage === 'external' ? t('storageOperationalExternal') : undefined;
  if (result.target === 'local_fallback') {
    return result.ok ? { ok: true, tone: 'info', message: t('storageTestLocalOnly'), detail } : { ok: false, message: t('storageTestLocalFailed'), detail };
  }
  if (result.target === 'saved_provider') {
    return { ok: result.ok, message: result.ok ? t('storageTestProviderOk') : t('storageTestProviderFailed'), detail };
  }
  // هدف آخر (تخزين مضبوط في بيئة التشغيل): لا يُسمّى مزوداً محفوظاً.
  return result.ok ? { ok: true, tone: 'info', message: t('storageTestEnvironment'), detail } : { ok: false, message: t('storageTestEnvironmentFailed'), detail };
}

function Notice({ notice }: { notice: NoticeState }) {
  // النجاح حالة (status) والفشل تنبيه (alert) بنبرة سلبية؛ لا يُنسخ أي سرّ إلى الرسالة. النبرة المعلوماتية حالة محايدة لا علامة نجاح.
  const info = notice.tone === 'info';
  const Icon = info ? Info : notice.ok ? CheckCircle2 : XCircle;
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border bg-surface p-3 text-sm ${info ? 'border-warning/40' : notice.ok ? 'border-border' : 'border-negative/40'}`}
      role={notice.ok ? 'status' : 'alert'}
      aria-atomic="true"
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${info ? 'text-warning' : notice.ok ? 'text-positive' : 'text-negative'}`} strokeWidth={1.7} aria-hidden="true" />
      <span className={`min-w-0 break-words ${notice.ok ? 'text-text' : 'text-negative'}`}>
        {notice.message}
        {notice.detail && <span className="mt-1 block text-xs text-muted">{notice.detail}</span>}
      </span>
    </div>
  );
}

function RuntimeCard({ runtime, t }: { runtime: RuntimeSummary; t: Translate }) {
  const mode = runtime.processing_mode === 'sync' ? 'sync' : 'async';
  const workerRequired = runtime.worker_required !== false && mode === 'async';
  const workerHealthy = !workerRequired || runtime.worker_status === 'online';
  const workerLabel = !workerRequired ? t('workerNotRequired') : (runtime.worker_status === 'online' ? t('online') : t('offline'));
  return <Card><CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4"><div><CardTitle>{t('runtimeTitle')}</CardTitle><p className="mt-1 text-sm text-muted">{t('runtimeDescription')}</p></div><span className="flex items-center gap-1.5 text-xs text-text">{workerHealthy ? <CheckCircle2 className="h-4 w-4 text-positive" /> : <XCircle className="h-4 w-4 text-negative" />}{workerLabel}</span></CardHeader><CardContent className="grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-3 lg:grid-cols-6"><Metric label={t('processingMode')} value={mode === 'sync' ? t('processingModeSync') : t('processingModeAsync')} /><Metric label={t('queueWorker')} value={workerLabel} /><Metric label={t('queueDriver')} value={runtime.queue_connection} /><Metric label={t('queued')} value={runtime.queued_runs} /><Metric label={t('running')} value={runtime.running_runs} /><Metric label={t('failed')} value={runtime.failed_runs} /></CardContent></Card>;
}

function SettingsCard({
  title,
  description,
  icon: Icon,
  enabled,
  summary,
  onEnabled,
  actions,
  children,
  className = '',
}: {
  title: string;
  description: string;
  icon: typeof Database;
  enabled: boolean;
  summary?: IntegrationSummary;
  onEnabled: (value: boolean) => void;
  actions: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations('platformIntegrations');
  const locale = useLocale();
  const configuredAt = summary?.configured_at;
  // الحالة من الإعدادات المحفوظة فقط (configured/enabled من الـ API)؛ لا حالة «متصل» مختلقة.
  const savedEnabled = summary?.enabled ?? false;
  const statusKey = !summary?.configured ? 'statusNotConfigured' : savedEnabled ? 'statusEnabled' : 'statusSavedDisabled';
  const statusTone = !summary?.configured ? 'muted' : savedEnabled ? 'positive' : 'warning';
  const pendingChange = enabled !== savedEnabled;
  return (
    <Card className={`flex h-full flex-col ${className}`}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted" strokeWidth={1.7} aria-hidden="true" />
            <div className="min-w-0">
              <CardTitle>{title}</CardTitle>
              <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
            </div>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-text">
            <input type="checkbox" checked={enabled} onChange={(event) => onEnabled(event.target.checked)} className="h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-primary/40" />
            {enabled ? t('enabled') : t('disabled')}
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge wrap tone={statusTone}>{t(statusKey)}</Badge>
          {configuredAt && <p className="text-xs text-muted">{t('configuredAt', { date: isolateAuto(formatDateTime(configuredAt, locale)) })}</p>}
        </div>
        {pendingChange && <p className="mt-2 text-xs leading-relaxed text-warning" role="note">{enabled ? t('pendingEnable') : t('pendingDisable')}</p>}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
        <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-border pt-4">{actions}</div>
      </CardContent>
    </Card>
  );
}

function AiProviderCard({
  provider,
  form,
  configuration,
  busy,
  testing,
  update,
  test,
  t,
  onSave,
  currentPassword,
  onCurrentPasswordChange,
  testBlocked,
  testBlockedReason,
}: {
  provider: AiProviderKey;
  form: DocumentAiFormState['providers'][AiProviderKey];
  configuration: Record<string, any>;
  busy: string | null;
  testing: string | null;
  update: (field: keyof AiProviderFormState, value: string | boolean) => void;
  test: () => void;
  t: Translate;
  onSave?: () => void;
  currentPassword?: string;
  onCurrentPasswordChange?: (value: string) => void;
  testBlocked?: boolean;
  testBlockedReason?: string;
}) {
  const locale = useLocale();
  const testedAt = typeof configuration.last_tested_at === 'string' ? formatDateTime(configuration.last_tested_at, locale) : null;
  const testStatus = String(configuration.last_test_status ?? 'not_tested');
  const lastErrorCode = typeof configuration.last_test_error_code === 'string' ? configuration.last_test_error_code : null;
  // مؤشرات من حقول الـ API الموجودة فقط: وجود مفتاح محفوظ (مقنَّع) والحالة المحفوظة للتفعيل.
  const keyStored = Boolean(configuration.has_api_key || configuration.api_key_masked);
  const savedEnabled = Boolean(configuration.enabled);
  const geminiActions = onSave !== undefined;
  const testDisabled = geminiActions
    ? busy !== null || testing !== null || Boolean(testBlocked)
    : busy !== null || testing !== null;
  const hintId = geminiActions ? 'gemini-save-before-test' : undefined;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <CardTitle>{providerLabel(provider, t)}</CardTitle>
            <p className="mt-1 text-sm text-muted">{t('aiProviderDescription')}</p>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-text">
            <input type="checkbox" checked={form.enabled} onChange={(event) => update('enabled', event.target.checked)} className="h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-primary/40" />
            {form.enabled ? t('enabled') : t('disabled')}
          </label>
        </div>
        <p className={`mt-2 flex items-start gap-1.5 text-xs ${testStatus === 'failed' ? 'text-negative' : testStatus === 'passed' ? 'text-positive' : 'text-muted'}`}>
          {testStatus === 'passed' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.7} aria-hidden="true" /> : testStatus === 'failed' ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.7} aria-hidden="true" /> : null}
          <span>
            {t('lastTest')}: {testStatus === 'passed' ? t('testPassed') : testStatus === 'failed' ? t('testFailedStatus') : t('notTested')}
            {testedAt ? <> · <bdi>{testedAt}</bdi></> : null}
          </span>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge wrap tone={keyStored ? 'neutral' : 'muted'}>{keyStored ? t('keyStored') : t('keyNotStored')}</Badge>
        </div>
        {form.enabled !== savedEnabled ? <p className="mt-2 text-xs leading-relaxed text-warning" role="note">{form.enabled ? t('pendingEnable') : t('pendingDisable')}</p> : null}
        {provider === 'google_gemini' && testStatus === 'failed' && lastErrorCode ? (
          <p className="mt-1 text-xs text-negative" role="status">{geminiDiagnosticMessage(lastErrorCode, t)}</p>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="space-y-4">
          <Field label={t('model')}><Input className="h-11" value={form.model} onChange={(event) => update('model', event.target.value)} dir="ltr" /></Field>
          <SecretField label={t('apiKey')} masked={String(configuration.api_key_masked ?? '')} value={form.api_key} onChange={(value) => update('api_key', value)} />
          <ToggleField label={t('clearApiKey')} checked={form.clear_api_key} onChange={(value) => update('clear_api_key', value)} />
          <ToggleField label={t('allowDocumentSending')} checked={form.allow_document_sending} onChange={(value) => update('allow_document_sending', value)} />
          <Field label={t('connectionTimeout')}><Input className="h-11" type="number" min={5} max={60} value={form.connection_timeout_seconds} onChange={(event) => update('connection_timeout_seconds', event.target.value)} dir="ltr" /></Field>
          <Field label={t('processingTimeout')}><Input className="h-11" type="number" min={15} max={180} value={form.processing_timeout_seconds} onChange={(event) => update('processing_timeout_seconds', event.target.value)} dir="ltr" /></Field>
          <Field label={t('maxAttempts')}><Input className="h-11" type="number" min={1} max={5} value={form.max_attempts} onChange={(event) => update('max_attempts', event.target.value)} dir="ltr" /></Field>
          <Field label={t('monthlyOperationLimit')}><Input className="h-11" type="number" min={1} value={form.monthly_operation_limit} onChange={(event) => update('monthly_operation_limit', event.target.value)} dir="ltr" /></Field>
          <Field label={t('monthlyPageLimit')}><Input className="h-11" type="number" min={1} value={form.monthly_page_limit} onChange={(event) => update('monthly_page_limit', event.target.value)} dir="ltr" /></Field>
          <Field label={t('dataRegion')}><Input className="h-11" value={form.data_region} onChange={(event) => update('data_region', event.target.value)} dir="ltr" /></Field>
          <Field label={t('retentionPolicy')}><Input className="h-11" value={form.retention_policy} onChange={(event) => update('retention_policy', event.target.value)} /></Field>
          {geminiActions && onCurrentPasswordChange ? <AdminPasswordField value={currentPassword ?? ''} onChange={onCurrentPasswordChange} /> : null}
        </div>
        <div className="mt-auto space-y-3 border-t border-border pt-4">
          {testBlockedReason ? <p id={hintId} className="text-xs leading-relaxed text-muted" role="status">{testBlockedReason}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              wrap
              className="min-h-11"
              onClick={test}
              disabled={testDisabled}
              title={testBlockedReason}
              aria-describedby={testBlocked ? hintId : undefined}
            >
              {testing === `ai:${provider}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}
              {testing === `ai:${provider}` && geminiActions ? t('testing') : geminiActions ? t('testConnection') : t('test')}
            </Button>
            {onSave ? (
              <Button size="sm" wrap className="min-h-11" onClick={onSave} disabled={busy !== null || testing !== null}>
                {busy === 'document_ai' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {busy === 'document_ai' ? t('saving') : t('saveSettings')}
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CardActions({ name, busy, testing, save, test, t }: { name: string; busy: string | null; testing: string | null; save: () => void; test: () => void; t: Translate }) { return <><Button variant="outline" size="sm" wrap className="min-h-11" onClick={test} disabled={testing !== null || busy !== null}>{testing === name ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}{t('test')}</Button><Button size="sm" wrap className="min-h-11" onClick={save} disabled={busy !== null || testing !== null}>{busy === name ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t('save')}</Button></>; }
// The visible label is tied to its control with a generated id, so assistive technology announces a name for it (WCAG 1.3.1, 4.1.2).
// The first element child is the control; any following element is help text.
function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  let tagged = false;
  const content = Children.map(children, (child) => {
    if (tagged || !isValidElement<{ id?: string }>(child)) return child;
    tagged = true;
    return cloneElement(child, { id });
  });
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>{content}</div>;
}
function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 text-sm text-text"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-primary/40" /></label>; }
function SecretField({ label, masked, value, onChange }: { label: string; masked: string; value: string; onChange: (value: string) => void }) { const t = useTranslations('platformIntegrations'); return <Field label={label}><Input className="h-11" type="password" autoComplete="new-password" value={value} onChange={(event) => onChange(event.target.value)} dir="ltr" placeholder={masked || t('secretPlaceholder')} /><p className="text-xs text-muted">{t('secretHelp')}</p></Field>; }
function AdminPasswordField({ value, onChange }: { value: string; onChange: (value: string) => void }) { const t = useTranslations('platformIntegrations'); return <Field label={t('currentPassword')}><Input className="h-11" type="password" autoComplete="current-password" value={value} onChange={(event) => onChange(event.target.value)} /><p className="text-xs text-muted">{t('currentPasswordHelp')}</p></Field>; }
function Select({ id, value, onChange, options }: { id?: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) { return <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}</select>; }
function Metric({ label, value }: { label: string; value: string | number }) { return <div><p className="text-xs text-muted">{label}</p><p className="num mt-1 break-all text-sm font-semibold text-text">{value}</p></div>; }

function hydrateCoreForms(current: Record<CoreIntegrationKey, IntegrationFormState>, integrations: IntegrationSummary[]): Record<CoreIntegrationKey, IntegrationFormState> { const next = { ...current }; for (const item of integrations.filter((candidate): candidate is IntegrationSummary & { key: CoreIntegrationKey } => candidate.key !== 'document_ai')) { const configuration = item.configuration; next[item.key] = { ...current[item.key], enabled: item.enabled, provider: item.provider ?? current[item.key].provider, endpoint: String(configuration.endpoint ?? ''), bucket: String(configuration.bucket ?? ''), region: String(configuration.region ?? current[item.key].region), access_key_id: '', secret_access_key: '', use_path_style_endpoint: Boolean(configuration.use_path_style_endpoint ?? true), host: String(configuration.host ?? ''), port: String(configuration.port ?? current[item.key].port), timeout_seconds: String(configuration.timeout_seconds ?? current[item.key].timeout_seconds), max_attempts: String(configuration.max_attempts ?? current[item.key].max_attempts), backoff_seconds: Array.isArray(configuration.backoff_seconds) ? configuration.backoff_seconds.join(',') : current[item.key].backoff_seconds, model: '', api_key: '', current_password: '' }; } return next; }
function replaceFallback(current: AiProviderKey[], index: number, value: AiProviderKey | ''): AiProviderKey[] { const next = [...current]; if (value === '') next.splice(index, 1); else next[index] = value; return next.filter((provider, position, providers) => providers.indexOf(provider) === position).slice(0, 2); }
function providerLabel(provider: AiProviderKey, t: Translate): string { return t(provider === 'openai' ? 'providerOpenai' : provider === 'anthropic' ? 'providerAnthropic' : 'providerGoogleGemini'); }
