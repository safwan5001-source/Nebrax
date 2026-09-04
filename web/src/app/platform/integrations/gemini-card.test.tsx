/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { platformApi, router, translate, i18nState } = vi.hoisted(() => {
  const replace = vi.fn();
  const i18nState: { map: Record<string, string> | null } = { map: null };
  return {
    platformApi: vi.fn(),
    router: { replace, push: replace },
    i18nState,
    translate: (key: string) => i18nState.map?.[key] ?? key,
  };
});

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));
vi.mock('@/lib/platform-auth', () => ({ isPlatformAuthenticated: () => true }));
vi.mock('@/lib/platform-api', () => ({ platformApi }));
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock('@/lib/formatting', () => ({ formatDateTime: () => 'formatted' }));
vi.mock('lucide-react', () => {
  const Icon = () => null;
  return {
    ArrowRight: Icon,
    Bot: Icon,
    CheckCircle2: Icon,
    Database: Icon,
    Loader2: Icon,
    RefreshCw: Icon,
    Save: Icon,
    ServerCog: Icon,
    ShieldCheck: Icon,
    TestTube2: Icon,
    XCircle: Icon,
  };
});
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, asChild: _asChild, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => (
    <button type="button" {...props}>{children}</button>
  ),
}));
vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
}));
vi.mock('@/components/ui/skeleton', () => ({ Skeleton: () => <div /> }));

import PlatformIntegrationsPage from './page';

const runtime = {
  queue_connection: 'sync',
  queue_configured: true,
  worker_status: 'offline' as const,
  worker_last_seen_at: null,
  queued_runs: 0,
  running_runs: 0,
  failed_runs: 0,
};

function publicProvider(overrides: Record<string, unknown> = {}) {
  return {
    enabled: false,
    model: '',
    allow_document_sending: false,
    connection_timeout_seconds: 15,
    processing_timeout_seconds: 90,
    max_attempts: 2,
    last_test_status: null,
    last_tested_at: null,
    ...overrides,
  };
}

function makeOverview(gemini: Record<string, unknown> = {}) {
  return {
    integrations: [
      { key: 'document_storage', provider: 'r2', enabled: false, configured: false, configuration: {}, configured_at: null },
      { key: 'malware_scanner', provider: 'clamav_tcp', enabled: false, configured: false, configuration: {}, configured_at: null },
      { key: 'document_processing', provider: 'redis', enabled: false, configured: false, configuration: {}, configured_at: null },
      {
        key: 'document_ai',
        provider: null,
        enabled: false,
        configured: true,
        configuration: {
          providers: {
            openai: publicProvider({ model: 'gpt-4o-mini' }),
            anthropic: publicProvider({ model: 'claude-3-5-sonnet-latest' }),
            google_gemini: publicProvider({ model: 'gemini-2.5-flash', ...gemini }),
          },
        },
        configured_at: null,
      },
    ],
    runtime,
  };
}

function maskGemini(provider: Record<string, unknown>) {
  const next = { ...provider };
  const key = typeof next.api_key === 'string' ? next.api_key : '';
  delete next.api_key;
  delete next.clear_api_key;
  if (key !== '') {
    next.has_api_key = true;
    next.api_key_masked = `••••••••${key.slice(-4)}`;
  }
  return next;
}

function geminiCard() {
  return screen.getByRole('heading', { name: 'providerGoogleGemini' }).closest('section') as HTMLElement;
}

function openaiCard() {
  return screen.getByRole('heading', { name: 'providerOpenai' }).closest('section') as HTMLElement;
}

