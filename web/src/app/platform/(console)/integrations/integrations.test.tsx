/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import PlatformIntegrationsPage from './page';

const { platformApi, replace, ApiError } = vi.hoisted(() => {
  class ApiError extends Error {}
  return { platformApi: vi.fn(), replace: vi.fn(), ApiError };
});
let locale: 'en' | 'ar' = 'en';

function makeTranslator(lang: 'en' | 'ar') {
  return (key: string, values?: Record<string, string | number>) => {
    const text = ((lang === 'ar' ? ar : en) as unknown as Record<string, Record<string, unknown>>).platformIntegrations[key];
    if (typeof text !== 'string') return key;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
  };
}
const translators = { en: makeTranslator('en'), ar: makeTranslator('ar') };
vi.mock('next-intl', () => ({ useTranslations: () => translators[locale], useLocale: () => locale }));
const router = { replace, push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/platform-auth', () => ({ isPlatformAuthenticated: () => true }));
vi.mock('@/lib/platform-api', () => ({ platformApi }));
// بطاقة ضوابط AI Actions لها اختباراتها الخاصة (components/platform)؛ هنا تُستبدل كي لا تلوّث تنبيهات الصفحة.
vi.mock('@/components/platform/ai-action-controls-card', () => ({ AiActionControlsCard: () => <div data-testid="ai-controls" /> }));
vi.mock('@/lib/api', () => ({ ApiError }));

const t = (key: string, values?: Record<string, string | number>) => translators.en(key, values);

const provider = (overrides: Record<string, unknown> = {}) => ({
  enabled: false,
  model: '',
  allow_document_sending: false,
  connection_timeout_seconds: 15,
  processing_timeout_seconds: 90,
  max_attempts: 2,
  last_test_status: 'not_tested',
  last_tested_at: null,
  ...overrides,
});

const overview = () => ({
  integrations: [
    {
      key: 'document_storage', provider: 'r2', enabled: true, configured: true, configured_at: '2026-09-01T10:00:00Z',
      configuration: { endpoint: 'https://acct.r2.cloudflarestorage.com', bucket: 'docs', region: 'auto', access_key_id_masked: '••••ABCD', secret_access_key_masked: '••••WXYZ' },
    },
    { key: 'malware_scanner', provider: 'clamav_tcp', enabled: false, configured: true, configured_at: '2026-09-02T10:00:00Z', configuration: { host: 'scan.internal', port: 3310, timeout_seconds: 10 } },
    { key: 'document_processing', provider: 'redis', enabled: false, configured: false, configured_at: null, configuration: {} },
    {
      key: 'document_ai', provider: null, enabled: false, configured: true, configured_at: null,
      configuration: {
        providers: {
          openai: provider({ enabled: true, model: 'gpt-x', last_test_status: 'passed', last_tested_at: '2026-09-03T10:00:00Z', has_api_key: true, api_key_masked: '••••1111' }),
          anthropic: provider({ model: 'claude-x' }),
          google_gemini: provider({ enabled: true, model: 'gemini-x', last_test_status: 'failed', last_tested_at: '2026-09-04T10:00:00Z', last_test_error_code: 'gemini_auth_failed' }),
        },
      },
    },
  ],
  runtime: { processing_mode: 'async', queue_connection: 'redis', queue_configured: true, worker_required: true, worker_status: 'online', worker_last_seen_at: null, queued_runs: 1, running_runs: 0, failed_runs: 2 },
});

const exceptions = () => [
  { id: 'e1', tenant_id: 't1', tenant_name: 'Alpha Co', reason: 'Scanner outage', expires_at: '2026-12-01T00:00:00Z', status: 'active' },
  { id: 'e2', tenant_id: 't2', tenant_name: 'Beta Co', reason: 'Old window', expires_at: null, status: 'revoked' },
];

let current = overview();
const aiBudgets = () => ({
  period: '2026-10', current_period: '2026-10', global: null, tenants: [], over_allocated: false, by_feature: [],
  policy: { meter_document_extraction: false, failure_charge: 'reserved', assistant_provider: 'mock', assistant_external_network_enabled: false },
  limits: { max_tokens: 1_000_000_000_000, max_cost_micro_usd: 100_000_000_000 },
});
const writes = () => platformApi.mock.calls.filter(([, o]) => o?.method && o.method !== 'GET');
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

beforeEach(() => {
  locale = 'en';
  current = overview();
  platformApi.mockReset();
  replace.mockReset();
  platformApi.mockImplementation(async (path: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    if (path === '/platform/integrations' && method === 'GET') return { data: current };
    if (path === '/platform/document-file-scan-exceptions' && method === 'GET') return { data: exceptions() };
    if (path.startsWith('/platform/ai-budgets') && method === 'GET') return { data: aiBudgets() };
    if (path.startsWith('/platform/tenants') && method === 'GET') return { data: { data: [{ id: 't1', name: 'Alpha Co' }, { id: 't2', name: 'Beta Co' }] } };
    throw new Error(`unexpected ${method} ${path}`);
  });
});
afterEach(() => cleanup());

async function renderLoaded() {
  const utils = render(<PlatformIntegrationsPage />);
  await screen.findByText(t('storageTitle'));
  await screen.findByText('Scanner outage');
  return utils;
}
const card = (title: string) => screen.getByRole('heading', { name: title }).closest('[data-awj-card]') as HTMLElement;
const noticeWith = (text: string) => screen.getAllByRole('status').find((node) => node.textContent?.includes(text));

describe('integrations page structure (H1-4D)', () => {
  it('has no private back link, one h1, a single refresh button and labelled sections', async () => {
    const { container } = await renderLoaded();
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    const refresh = screen.getByRole('button', { name: t('refresh') });
    expect(refresh.className).toContain('h-11');
    expect(document.getElementById('core-integrations')?.textContent).toBe(t('coreTitle'));
    expect(document.getElementById('ai-provider-settings')).toBeTruthy();
  });

  it('opening the page only reads: no write and no connection test is sent', async () => {
    await renderLoaded();
    expect(writes()).toHaveLength(0);
    expect(platformApi.mock.calls.every(([path]) => !String(path).endsWith('/test'))).toBe(true);
  });
});

describe('status comes from saved data only', () => {
  it('shows not configured, saved-disabled and enabled from configured/enabled, and no invented states', async () => {
    await renderLoaded();
    expect(within(card(t('storageTitle'))).getByText(t('statusEnabled'))).toBeTruthy();
    expect(within(card(t('scannerTitle'))).getByText(t('statusSavedDisabled'))).toBeTruthy();
    expect(within(card(t('processingTitle'))).getByText(t('statusNotConfigured'))).toBeTruthy();
    // the page never claims a live connection
    expect(document.body.textContent).not.toMatch(/connected|disconnected|healthy|يتصل|متصل/i);
    expect(screen.getByText(t('statusNote'))).toBeTruthy();
  });

  it('shows each AI provider test result, date and stored-key state from the API fields', async () => {
    await renderLoaded();
    const openai = card(t('providerOpenai'));
    expect(within(openai).getByText(t('keyStored'))).toBeTruthy();
    expect(openai.textContent).toContain(`${t('lastTest')}: ${t('testPassed')}`);
    const anthropic = card(t('providerAnthropic'));
    expect(within(anthropic).getByText(t('keyNotStored'))).toBeTruthy();
    expect(anthropic.textContent).toContain(`${t('lastTest')}: ${t('notTested')}`);
    const gemini = card(t('providerGoogleGemini'));
    expect(gemini.textContent).toContain(`${t('lastTest')}: ${t('testFailedStatus')}`);
  });

  it('flags an unsaved enable/disable change and sends nothing until Save', async () => {
    await renderLoaded();
    const scanner = card(t('scannerTitle'));
    fireEvent.click(within(scanner).getByRole('checkbox'));
    expect(within(scanner).getByText(t('pendingEnable'))).toBeTruthy();
    fireEvent.click(within(scanner).getByRole('checkbox'));
    expect(within(scanner).queryByText(t('pendingEnable'))).toBeNull();
    fireEvent.click(within(card(t('storageTitle'))).getByRole('checkbox'));
    expect(within(card(t('storageTitle'))).getByText(t('pendingDisable'))).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });
});

describe('dates in running text', () => {
  const ARABIC_LETTERS = /[\u0600-\u06FF]/;
  it('are formatted in the page language and direction-isolated (no Arabic date on an English page)', async () => {
    await renderLoaded();
    const storage = screen.getByRole('heading', { name: t('storageTitle') }).closest('[data-awj-card]') as HTMLElement;
    const configured = Array.from(storage.querySelectorAll('p')).find((p) => p.textContent?.startsWith('Last configured')) as HTMLElement;
    expect(configured.textContent).toMatch(/\u2068[^\u2068\u2069]+\u2069/);
    expect(configured.textContent).not.toMatch(ARABIC_LETTERS);
    const region = screen.getByRole('region', { name: t('scanExTitle') });
    expect(region.textContent).toMatch(/Expires \u2068[^\u2068\u2069]+\u2069/);
    const openai = screen.getByRole('heading', { name: t('providerOpenai') }).closest('[data-awj-card]') as HTMLElement;
    const bdi = openai.querySelector('bdi') as HTMLElement;
    expect(bdi).toBeTruthy();
    expect(bdi.textContent).not.toMatch(ARABIC_LETTERS);
  });

  it('uses the Arabic formatting on an Arabic page, still isolated', async () => {
    locale = 'ar';
    render(<PlatformIntegrationsPage />);
    await screen.findByText(ar.platformIntegrations.storageTitle);
    await screen.findByText('Scanner outage');
    const storage = screen.getByRole('heading', { name: ar.platformIntegrations.storageTitle }).closest('[data-awj-card]') as HTMLElement;
    expect(storage.textContent).toMatch(/\u2068[^\u2068\u2069]+\u2069/);
    expect(storage.textContent).toMatch(ARABIC_LETTERS);
  });
});

describe('secrets', () => {
  it('keeps secret fields as empty password inputs and never renders a stored secret', async () => {
    await renderLoaded();
    const storage = card(t('storageTitle'));
    const secrets = Array.from(storage.querySelectorAll<HTMLInputElement>('input[type="password"]'));
    expect(secrets.length).toBeGreaterThanOrEqual(3); // access key, secret key, admin password
    for (const input of secrets) expect(input.value).toBe('');
    // the stored value only appears as the (already masked) placeholder, never as text
    expect(Array.from(storage.querySelectorAll('input')).some((i) => i.placeholder === '••••WXYZ')).toBe(true);
    expect(screen.queryByText('••••WXYZ')).toBeNull();
  });

  it('sends a typed secret only in the PUT body and clears it afterwards', async () => {
    await renderLoaded();
    const storage = card(t('storageTitle'));
    const [accessKey, secretKey, adminPassword] = Array.from(storage.querySelectorAll<HTMLInputElement>('input[type="password"]'));
    fireEvent.change(accessKey!, { target: { value: 'NEW-ACCESS-KEY' } });
    fireEvent.change(secretKey!, { target: { value: 'NEW-SECRET-VALUE' } });
    fireEvent.change(adminPassword!, { target: { value: 'admin-pass-123' } });
    expect(document.body.textContent).not.toContain('NEW-SECRET-VALUE');
    platformApi.mockImplementationOnce(async () => ({ data: current }));
    fireEvent.click(within(storage).getByRole('button', { name: t('save') }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]![0]).toBe('/platform/integrations/document_storage');
    expect(writes()[0]![1].method).toBe('PUT');
    expect(writes()[0]![1].body).toMatchObject({ access_key_id: 'NEW-ACCESS-KEY', secret_access_key: 'NEW-SECRET-VALUE', current_password: 'admin-pass-123' });
    await waitFor(() => expect(noticeWith(t('saved'))).toBeTruthy());
    for (const input of Array.from(storage.querySelectorAll<HTMLInputElement>('input[type="password"]'))) expect(input.value).toBe('');
    expect(document.body.textContent).not.toContain('NEW-SECRET-VALUE');
    expect(noticeWith(t('saved'))?.textContent).not.toContain('NEW-');
  });
});

describe('notices, errors and refresh', () => {
  it('shows a failed test as an alert and a passed test as a status', async () => {
    await renderLoaded();
    platformApi.mockImplementationOnce(async () => ({ data: { ok: false, message: 'Connection refused' } }));
    fireEvent.click(within(card(t('scannerTitle'))).getByRole('button', { name: t('test') }));
    expect((await screen.findByRole('alert')).textContent).toContain('Connection refused');
    expect(noticeWith('Connection refused')).toBeUndefined();

    platformApi.mockImplementationOnce(async () => ({ data: { ok: true, message: 'Reachable' } }));
    fireEvent.click(within(card(t('scannerTitle'))).getByRole('button', { name: t('test') }));
    await waitFor(() => expect(noticeWith('Reachable')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  describe('private storage test result names what was tested (H15-10)', () => {
    const storageTest = async (data: Record<string, unknown>) => {
      await renderLoaded();
      platformApi.mockImplementationOnce(async () => ({ data }));
      fireEvent.click(within(card(t('storageTitle'))).getByRole('button', { name: t('test') }));
    };
    const post = () => platformApi.mock.calls.find(([path]) => String(path).endsWith('/document_storage/test'));

    it('local fallback that passed: neutral information, not a connection success, and the provider is said to be untested', async () => {
      await storageTest({ ok: true, message: 'تم الاتصال بالتخزين الخاص والكتابة والحذف بنجاح.', target: 'local_fallback', operational_storage: 'local' });
      const status = await screen.findByText(t('storageTestLocalOnly'));
      const box = status.closest('[role="status"]') as HTMLElement;
      expect(box).toBeTruthy();
      expect(box.className).toContain('border-warning/40'); // information tone, not the success style
      expect(box.querySelector('svg')?.getAttribute('class')).not.toContain('text-positive');
      expect(box.textContent).toContain(t('storageOperationalLocal'));
      expect(screen.queryByText(t('storageTestProviderOk'))).toBeNull();
      expect(document.body.textContent).not.toContain('تم الاتصال بالتخزين الخاص'); // the server wording is not shown for this target
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('local fallback that failed is an alert and says the provider was not tested', async () => {
      await storageTest({ ok: false, message: 'x', target: 'local_fallback', operational_storage: 'local' });
      expect((await screen.findByText(t('storageTestLocalFailed'))).closest('[role="alert"]')).toBeTruthy();
    });

    it('saved provider: success and failure follow ok', async () => {
      await storageTest({ ok: true, message: 'x', target: 'saved_provider', operational_storage: 'external' });
      const ok = (await screen.findByText(t('storageTestProviderOk'))).closest('[role="status"]') as HTMLElement;
      expect(ok.className).not.toContain('border-warning');
      expect(ok.textContent).toContain(t('storageOperationalExternal'));
      cleanup();
      platformApi.mockReset();
      platformApi.mockImplementation(async (path: string, init?: { method?: string }) => {
        if (path === '/platform/integrations' && (init?.method ?? 'GET') === 'GET') return { data: current };
        if (path === '/platform/document-file-scan-exceptions') return { data: exceptions() };
        if (path.startsWith('/platform/ai-budgets')) return { data: aiBudgets() };
        if (path.startsWith('/platform/tenants')) return { data: { data: [] } };
        return { data: { ok: false, message: 'x', target: 'saved_provider', operational_storage: 'local' } };
      });
      await renderLoaded().catch(() => undefined);
      fireEvent.click(within(card(t('storageTitle'))).getByRole('button', { name: t('test') }));
      expect((await screen.findByText(t('storageTestProviderFailed'))).closest('[role="alert"]')).toBeTruthy();
    });

    it('a provider test that passed does not claim documents are stored there: the operational line is separate', async () => {
      await storageTest({ ok: true, message: 'x', target: 'saved_provider', operational_storage: 'local' });
      const box = (await screen.findByText(t('storageTestProviderOk'))).closest('[role="status"]') as HTMLElement;
      expect(box.textContent).toContain(t('storageOperationalLocal'));
      expect(box.textContent).not.toContain(t('storageOperationalExternal'));
    });

    it('an older response without target is shown exactly as before: ok and the server message', async () => {
      await storageTest({ ok: true, message: 'Legacy server message' });
      expect(await screen.findByText('Legacy server message')).toBeTruthy();
      expect(screen.queryByText(t('storageTestLocalOnly'))).toBeNull();
    });

    it('the target is read from the response, never inferred from the local unsaved toggle', async () => {
      await renderLoaded();
      const storage = card(t('storageTitle'));
      // the saved row is enabled; flip the local toggle off without saving, then test
      fireEvent.click(within(storage).getAllByRole('checkbox')[0]);
      platformApi.mockImplementationOnce(async () => ({ data: { ok: true, message: 'x', target: 'saved_provider', operational_storage: 'external' } }));
      fireEvent.click(within(storage).getByRole('button', { name: t('test') }));
      expect(await screen.findByText(t('storageTestProviderOk'))).toBeTruthy();
      expect(screen.queryByText(t('storageTestLocalOnly'))).toBeNull();
      expect(post()).toBeTruthy();
    });

    it('other integrations are unchanged: a scanner result still shows its own message', async () => {
      await renderLoaded();
      platformApi.mockImplementationOnce(async () => ({ data: { ok: true, message: 'Scanner reachable' } }));
      fireEvent.click(within(card(t('scannerTitle'))).getByRole('button', { name: t('test') }));
      await waitFor(() => expect(noticeWith('Scanner reachable')).toBeTruthy());
    });

    it('has the new texts in both languages', () => {
      for (const lang of [ar, en]) for (const key of ['storageTestLocalOnly', 'storageTestLocalFailed', 'storageTestProviderOk', 'storageTestProviderFailed', 'storageTestEnvironment', 'storageTestEnvironmentFailed', 'storageOperationalLocal', 'storageOperationalExternal']) {
        expect(typeof (lang.platformIntegrations as Record<string, unknown>)[key]).toBe('string');
      }
    });
  });

  it('shows a first-load failure as an alert with a 44px retry that wraps, then recovers', async () => {
    platformApi.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/platform/integrations') {
        if (platformApi.mock.calls.filter(([p]) => p === '/platform/integrations').length === 1) throw new ApiError('Service unavailable');
        return { data: current };
      }
      if (path === '/platform/document-file-scan-exceptions') return { data: exceptions() };
      if (path.startsWith('/platform/ai-budgets')) return { data: aiBudgets() };
      if (path.startsWith('/platform/tenants')) return { data: { data: [] } };
      throw new Error(`unexpected ${init?.method} ${path}`);
    });
    render(<PlatformIntegrationsPage />);
    const alert = await screen.findByText('Service unavailable');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.closest('div')?.className).toContain('flex-wrap');
    const retry = screen.getByRole('button', { name: t('retry') });
    expect(retry.className).toContain('h-11');
    fireEvent.click(retry);
    expect(await screen.findByText(t('storageTitle'))).toBeTruthy();
  });

  it('keeps the settings on screen when a later refresh fails', async () => {
    await renderLoaded();
    platformApi.mockImplementationOnce(async () => { throw new ApiError('Refresh failed'); });
    fireEvent.click(screen.getByRole('button', { name: t('refresh') }));
    expect((await screen.findByText('Refresh failed')).getAttribute('role')).toBe('alert');
    expect(screen.getByText(t('storageTitle'))).toBeTruthy();
  });

  it('blocks a duplicate save while one is in flight', async () => {
    await renderLoaded();
    const pending = deferred<{ data: unknown }>();
    platformApi.mockImplementationOnce(() => pending.promise);
    const storage = card(t('storageTitle'));
    const save = within(storage).getByRole('button', { name: t('save') });
    fireEvent.click(save);
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(save);
    expect(within(storage).getByRole('button', { name: t('test') })).toHaveProperty('disabled', true);
    expect(writes()).toHaveLength(1);
    pending.resolve({ data: current });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    expect(writes()).toHaveLength(1);
  });
});

describe('file scan exceptions', () => {
  const section = () => screen.getByRole('region', { name: t('scanExTitle') });

  it('is localized (no mixed-language literals), keeps the warning and lays out in one column below md', async () => {
    await renderLoaded();
    const region = section();
    expect(within(region).getByText(t('scanExWarning'))).toBeTruthy();
    expect(region.textContent).not.toMatch(/ \/ /); // the old "عربي / English" literals are gone
    expect(region.className).toContain('xl:col-span-2');
    const grid = within(region).getByLabelText(t('scanExTenant')).closest('div[class*="grid"]') as HTMLElement;
    expect(grid.className).toContain('grid-cols-1');
    expect(grid.className).toContain('md:grid-cols-2');
    expect(grid.className).toContain('xl:grid-cols-4');
    const grant = within(region).getByRole('button', { name: t('scanExGrant') });
    expect(grant.className).toContain('w-full');
    expect(grant.className).toContain('sm:w-auto');
    for (const label of [t('scanExTenant'), t('scanExReason'), t('scanExExpires'), t('currentPassword')]) {
      expect(within(region).getByLabelText(label)).toBeTruthy();
    }
  });

  it('translates statuses and shows an empty state', async () => {
    await renderLoaded();
    const region = section();
    expect(within(region).getByText(t('scanExStatusActive'))).toBeTruthy();
    expect(within(region).getByText(t('scanExStatusRevoked'))).toBeTruthy();
    expect(within(region).getByText(t('scanExNoExpiry'))).toBeTruthy();
    expect(within(region).queryByText('active')).toBeNull();
    cleanup();
    platformApi.mockImplementation(async (path: string) => {
      if (path === '/platform/integrations') return { data: current };
      if (path === '/platform/document-file-scan-exceptions') return { data: [] };
      if (path.startsWith('/platform/ai-budgets')) return { data: aiBudgets() };
      return { data: { data: [{ id: 't1', name: 'Alpha Co' }] } };
    });
    render(<PlatformIntegrationsPage />);
    expect(await screen.findByText(t('scanExEmpty'))).toBeTruthy();
  });

  it('shows a load failure with retry', async () => {
    platformApi.mockImplementation(async (path: string) => {
      if (path === '/platform/integrations') return { data: current };
      throw new ApiError('nope');
    });
    render(<PlatformIntegrationsPage />);
    const alert = await screen.findByText(t('scanExLoadFailed'));
    expect(alert.getAttribute('role')).toBe('alert');
    expect(screen.getAllByRole('button', { name: t('retry') }).length).toBeGreaterThan(0);
  });

  it('grants with the same payload, requires reason and password, and clears the password', async () => {
    await renderLoaded();
    const region = section();
    const grant = within(region).getByRole('button', { name: t('scanExGrant') });
    expect((grant as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(region).getByLabelText(t('scanExReason')), { target: { value: 'Scanner maintenance' } });
    expect((grant as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(region).getByLabelText(t('currentPassword')), { target: { value: 'pw-123456' } });
    expect((grant as HTMLButtonElement).disabled).toBe(false);
    platformApi.mockImplementationOnce(async () => ({ data: {} }));
    fireEvent.click(grant);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual(['/platform/document-file-scan-exceptions', { method: 'POST', body: { tenant_id: 't1', reason: 'Scanner maintenance', expires_at: null, current_password: 'pw-123456' } }]);
    await waitFor(() => expect(within(region).getByRole('status').textContent).toBe(t('scanExGranted')));
    expect((within(region).getByLabelText(t('currentPassword')) as HTMLInputElement).value).toBe('');
  });

  it('opening and cancelling the revoke dialog sends nothing, explains the effect and returns focus', async () => {
    await renderLoaded();
    const revokeButton = within(section()).getByRole('button', { name: t('scanExRevoke') });
    revokeButton.focus();
    const before = platformApi.mock.calls.length;
    fireEvent.click(revokeButton);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(t('scanExRevokeDescription', { tenant: 'Alpha Co' }));
    expect(platformApi.mock.calls.length).toBe(before);
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: t('cancel') }));
    expect((within(dialog).getByRole('button', { name: t('scanExRevokeConfirm') }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: t('cancel') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes()).toHaveLength(0);
    expect(document.activeElement).toBe(revokeButton);
  });

  it('revokes once with the same payload and does not keep the password after closing', async () => {
    await renderLoaded();
    fireEvent.click(within(section()).getByRole('button', { name: t('scanExRevoke') }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(t('scanExRevokeReason')), { target: { value: 'No longer needed' } });
    fireEvent.change(within(dialog).getByLabelText(t('currentPassword')), { target: { value: 'pw-123456' } });
    const confirm = within(dialog).getByRole('button', { name: t('scanExRevokeConfirm') });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    const pending = deferred<{ data: unknown }>();
    platformApi.mockImplementationOnce(() => pending.promise);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toEqual(['/platform/document-file-scan-exceptions/e1/revoke', { method: 'POST', body: { reason: 'No longer needed', current_password: 'pw-123456' } }]);
    pending.resolve({ data: {} });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(within(section()).getByRole('status').textContent).toBe(t('scanExRevoked')));
    expect(writes()).toHaveLength(1);
    // reopening starts empty: nothing typed before is retained
    fireEvent.click(within(section()).getByRole('button', { name: t('scanExRevoke') }));
    const again = await screen.findByRole('dialog');
    expect((within(again).getByLabelText(t('currentPassword')) as HTMLInputElement).value).toBe('');
  });

  it('keeps the dialog open with an alert when the revoke is rejected', async () => {
    await renderLoaded();
    fireEvent.click(within(section()).getByRole('button', { name: t('scanExRevoke') }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(t('scanExRevokeReason')), { target: { value: 'x' } });
    fireEvent.change(within(dialog).getByLabelText(t('currentPassword')), { target: { value: 'wrong' } });
    platformApi.mockImplementationOnce(async () => { throw new ApiError('Wrong password'); });
    fireEvent.click(within(dialog).getByRole('button', { name: t('scanExRevokeConfirm') }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Wrong password');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('locales', () => {
  it('has every new key in both languages', () => {
    const keys = ['statusNote', 'statusNotConfigured', 'statusSavedDisabled', 'statusEnabled', 'pendingEnable', 'pendingDisable', 'keyStored', 'keyNotStored', 'cancel', 'close', 'coreTitle',
      'scanExTitle', 'scanExWarning', 'scanExTenant', 'scanExReason', 'scanExReasonPlaceholder', 'scanExExpires', 'scanExGrant', 'scanExGranting', 'scanExGranted', 'scanExGrantFailed', 'scanExLoadFailed',
      'scanExEmpty', 'scanExNoTenants', 'scanExStatusActive', 'scanExStatusExpired', 'scanExStatusRevoked', 'scanExExpiresOn', 'scanExNoExpiry', 'scanExRevoke', 'scanExRevokeTitle',
      'scanExRevokeDescription', 'scanExRevokeReason', 'scanExRevokeConfirm', 'scanExRevoking', 'scanExRevoked', 'scanExRevokeFailed'];
    for (const lang of [ar, en]) for (const key of keys) expect(typeof (lang.platformIntegrations as Record<string, unknown>)[key]).toBe('string');
  });

  it('renders the page in Arabic with isolated dates', async () => {
    locale = 'ar';
    render(<PlatformIntegrationsPage />);
    await screen.findByText(ar.platformIntegrations.storageTitle);
    expect(screen.getByText(ar.platformIntegrations.statusNote)).toBeTruthy();
    expect(screen.getByText(ar.platformIntegrations.scanExWarning)).toBeTruthy();
  });
});

describe('every form control has a programmatic name (H1-5 P1)', () => {
  it('ties each visible label to its input or select, so none is announced as an unnamed field', async () => {
    const { container } = await renderLoaded();
    const controls = [...container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input:not([type=hidden]), select')];
    expect(controls.length).toBeGreaterThan(40);
    const unnamed = controls.filter((control) => !(control.labels && control.labels.length > 0) && !control.getAttribute('aria-label') && !control.getAttribute('aria-labelledby'));
    expect(unnamed.map((control) => `${control.tagName}:${control.getAttribute('type') ?? ''}`)).toEqual([]);
    // label text resolves to the right control
    expect(screen.getAllByLabelText(t('endpoint'))[0].tagName).toBe('INPUT');
    expect(screen.getAllByLabelText(t('provider'))[0].tagName).toBe('SELECT');
    // ids are unique, so a label never points at another card's control
    const ids = controls.map((control) => control.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
