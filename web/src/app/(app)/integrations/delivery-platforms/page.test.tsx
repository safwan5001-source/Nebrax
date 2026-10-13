// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DeliveryPlatformsCatalogPage from './page';
import { renderIntl, TEST_MESSAGES } from '@/test-utils/intl';

const { api, currentUser } = vi.hoisted(() => ({ api: vi.fn(), currentUser: vi.fn() }));

vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/auth', () => ({ currentUser }));

const m = TEST_MESSAGES.ar.integrationCenter;

const TODAY = [
  ['hungerstation', 'AWAITING_PROVIDER_APPROVAL'], ['jahez', 'NOT_SUPPORTED'], ['mrsool', 'NOT_SUPPORTED'],
  ['keeta', 'AWAITING_PROVIDER_APPROVAL'], ['ninja', 'NOT_SUPPORTED'], ['the_chefz', 'NOT_SUPPORTED'],
].map(([platform_key, ux_state]) => ({ platform_key, ux_state, connect_enabled: false, sync_enabled: false }));

type Handler = () => unknown;
function backend(handlers: Record<string, Handler>) {
  api.mockImplementation((path: string) => {
    const handler = handlers[path];
    return handler ? Promise.resolve().then(handler) : Promise.reject(new Error(`unexpected ${path}`));
  });
}
const owner = () => currentUser.mockReturnValue({ id: 'u1', role: 'owner', permissions: ['*'] });
const bOf = (key: string) => document.querySelector(`[data-testid="catalog-table"] tr[data-platform="${key}"] [data-ladder-step="b"]`)?.textContent?.trim();
const aOf = (key: string) => document.querySelector(`[data-testid="catalog-table"] tr[data-platform="${key}"] [data-ladder-step="a"]`)?.textContent?.trim();

beforeEach(() => { api.mockReset(); currentUser.mockReset(); });
afterEach(cleanup);

describe('DeliveryPlatformsCatalogPage', () => {
  it('without invoices.view it makes no request and shows the denial', async () => {
    currentUser.mockReturnValue({ id: 'u', role: 'self_service', permissions: ['self_service.access'] });
    renderIntl(<DeliveryPlatformsCatalogPage />, 'ar');

    await waitFor(() => expect(screen.getByTestId('integration-restricted').getAttribute('data-state')).toBe('denied'));
    expect(api).not.toHaveBeenCalled();
    expect(screen.queryByTestId('catalog-table')).toBeNull();
  });

  it('with the POS application off it stops after nav-state', async () => {
    owner();
    backend({ '/applications/nav-state': () => ({ data: { 'sales.pos': false } }) });
    renderIntl(<DeliveryPlatformsCatalogPage />, 'ar');

    await waitFor(() => expect(screen.getByTestId('integration-restricted').getAttribute('data-state')).toBe('app_off'));
    expect(api.mock.calls.map((c) => c[0])).toEqual(['/applications/nav-state']);
  });

  it('shows the readiness exactly as the API returns it — nothing is defaulted to ready', async () => {
    owner();
    backend({
      '/applications/nav-state': () => ({ data: { 'sales.pos': true } }),
      '/delivery-platforms': () => ({ data: [{ platform_key: 'keeta', is_active: true }] }),
      '/delivery-platforms/readiness': () => ({ data: TODAY }),
    });
    renderIntl(<DeliveryPlatformsCatalogPage />, 'ar');

    await screen.findByTestId('catalog-table');
    expect(bOf('hungerstation')).toBe(m.ladder.b.pending);
    expect(bOf('keeta')).toBe(m.ladder.b.pending);
    for (const key of ['jahez', 'mrsool', 'ninja', 'the_chefz']) expect(bOf(key)).toBe(m.ladder.b.unavailable);
    expect(aOf('keeta')).toBe(m.ladder.a.set);
    expect(aOf('ninja')).toBe(m.ladder.a.unset);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a provider is "available" only when the API says so, for that provider alone', async () => {
    owner();
    backend({
      '/applications/nav-state': () => ({ data: {} }),
      '/delivery-platforms': () => ({ data: [] }),
      '/delivery-platforms/readiness': () => ({ data: TODAY.map((row) => (
        row.platform_key === 'keeta' ? { ...row, ux_state: 'READY_TO_CONNECT', connect_enabled: true } : row
      )) }),
    });
    renderIntl(<DeliveryPlatformsCatalogPage />, 'ar');

    await screen.findByTestId('catalog-table');
    expect(bOf('keeta')).toBe(m.ladder.b.available);
    expect(bOf('hungerstation')).toBe(m.ladder.b.pending);
    expect(bOf('jahez')).toBe(m.ladder.b.unavailable);
    // حتى مع جاهزية مزوّد: لا زر ربط في هذه الشريحة، وC وD بلا بيانات اتصال.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    const row = document.querySelector('[data-testid="catalog-table"] tr[data-platform="keeta"]')!;
    expect(row.querySelector('[data-ladder-step="c"]')?.textContent?.trim()).toBe(m.ladder.downstream.noData);
  });

  it('a readiness failure is unreadable with an alert — and retry recovers', async () => {
    const user = userEvent.setup();
    owner();
    let healthy = false;
    api.mockImplementation((path: string) => {
      if (path === '/applications/nav-state') return Promise.resolve({ data: {} });
      if (path === '/delivery-platforms') return Promise.resolve({ data: [] });
      return healthy ? Promise.resolve({ data: TODAY }) : Promise.reject(new Error('down'));
    });
    renderIntl(<DeliveryPlatformsCatalogPage />, 'ar');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(m.catalog.partialError);
    expect(bOf('jahez')).toBe(m.ladder.b.unreadable);
    expect(document.body.textContent).not.toContain(m.ladder.b.unavailable);

    healthy = true;
    await user.click(within(alert).getByRole('button', { name: m.retry }));
    await waitFor(() => expect(bOf('jahez')).toBe(m.ladder.b.unavailable));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a profiles failure makes only manual attribution unreadable', async () => {
    owner();
    backend({
      '/applications/nav-state': () => ({ data: {} }),
      '/delivery-platforms/readiness': () => ({ data: TODAY }),
    });
    renderIntl(<DeliveryPlatformsCatalogPage />, 'ar');

    await screen.findByRole('alert');
    expect(aOf('keeta')).toBe(m.ladder.a.unreadable);
    expect(bOf('keeta')).toBe(m.ladder.b.pending);
  });

  it('issues only the three existing reads and never a write', async () => {
    owner();
    backend({
      '/applications/nav-state': () => ({ data: {} }),
      '/delivery-platforms': () => ({ data: [] }),
      '/delivery-platforms/readiness': () => ({ data: TODAY }),
    });
    renderIntl(<DeliveryPlatformsCatalogPage />, 'ar');

    await screen.findByTestId('catalog-table');
    expect(api.mock.calls.map((c) => c[0]).sort()).toEqual(['/applications/nav-state', '/delivery-platforms', '/delivery-platforms/readiness']);
    for (const call of api.mock.calls) expect(call[1]).toBeUndefined();
  });
});