describe('Gemini save/test UX', () => {
  let overview: ReturnType<typeof makeOverview>;
  let wipeGeminiOnGet: boolean;
  let testOk: boolean;
  let getCount: number;

  afterEach(cleanup);

  beforeEach(() => {
    overview = makeOverview();
    wipeGeminiOnGet = false;
    testOk = true;
    getCount = 0;
    i18nState.map = null;
    router.replace.mockReset();
    platformApi.mockReset();
    platformApi.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
      const method = init?.method ?? 'GET';
      if (path === '/platform/integrations' && method === 'GET') {
        getCount += 1;
        if (wipeGeminiOnGet && getCount > 1) {
          return { data: makeOverview({ model: '', enabled: false, allow_document_sending: false }) };
        }
        return { data: overview };
      }
      if (path === '/platform/integrations/document_ai' && method === 'PUT') {
        const body = init?.body as { providers: { google_gemini: Record<string, unknown> } };
        overview = makeOverview(maskGemini(body.providers.google_gemini));
        return { data: overview };
      }
      if (path === '/platform/integrations/document_ai/test' && method === 'POST') {
        return { data: { ok: testOk, message: testOk ? 'ok' : 'denied' } };
      }
      throw new Error(`${method} ${path}`);
    });
  });

  it('saves Gemini through PUT, blocks dirty tests, and keeps the form after a later overview fetch', async () => {
    render(<PlatformIntegrationsPage />);
    await screen.findByText('aiTitle');

    expect(within(geminiCard()).getByRole('button', { name: 'saveSettings' })).toBeTruthy();
    expect(within(openaiCard()).queryByRole('button', { name: 'saveSettings' })).toBeNull();

    const card = geminiCard();
    fireEvent.change(within(card).getByDisplayValue('gemini-2.5-flash'), { target: { value: 'gemini-2.5-pro' } });

    const dirtyTest = within(card).getByRole('button', { name: 'testConnection' });
    expect(dirtyTest).toHaveProperty('disabled', true);
    expect(dirtyTest.getAttribute('title')).toBe('saveBeforeTest');
    expect(within(card).getByText('saveBeforeTest')).toBeTruthy();

    fireEvent.click(within(card).getAllByRole('checkbox')[0]);
    fireEvent.change(within(card).getByPlaceholderText('secretPlaceholder'), { target: { value: 'gemini-test-secret-abcd' } });
    fireEvent.click(within(card).getByText('allowDocumentSending').closest('label')!.querySelector('input')!);
    fireEvent.change(card.querySelector('input[autocomplete="current-password"]') as HTMLInputElement, {
      target: { value: 'platform-pass' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'saveSettings' }));

    await waitFor(() => {
      const puts = platformApi.mock.calls.filter(
        ([path, init]) => path === '/platform/integrations/document_ai' && init?.method === 'PUT',
      );
      expect(puts).toHaveLength(1);
      const body = puts[0][1]?.body as Record<string, any>;
      expect(body.current_password).toBe('platform-pass');
      expect(body.providers.google_gemini).toMatchObject({
        enabled: true,
        model: 'gemini-2.5-pro',
        allow_document_sending: true,
        api_key: 'gemini-test-secret-abcd',
      });
    });

    await waitFor(() => {
      expect(within(geminiCard()).getByRole('button', { name: 'testConnection' })).toHaveProperty('disabled', false);
    });
    expect(within(geminiCard()).getByDisplayValue('gemini-2.5-pro')).toBeTruthy();
    expect(screen.getByText('savedSuccessfully')).toBeTruthy();

    wipeGeminiOnGet = true;
    fireEvent.click(within(geminiCard()).getByRole('button', { name: 'testConnection' }));

    await waitFor(() => {
      const post = platformApi.mock.calls.find(
        ([path, init]) => path === '/platform/integrations/document_ai/test' && init?.method === 'POST',
      );
      expect(post?.[1]?.body).toEqual({ provider: 'google_gemini' });
    });
    expect(await screen.findByText('connectionSucceeded')).toBeTruthy();
    expect(within(geminiCard()).getByDisplayValue('gemini-2.5-pro')).toBeTruthy();

    testOk = false;
    fireEvent.click(within(geminiCard()).getByRole('button', { name: 'testConnection' }));
    expect(await screen.findByText('connectionFailed')).toBeTruthy();
    expect(within(geminiCard()).getByDisplayValue('gemini-2.5-pro')).toBeTruthy();
  }, 20000);

  it.each([
    ['ar', {
      aiTitle: 'مزودو الذكاء الاصطناعي',
      providerGoogleGemini: 'Google Gemini',
      saveSettings: 'حفظ الإعدادات',
      testConnection: 'اختبار الاتصال',
      saveBeforeTest: 'احفظ التغييرات قبل اختبار الاتصال',
    }],
    ['en', {
      aiTitle: 'AI Providers',
      providerGoogleGemini: 'Google Gemini',
      saveSettings: 'Save settings',
      testConnection: 'Test connection',
      saveBeforeTest: 'Save changes before testing',
    }],
  ] as const)('disables Gemini test with save-before-test copy in %s', async (_locale, labels) => {
    i18nState.map = { ...labels };
    render(<PlatformIntegrationsPage />);
    await screen.findByText(labels.aiTitle);

    const card = screen.getByRole('heading', { name: labels.providerGoogleGemini }).closest('section') as HTMLElement;
    fireEvent.change(within(card).getByDisplayValue('gemini-2.5-flash'), { target: { value: 'gemini-2.5-pro' } });

    const testButton = within(card).getByRole('button', { name: labels.testConnection });
    expect(testButton).toHaveProperty('disabled', true);
    expect(testButton.getAttribute('title')).toBe(labels.saveBeforeTest);
    expect(within(card).getByText(labels.saveBeforeTest)).toBeTruthy();
    expect(within(card).getByRole('button', { name: labels.saveSettings })).toBeTruthy();
  }, 15000);
});
