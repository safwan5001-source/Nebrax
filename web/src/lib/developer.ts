/**
 * عميل الواجهة لسطح **إدارة المطوّرين الداخلي** (`/api/developer/*`, أُضيف في PR-7.5).
 *
 * هذا ليس الـ Public API؛ إنه سطح إدارة داخليّ يُصادَق بجلسة أَوْج نفسها (Bearer توكن
 * الجلسة عبر `api()`), معزول بالمستأجر ومحروس بصلاحيتَي `developer.view`/`developer.manage`.
 * لا يمرّ أيّ مفتاح Public API عبر المتصفّح لإدارة الموارد — البوابة تستخدم جلسة المستخدم.
 *
 * الأنواع تعكس موارد الخادم حرفيّاً (`DeveloperApiClientResource` / `DeveloperApiKeyResource`
 * / `PublicWebhookResource` / `DeveloperWebhookDeliveryResource`). **لا سرّ ولا تجزئة** في
 * أي قراءة؛ السرّ الخام يعود مرّة واحدة فقط في استجابة الإنشاء/التدوير.
 */
import { api } from './api';
import { OPENAPI_MODEL } from '@/modules/developer/docs/openapi-model.generated';

// ── الأنواع (مطابقة لموارد الخادم) ─────────────────────────────────────────

/** بيانات مفتاح Public API الآمنة — بلا تجزئة ولا نصّ صريح. */
export interface DeveloperApiKey {
  id: number;
  name: string | null;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string | null;
}

export interface DeveloperApiClient {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
  keys: DeveloperApiKey[];
}

/** استجابة إصدار مفتاح: السرّ الخام مفصولٌ ويُعرَض **مرّة واحدة**. */
export interface IssuedKey {
  secret: string;
  key: DeveloperApiKey;
  client: DeveloperApiClient;
}

export type WebhookStatus = 'enabled' | 'disabled';

export interface DeveloperWebhook {
  id: string;
  api_client_id: string | null;
  url: string;
  description: string | null;
  event_types: string[];
  status: WebhookStatus;
  secret_prefix: string | null;
  disabled_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** استجابة إنشاء/تدوير اشتراك: السرّ الخام يُعرَض **مرّة واحدة**. */
export interface WebhookWithSecret {
  secret: string;
  webhook: DeveloperWebhook;
}

export type DeliveryStatus = 'pending' | 'processing' | 'delivered' | 'retry_scheduled' | 'failed';

export const DELIVERY_STATUSES: DeliveryStatus[] = ['pending', 'processing', 'delivered', 'retry_scheduled', 'failed'];

/** تسليم Webhook — بيانات تشغيلية آمنة فقط (لا سرّ ولا حمولة ولا مقتطف استجابة). */
export interface DeveloperDelivery {
  id: string;
  event_id: string;
  endpoint_id: string;
  event_type: string | null;
  endpoint_url: string | null;
  status: DeliveryStatus;
  attempts: number;
  http_status: number | null;
  error: string | null;
  duration_ms: number | null;
  next_attempt_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  created_at: string | null;
}

export interface Paginated<T> {
  data: T[];
  meta: { current_page: number; last_page: number; per_page: number; total: number; from: number | null; to: number | null };
}

// ── الكتالوجات المشتقّة من العقد (مصدر واحد: النموذج المولَّد) ───────────────

/** كل النطاقات التي يقبلها الخادم لإصدار المفاتيح — من عمليّات العقد (`x-required-scope`). */
export const API_SCOPES: string[] = OPENAPI_MODEL.scopes;

/** كتالوج أحداث الـ Webhooks — من مخطّط `WebhookEventType` في العقد. */
export const WEBHOOK_EVENTS: string[] = OPENAPI_MODEL.events;

/** يفكّ نصّ نطاق `resource:action` إلى جزأيه (للتجميع والعرض). */
export function parseScope(scope: string): { resource: string; action: string } {
  const [resource, action = ''] = scope.split(':');
  return { resource, action };
}

// ── طلبات الإدخال ──────────────────────────────────────────────────────────

export interface CreateApiClientInput {
  name: string;
  scopes: string[];
  expires_in_days?: number | null;
}

export interface IssueApiKeyInput {
  name?: string | null;
  scopes: string[];
  expires_in_days?: number | null;
}

export interface CreateWebhookInput {
  url: string;
  event_types: string[];
  description?: string | null;
}

export interface UpdateWebhookInput {
  url?: string;
  event_types?: string[];
  description?: string | null;
  status?: WebhookStatus;
}

export interface DeliveryFilters {
  webhook_endpoint_id?: string;
  event_type?: string;
  status?: DeliveryStatus;
  date_from?: string;
  date_to?: string;
  per_page?: number;
  page?: number;
}

// ── عملاء Public API ومفاتيحها ──────────────────────────────────────────────

export async function listApiClients(): Promise<DeveloperApiClient[]> {
  const res = await api<{ data: DeveloperApiClient[] }>('/developer/api-clients');
  return res.data;
}

export async function getApiClient(id: string): Promise<DeveloperApiClient> {
  const res = await api<{ data: DeveloperApiClient }>(`/developer/api-clients/${id}`);
  return res.data;
}

export function createApiClient(body: CreateApiClientInput): Promise<IssuedKey> {
  return api<IssuedKey>('/developer/api-clients', { method: 'POST', body });
}

export function issueApiKey(clientId: string, body: IssueApiKeyInput): Promise<IssuedKey> {
  return api<IssuedKey>(`/developer/api-clients/${clientId}/keys`, { method: 'POST', body });
}

export function revokeApiKey(clientId: string, tokenId: number): Promise<{ message: string }> {
  return api<{ message: string }>(`/developer/api-clients/${clientId}/keys/${tokenId}`, { method: 'DELETE' });
}

export async function deactivateApiClient(id: string): Promise<DeveloperApiClient> {
  const res = await api<{ data: DeveloperApiClient }>(`/developer/api-clients/${id}/deactivate`, { method: 'POST' });
  return res.data;
}

// ── اشتراكات الـ Webhooks ────────────────────────────────────────────────────

export async function listWebhooks(): Promise<DeveloperWebhook[]> {
  const res = await api<{ data: DeveloperWebhook[] }>('/developer/webhooks');
  return res.data;
}

export async function getWebhook(id: string): Promise<DeveloperWebhook> {
  const res = await api<{ data: DeveloperWebhook }>(`/developer/webhooks/${id}`);
  return res.data;
}

export function createWebhook(body: CreateWebhookInput): Promise<WebhookWithSecret> {
  return api<WebhookWithSecret>('/developer/webhooks', { method: 'POST', body });
}

export async function updateWebhook(id: string, body: UpdateWebhookInput): Promise<DeveloperWebhook> {
  const res = await api<{ data: DeveloperWebhook }>(`/developer/webhooks/${id}`, { method: 'PATCH', body });
  return res.data;
}

export function deleteWebhook(id: string): Promise<{ message: string }> {
  return api<{ message: string }>(`/developer/webhooks/${id}`, { method: 'DELETE' });
}

export function rotateWebhookSecret(id: string): Promise<WebhookWithSecret> {
  return api<WebhookWithSecret>(`/developer/webhooks/${id}/rotate-secret`, { method: 'POST' });
}

// ── سجلّ التسليم (قراءة فقط) ─────────────────────────────────────────────────

export function listDeliveries(filters: DeliveryFilters = {}): Promise<Paginated<DeveloperDelivery>> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const suffix = query.toString();
  return api<Paginated<DeveloperDelivery>>(`/developer/webhook-deliveries${suffix ? `?${suffix}` : ''}`);
}
