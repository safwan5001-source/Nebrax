/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppBuilderDetailPage from './page';

const { toastFns } = vi.hoisted(() => ({ toastFns: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toastFns }));

const { api, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    'detail.back': 'Back to apps',
    'detail.loadFailed': 'Could not load app.',
    'detail.overviewTitle': 'Overview',
    'detail.createdLabel': 'Created',
    'detail.sourceLabel': 'Starting point',
    'detail.versionsTitle': 'Published versions',
    'detail.versionsEmpty': 'No version published yet.',
    'detail.versionRow': 'Version {version} — {date}',
    'detail.viewAllVersions': 'View all versions',
    openBuilder: 'Open the builder',
    'detail.previewSessions.title': 'On-device preview sessions',
    'detail.previewSessions.empty': 'No preview sessions yet.',
    'detail.previewSessions.issueAction': 'Issue preview session',
    'detail.previewSessions.issuing': 'Issuing…',
    'detail.previewSessions.revokeAction': 'Revoke',
    'detail.previewSessions.revoking': 'Revoking…',
    'detail.previewSessions.revokeConfirmTitle': 'Revoke preview session',
    'detail.previewSessions.revokeConfirmBody': 'This session will stop working once revoked.',
    'detail.previewSessions.expiresLabel': 'Expires: {date}',
    'detail.previewSessions.statusActive': 'Active',
    'detail.previewSessions.statusExpired': 'Expired',
    'detail.previewSessions.statusRevoked': 'Revoked',
    'detail.previewSessions.tokenDialogTitle': 'Preview session credential',
    'detail.previewSessions.tokenDialogDescription': 'Paste this into the preview build.',
    'detail.previewSessions.issueSuccessTitle': 'Preview session issued',
    'detail.previewSessions.issueErrorTitle': 'Could not issue the preview session',
    'detail.previewSessions.revokeErrorTitle': 'Could not revoke the session',
    'detail.previewSessions.loadErrorTitle': 'Could not load preview sessions',
    'detail.previewSessions.qrAction': 'Preview on phone',
    'detail.previewSessions.qrDialogTitle': 'Preview on your phone',
    'detail.previewSessions.qrCreating': 'Preparing a one-time code…',
    'detail.previewSessions.qrInstructions': 'Scan this code on the device.',
    'detail.previewSessions.qrExpiresIn': 'Expires in {seconds}s',
    'detail.previewSessions.qrExpired': 'This code has expired. Generate a new one.',
    'detail.previewSessions.qrConsumed': 'Connected — a preview session is now active on the device.',
    'detail.previewSessions.qrCopyLink': 'Copy link',
    'detail.previewSessions.qrCopied': 'Copied',
    'detail.previewSessions.qrRegenerate': 'Generate a new code',
    'detail.previewSessions.qrRetry': 'Try again',
    'detail.previewSessions.qrErrorTitle': 'Could not prepare the preview code',
    'detail.previewSessions.qrErrorBody': 'Something went wrong while preparing the preview code.',
    'detail.previewSessions.qrTemporaryNote': 'This code is temporary and works once.',
    'creationSource.store_design': 'From store design',
    'creationSource.template': 'From template',
    'creationSource.scratch': 'From scratch',
    loading: 'Loading…',
    retry: 'Try again',
    cancel: 'Cancel',
  };
  // مثيلٌ واحد مستقرّ لكل نطاق — لا دالّة جديدة عند كل استدعاء، وإلا كسر
  // استقرار مرجع `t` الذي يعتمد عليه `useCallback`/`useEffect` في الصفحة
  // الحقيقية (نفس نمط `next-intl` الفعلي)، فيسبّب حلقة إعادة رسم لا نهائية
  // في الاختبار وحده (الصفحة الحقيقية سليمة — `next-intl` الحقيقي مستقرّ).
  const cache = new Map<string, ReturnType<typeof buildTranslator>>();
  function buildTranslator(namespace: string) {
    return Object.assign(
      (key: string, values?: Record<string, unknown>) => {
        const full = namespace ? `${namespace}.${key}`.replace(/^appBuilder\./, '') : key;
        const text = strings[full] ?? strings[key] ?? key;
        return text.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ''));
      },
      { raw: () => ({}) }
    );
  }
  const translator = (namespace: string) => {
    if (!cache.has(namespace)) cache.set(namespace, buildTranslator(namespace));
    return cache.get(namespace)!;
  };
  return { api: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: (ns: string) => translate(ns), useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'app-1' }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api };
});
vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) =>
      typeof name === 'symbol' || name === 'then' || name === '__esModule'
        ? Reflect.get(target, name)
        : iconStub,
    has: () => true,
  });
});

