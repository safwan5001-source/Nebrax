// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DeliveryPlatformDetailPage from './page';
import { renderIntl, TEST_MESSAGES } from '@/test-utils/intl';

const { api, currentUser, params } = vi.hoisted(() => ({ api: vi.fn(), currentUser: vi.fn(), params: { current: { platformKey: 'keeta' } as { platformKey: unknown } } }));

vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/auth', () => ({ currentUser }));
vi.mock('next/navigation', () => ({ useParams: () => params.current }));

const m = TEST_MESSAGES.en.integrationCenter;

const TODAY = [
  ['hungerstation', 'AWAITING_PROVIDER_APPROVAL', 'OWNER_GATE'], ['jahez', 'NOT_SUPPORTED', 'BLOCKED'], ['mrsool', 'NOT_SUPPORTED', 'BLOCKED'],
  ['keeta', 'AWAITING_PROVIDER_APPROVAL', 'OWNER_GATE'], ['ninja', 'NOT_SUPPORTED', 'BLOCKED'], ['the_chefz', 'NOT_SUPPORTED', 'BLOCKED'],
].map(([platform_key, ux_state, technical]) => ({
  platform_key, ux_state, technical, connect_enabled: false, sync_enabled: false, evidence_date: '2026-10-11', evidence_ref: 'docs/x.md',
}));
const PUBLIC = TODAY.map(({ platform_key, ux_state, connect_enabled, sync_enabled }) => ({ platform_key, ux_state, connect_enabled, sync_enabled }));

function backend(readiness: unknown = { data: TODAY }, profiles: unknown = { data: [{ platform_key: 'keeta', is_active: true }] }) {
  api.mockImplementation((path: string) => {
    if (path === '/applications/nav-state') return Promise.resolve({ data: { 'sales.pos': true } });
    if (path === '/delivery-platforms') return Promise.resolve(profiles);
    if (path === '/delivery-platforms/readiness') return Promise.resolve(readiness);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}
const owner = () => currentUser.mockReturnValue({ id: 'u1', role: 'owner', permissions: ['*'] });
const step = (s: string) => document.querySelector(`[data-testid="capability-ladder"] [data-ladder-step="${s}"]`)?.textContent?.trim();

beforeEach(() => { api.mockReset(); currentUser.mockReset(); params.current = { platformKey: 'keeta' }; });
afterEach(cleanup);

describe('DeliveryPlatformDetailPage', () => {
  it('shows the ladder for a known platform from the two reads', async () => {
    owner();
    backend();
    renderIntl(<DeliveryPlatformDetailPage />, 'en');

    await screen.findByTestId('capability-ladder');
    expect(step('a')).toBe(m.ladder.a.set);
    expect(step('b')).toBe(m.ladder.b.pending);
    expect(step('c')).toBe(m.ladder.downstream.blocked);
    expect(step('d')).toBe(m.ladder.downstream.blocked);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Keeta');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it.each(['talabat', 'KEETA', '', '../keeta', 'keeta/../jahez', 'jahez?x=1'])('an unknown key (%j) makes zero requests and shows the not-found page', async (key) => {
    owner();
    backend();
    params.current = { platformKey: key };
    renderIntl(<DeliveryPlatformDetailPage />, 'en');

    expect(await screen.findByTestId('delivery-platform-unknown')).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
    expect(screen.queryByTestId('capability-ladder')).toBeNull();
  });

  it('a non-string route param is unknown, not a crash', async () => {
    owner();
    params.current = { platformKey: ['keeta', 'jahez'] };
    renderIntl(<DeliveryPlatformDetailPage />, 'en');

    expect(await screen.findByTestId('delivery-platform-unknown')).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });

  it('without invoices.view it makes no request', async () => {
    currentUser.mockReturnValue({ id: 'u', role: 'custom', permissions: ['reports.view'] });
    renderIntl(<DeliveryPlatformDetailPage />, 'en');

    await waitFor(() => expect(screen.getByTestId('integration-restricted').getAttribute('data-state')).toBe('denied'));
    expect(api).not.toHaveBeenCalled();
  });

  it('with the POS application off it stops after nav-state', async () => {
    owner();
    api.mockImplementation((path: string) => path === '/applications/nav-state'
      ? Promise.resolve({ data: { 'sales.pos': false } })
      : Promise.reject(new Error(`unexpected ${path}`)));
    renderIntl(<DeliveryPlatformDetailPage />, 'en');

    await waitFor(() => expect(screen.getByTestId('integration-restricted').getAttribute('data-state')).toBe('app_off'));
    expect(api.mock.calls.map((c) => c[0])).toEqual(['/applications/nav-state']);
  });

  it('internal evidence shows only when the server sent it (owner/admin), and never otherwise', async () => {
    owner();
    backend({ data: TODAY });
    const { unmount } = renderIntl(<DeliveryPlatformDetailPage />, 'en');
    expect((await screen.findByTestId('detail-advanced')).textContent).toContain('OWNER_GATE');
    unmount();

    currentUser.mockReturnValue({ id: 'u2', role: 'accountant', permissions: ['invoices.view', 'reports.view'] });
    backend({ data: PUBLIC });
    renderIntl(<DeliveryPlatformDetailPage />, 'en');
    await screen.findByTestId('capability-ladder');
    expect(screen.queryByTestId('detail-advanced')).toBeNull();
    expect(document.body.textContent).not.toContain('OWNER_GATE');
    // محاسب: لا رابط لصندوق التوصيل (صلاحية delivery_hub.view)، ويبقى تقرير القناة (reports.view).
    const hrefs = Array.from(screen.getByTestId('works-today').querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/delivery-platforms', '/reports/sales/delivery-channel']);
  });

  it('a failed read is unreadable with an alert, never "not available"', async () => {
    owner();
    api.mockImplementation((path: string) => path === '/applications/nav-state'
      ? Promise.resolve({ data: {} })
      : Promise.reject(new Error('down')));
    renderIntl(<DeliveryPlatformDetailPage />, 'en');

    await screen.findByRole('alert');
    expect(step('a')).toBe(m.ladder.a.unreadable);
    expect(step('b')).toBe(m.ladder.b.unreadable);
    expect(document.body.textContent).not.toContain(m.ladder.b.unavailable);
  });

  it('a platform absent from a readable readiness payload is unreadable, not "not available"', async () => {
    owner();
    backend({ data: TODAY.filter((row) => row.platform_key !== 'keeta') });
    renderIntl(<DeliveryPlatformDetailPage />, 'en');

    await screen.findByTestId('capability-ladder');
    expect(step('b')).toBe(m.ladder.b.unreadable);
  });
});
