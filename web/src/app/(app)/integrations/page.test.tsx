// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IntegrationsPage from './page';
import { renderIntl, TEST_MESSAGES } from '@/test-utils/intl';

const { api, currentUser } = vi.hoisted(() => ({ api: vi.fn(), currentUser: vi.fn() }));

vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/auth', () => ({ currentUser }));

const m = TEST_MESSAGES.ar.integrationCenter;

const SIX_UNREADY = [
  { platform_key: 'hungerstation', ux_state: 'AWAITING_PROVIDER_APPROVAL', connect_enabled: false },
  { platform_key: 'jahez', ux_state: 'NOT_SUPPORTED', connect_enabled: false },
  { platform_key: 'mrsool', ux_state: 'NOT_SUPPORTED', connect_enabled: false },
  { platform_key: 'keeta', ux_state: 'AWAITING_PROVIDER_APPROVAL', connect_enabled: false },
  { platform_key: 'ninja', ux_state: 'NOT_SUPPORTED', connect_enabled: false },
  { platform_key: 'the_chefz', ux_state: 'NOT_SUPPORTED', connect_enabled: false },
];

function backend(handlers: Record<string, () => unknown>) {
  api.mockImplementation((path: string) => {
    const handler = handlers[path];
    return handler ? Promise.resolve().then(handler) : Promise.reject(new Error(`unexpected ${path}`));
  });
}

function owner() {
  currentUser.mockReturnValue({ id: 'u1', role: 'owner', permissions: ['*'] });
}

beforeEach(() => {
  api.mockReset();
  currentUser.mockReset();
});
afterEach(cleanup);

describe('IntegrationsPage', () => {
  it('without invoices.view it shows the denial and makes no API request at all', async () => {
    currentUser.mockReturnValue({ id: 'u2', role: 'self_service', permissions: ['self_service.access'] });
    renderIntl(<IntegrationsPage />, 'ar');

    await waitFor(() => expect(screen.getByTestId('integration-card-delivery').getAttribute('data-state')).toBe('denied'));
    expect(api).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('an unknown user (no session) is denied without any request', async () => {
    currentUser.mockReturnValue(null);
    renderIntl(<IntegrationsPage />, 'ar');

    await waitFor(() => expect(screen.getByTestId('integration-card-delivery').getAttribute('data-state')).toBe('denied'));
    expect(api).not.toHaveBeenCalled();
  });

  it('with the POS application off it stops after nav-state: inert card, no data requests', async () => {
    owner();
    backend({ '/applications/nav-state': () => ({ data: { 'sales.pos': false } }) });
    renderIntl(<IntegrationsPage />, 'ar');

    await waitFor(() => expect(screen.getByTestId('integration-card-delivery').getAttribute('data-state')).toBe('app_off'));
    expect(api.mock.calls.map((call) => call[0])).toEqual(['/applications/nav-state']);
    // مالك: رابط إدارة التطبيقات، وبطاقتا بوابات الدفع (PAY-H1-05) والاتصالات مستقلتان عن بوابة نقاط البيع.
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/applications', '/finance-settings/payments', '/integrations/communications']);
  });

  it('allowed: enters the catalog and summarizes A and B from the two existing reads', async () => {
    owner();
    backend({
      '/applications/nav-state': () => ({ data: { 'sales.pos': true } }),
      '/delivery-platforms': () => ({ data: [
        { platform_key: 'keeta', is_active: true },
        { platform_key: 'jahez', is_active: true },
        { platform_key: 'ninja', is_active: false },
      ] }),
      '/delivery-platforms/readiness': () => ({ data: SIX_UNREADY }),
    });
    renderIntl(<IntegrationsPage />, 'ar');

    const summary = await screen.findByTestId('integration-center-summary');
    expect(summary.textContent).toContain(m.delivery.setUp.replace('{count}', '2').replace('{total}', '6'));
    expect(summary.textContent).toContain(m.delivery.nativeNone);
    expect(screen.getByRole('link', { name: m.delivery.title }).getAttribute('href')).toBe('/integrations/delivery-platforms');

    // قراءات فقط: لا طلب كتابة ولا أي مسار ربط.
    for (const call of api.mock.calls) {
      expect(call[1]).toBeUndefined();
      expect(String(call[0])).not.toMatch(/connect|authori[sz]e|sync|delivery-connectors/i);
    }
  });

  it('a failed nav-state read hides nothing (the server still guards) and the card stays enterable', async () => {
    owner();
    backend({
      '/delivery-platforms': () => ({ data: [] }),
      '/delivery-platforms/readiness': () => ({ data: SIX_UNREADY }),
    });
    renderIntl(<IntegrationsPage />, 'ar');

    await screen.findByTestId('integration-center-summary');
    expect(screen.getByTestId('integration-card-delivery').getAttribute('data-state')).toBe('allowed');
  });

  it('one failed read omits only its line; the other stays honest', async () => {
    owner();
    backend({
      '/applications/nav-state': () => ({ data: {} }),
      '/delivery-platforms': () => ({ data: [{ platform_key: 'keeta', is_active: true }] }),
    });
    renderIntl(<IntegrationsPage />, 'ar');

    const summary = await screen.findByTestId('integration-center-summary');
    expect(summary.querySelectorAll('li')).toHaveLength(1);
    expect(summary.textContent).toContain(m.delivery.setUp.replace('{count}', '1').replace('{total}', '6'));
    expect(summary.textContent).not.toContain(m.delivery.nativeNone);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('both reads failing shows an alert, never "none available", and retry reloads', async () => {
    const user = userEvent.setup();
    owner();
    let healthy = false;
    api.mockImplementation((path: string) => {
      if (path === '/applications/nav-state') return Promise.resolve({ data: {} });
      if (!healthy) return Promise.reject(new Error('down'));
      return Promise.resolve(path === '/delivery-platforms' ? { data: [] } : { data: SIX_UNREADY });
    });
    renderIntl(<IntegrationsPage />, 'ar');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(m.summaryError);
    expect(screen.queryByTestId('integration-center-summary')).toBeNull();
    expect(document.body.textContent).not.toContain(m.delivery.nativeNone);
    // البطاقة تبقى قابلة للدخول رغم فشل الملخص (وبطاقة الاتصالات الثابتة لا تتأثر).
    expect(screen.getByTestId('integration-card-delivery').getAttribute('href')).toBe('/integrations/delivery-platforms');
    expect(screen.getAllByRole('link')).toHaveLength(3); // + بوابات الدفع (مالك)

    healthy = true;
    await user.click(screen.getByRole('button', { name: m.retry }));
    await screen.findByTestId('integration-center-summary');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