const appData = {
  id: 'app-1',
  name: 'متجري',
  name_en: 'My App',
  creation_source: 'scratch' as const,
  latest_published_version: null,
  created_at: '2026-09-20T00:00:00Z',
  updated_at: '2026-09-20T00:00:00Z',
};

describe('AppBuilderDetailPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.mockReset();
    toastFns.success.mockReset();
    toastFns.error.mockReset();
  });

  it('loads and renders the app name, creation source, and empty versions state', async () => {
    api.mockImplementation((path: string) => {
      if (path.endsWith('/versions')) return Promise.resolve({ data: [] });
      if (path.endsWith('/preview-sessions')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: appData });
    });

    render(<AppBuilderDetailPage />);

    expect(await screen.findByText('My App')).toBeTruthy();
    expect(screen.getByText('From scratch')).toBeTruthy();
    // DetailPage renders section content twice (mobile accordion + desktop grid, toggled by CSS
    // classes jsdom doesn't apply) — assert presence via getAllByText, not a single-match query.
    expect(screen.getAllByText('No version published yet.').length).toBeGreaterThan(0);
    const openBuilderLink = screen.getByRole('link', { name: 'Open the builder' });
    expect(openBuilderLink.getAttribute('href')).toBe('/app-builder/app-1/builder');

    const [viewAllLink] = screen.getAllByRole('link', { name: 'View all versions' });
    expect(viewAllLink.getAttribute('href')).toBe('/app-builder/app-1/versions');
  });

  it('renders published versions when present', async () => {
    api.mockImplementation((path: string) => {
      if (path.endsWith('/versions')) {
        return Promise.resolve({
          data: [{ id: 'v1', builder_app_id: 'app-1', version: 1, schema_version: '1.0.0', note: null, published_at: '2026-09-21T00:00:00Z' }],
        });
      }
      if (path.endsWith('/preview-sessions')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: appData });
    });

    render(<AppBuilderDetailPage />);

    expect((await screen.findAllByText(/Version 1/)).length).toBeGreaterThan(0);
  });

  it('shows an error state when the app fails to load', async () => {
    const { ApiError } = await import('@/lib/api');
    api.mockRejectedValue(new ApiError(404, 'Could not load app.', null));

    render(<AppBuilderDetailPage />);

    expect(await screen.findByText('Could not load app.')).toBeTruthy();
  });

  it('issuing a preview session shows its raw token once and never stores it in the list', async () => {
    let sessionsAfterIssue = false;
    api.mockImplementation((path: string, init?: { method?: string }) => {
      if (path.endsWith('/versions')) return Promise.resolve({ data: [] });
      if (path.endsWith('/preview-sessions') && init?.method === 'POST') {
        sessionsAfterIssue = true;
        return Promise.resolve({
          token: '1|raw-secret-value',
          session: {
            id: 'ps-1', builder_app_id: 'app-1', source: 'draft', channel: 'device',
            device_label: null, draft_revision: 0, created_by: 'u1',
            expires_at: '2026-09-29T12:15:00Z', revoked_at: null, last_used_at: null,
          },
        });
      }
      if (path.endsWith('/preview-sessions')) {
        return Promise.resolve({
          data: sessionsAfterIssue
            ? [{
                id: 'ps-1', builder_app_id: 'app-1', source: 'draft', channel: 'device',
                device_label: null, draft_revision: 0, created_by: 'u1',
                expires_at: '2026-09-29T12:15:00Z', revoked_at: null, last_used_at: null,
                created_at: '2026-09-29T12:00:00Z',
              }]
            : [],
        });
      }
      return Promise.resolve({ data: appData });
    });

    render(<AppBuilderDetailPage />);
    const issueButton = await screen.findByText('Issue preview session');
    await userEvent.setup().click(issueButton);

    expect(await screen.findByText('Preview session credential')).toBeTruthy();
    expect(toastFns.success).toHaveBeenCalledWith('Preview session issued');

    const postCall = api.mock.calls.find(
      (call) => call[0] === '/app-builder/apps/app-1/preview-sessions' && call[1]?.method === 'POST',
    );
    expect(postCall).toBeTruthy();

    // القائمة الوصفية لا تحمل التوكن الخام أبداً — فقط الحالة والانتهاء.
    expect(screen.queryByText('1|raw-secret-value')).toBeNull();
  });

  it('revoking an active preview session calls the revoke endpoint', async () => {
    let revoked = false;
    api.mockImplementation((path: string, init?: { method?: string }) => {
      if (path.endsWith('/versions')) return Promise.resolve({ data: [] });
      if (path.includes('/preview-sessions/ps-1') && init?.method === 'DELETE') {
        revoked = true;
        return Promise.resolve({ message: 'ok' });
      }
      if (path.endsWith('/preview-sessions')) {
        return Promise.resolve({
          data: [{
            id: 'ps-1', builder_app_id: 'app-1', source: 'draft', channel: 'device',
            device_label: null, draft_revision: 0, created_by: 'u1',
            expires_at: revoked ? '2026-09-29T12:15:00Z' : '2099-01-01T00:00:00Z',
            revoked_at: revoked ? '2026-09-29T13:00:00Z' : null,
            last_used_at: null, created_at: '2026-09-29T12:00:00Z',
          }],
        });
      }
      return Promise.resolve({ data: appData });
    });

    render(<AppBuilderDetailPage />);
    const revokeButton = await screen.findByText('Revoke');
    await userEvent.setup().click(revokeButton);

    const dialog = await screen.findByRole('dialog');
    const confirmButton = within(dialog).getAllByRole('button', { name: 'Revoke' })[0];
    await userEvent.setup().click(confirmButton);

    expect(await screen.findByText('Revoked')).toBeTruthy();
    const deleteCall = api.mock.calls.find(
      (call) => call[0] === '/app-builder/apps/app-1/preview-sessions/ps-1' && call[1]?.method === 'DELETE',
    );
    expect(deleteCall).toBeTruthy();
  });

  describe('MOBILE-PREVIEW-7 — phone preview QR exchange', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('requests a one-time exchange reference and shows only the deep link — never a session bearer', async () => {
      api.mockImplementation((path: string, init?: { method?: string }) => {
        if (path.endsWith('/versions')) return Promise.resolve({ data: [] });
        if (path.endsWith('/preview-sessions')) return Promise.resolve({ data: [] });
        if (path.endsWith('/preview-exchange-references') && init?.method === 'POST') {
          return Promise.resolve({
            reference: 'raw-exchange-reference',
            deep_link: 'https://preview.awj-runtime-proof.example/preview/raw-exchange-reference',
            expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
            exchange_reference_id: 'xref-1',
          });
        }
        return Promise.resolve({ data: appData });
      });

      render(<AppBuilderDetailPage />);
      const openButton = await screen.findByText('Preview on phone');
      await userEvent.setup().click(openButton);

      expect(await screen.findByText('Scan this code on the device.')).toBeTruthy();
      expect(await screen.findByText(/Expires in \d+s/)).toBeTruthy();

      const postCall = api.mock.calls.find(
        (call) => call[0] === '/app-builder/apps/app-1/preview-exchange-references' && call[1]?.method === 'POST',
      );
      expect(postCall).toBeTruthy();

      // لا بصمة عمل تُعرض هنا إطلاقاً — لا `token` ولا نصّ المرجع الخام كنصّ عادي بديل رابط.
      expect(screen.queryByText('raw-exchange-reference')).toBeNull();
    });

    it('copying the link writes the deep link (never a bearer) to the clipboard', async () => {
      // jsdom/`@testing-library/user-event` يثبّتان stub حافظة حقيقياً بمجرّد
      // أول `userEvent.setup()` — يستبدل أيّ `Object.defineProperty` سابقاً
      // على `navigator.clipboard` بصمت. نتحقّق إذن من محتوى الحافظة الفعلي
      // عبر `readText()` بدل تجسّس دالّة قد لا تُستدعى أصلاً.
      const deepLink = 'https://preview.awj-runtime-proof.example/preview/copy-me-reference';
      api.mockImplementation((path: string, init?: { method?: string }) => {
        if (path.endsWith('/versions')) return Promise.resolve({ data: [] });
        if (path.endsWith('/preview-sessions')) return Promise.resolve({ data: [] });
        if (path.endsWith('/preview-exchange-references') && init?.method === 'POST') {
          return Promise.resolve({
            reference: 'copy-me-reference', deep_link: deepLink,
            expires_at: new Date(Date.now() + 5 * 60_000).toISOString(), exchange_reference_id: 'xref-2',
          });
        }
        return Promise.resolve({ data: appData });
      });

      const user = userEvent.setup();
      render(<AppBuilderDetailPage />);
      await user.click(await screen.findByText('Preview on phone'));
      await user.click(await screen.findByText('Copy link'));

      expect(await navigator.clipboard.readText()).toBe(deepLink);
      expect(await screen.findByText('Copied')).toBeTruthy();
    });

    it('regenerating requests a fresh exchange reference', async () => {
      let issueCount = 0;
      api.mockImplementation((path: string, init?: { method?: string }) => {
        if (path.endsWith('/versions')) return Promise.resolve({ data: [] });
        if (path.endsWith('/preview-sessions')) return Promise.resolve({ data: [] });
        if (path.endsWith('/preview-exchange-references') && init?.method === 'POST') {
          issueCount += 1;
          return Promise.resolve({
            reference: `reference-${issueCount}`, deep_link: `https://preview.example/preview/reference-${issueCount}`,
            expires_at: new Date(Date.now() + 5 * 60_000).toISOString(), exchange_reference_id: `xref-${issueCount}`,
          });
        }
        return Promise.resolve({ data: appData });
      });

      render(<AppBuilderDetailPage />);
      await userEvent.setup().click(await screen.findByText('Preview on phone'));
      await screen.findByText(/Expires in \d+s/);

      await userEvent.setup().click(await screen.findByText('Generate a new code'));

      expect(issueCount).toBe(2);
    });

    it('shows a controlled error state and lets the merchant retry', async () => {
      const { ApiError } = await import('@/lib/api');
      api.mockImplementation((path: string, init?: { method?: string }) => {
        if (path.endsWith('/versions')) return Promise.resolve({ data: [] });
        if (path.endsWith('/preview-sessions')) return Promise.resolve({ data: [] });
        if (path.endsWith('/preview-exchange-references') && init?.method === 'POST') {
          return Promise.reject(new ApiError(500, 'internal error', null));
        }
        return Promise.resolve({ data: appData });
      });

      render(<AppBuilderDetailPage />);
      await userEvent.setup().click(await screen.findByText('Preview on phone'));

      expect(await screen.findByText('Something went wrong while preparing the preview code.')).toBeTruthy();
      expect(toastFns.error).toHaveBeenCalled();
      expect(await screen.findByText('Try again')).toBeTruthy();
    });

    it('shows the expired state once the five-minute window elapses, without extending it', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      api.mockImplementation((path: string, init?: { method?: string }) => {
        if (path.endsWith('/versions')) return Promise.resolve({ data: [] });
        if (path.endsWith('/preview-sessions')) return Promise.resolve({ data: [] });
        if (path.endsWith('/preview-exchange-references') && init?.method === 'POST') {
          return Promise.resolve({
            reference: 'soon-to-expire', deep_link: 'https://preview.example/preview/soon-to-expire',
            expires_at: new Date(Date.now() + 3000).toISOString(), exchange_reference_id: 'xref-exp',
          });
        }
        return Promise.resolve({ data: appData });
      });

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<AppBuilderDetailPage />);
      await user.click(await screen.findByText('Preview on phone'));
      await screen.findByText(/Expires in \d+s/);

      await vi.advanceTimersByTimeAsync(6000);

      expect(await screen.findByText('This code has expired. Generate a new one.')).toBeTruthy();
    });

    it('shows a connected state once a new preview session appears on the device', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let sessionExists = false;
      api.mockImplementation((path: string, init?: { method?: string }) => {
        if (path.endsWith('/versions')) return Promise.resolve({ data: [] });
        if (path.endsWith('/preview-exchange-references') && init?.method === 'POST') {
          return Promise.resolve({
            reference: 'device-scanned', deep_link: 'https://preview.example/preview/device-scanned',
            expires_at: new Date(Date.now() + 5 * 60_000).toISOString(), exchange_reference_id: 'xref-consumed',
          });
        }
        if (path.endsWith('/preview-sessions')) {
          return Promise.resolve({
            data: sessionExists
              ? [{
                  id: 'ps-device', builder_app_id: 'app-1', source: 'draft', channel: 'device',
                  device_label: null, draft_revision: 0, created_by: 'u1',
                  expires_at: '2099-01-01T00:00:00Z', revoked_at: null, last_used_at: null,
                  created_at: '2026-09-29T12:00:00Z',
                }]
              : [],
          });
        }
        return Promise.resolve({ data: appData });
      });

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<AppBuilderDetailPage />);
      await user.click(await screen.findByText('Preview on phone'));
      await screen.findByText(/Expires in \d+s/);

      sessionExists = true;
      await vi.advanceTimersByTimeAsync(4500);

      expect(await screen.findByText('Connected — a preview session is now active on the device.')).toBeTruthy();
    });
  });
});
