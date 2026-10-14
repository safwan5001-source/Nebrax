// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryPlatformDetailScreen } from './delivery-platform-detail-screen';
import { renderIntl, TEST_MESSAGES } from '@/test-utils/intl';

const { api, currentUser } = vi.hoisted(() => ({ api: vi.fn(), currentUser: vi.fn() }));

vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/auth', () => ({ currentUser }));

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
    // INT-UX-4: قراءة اللوحة الإضافية (فارغة هنا؛ سلوكها في signed-ingress-panel.test.tsx).
    if (path === '/delivery-connectors') return Promise.resolve({ data: [] });
    if (path === '/branches') return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}
const owner = () => currentUser.mockReturnValue({ id: 'u1', role: 'owner', permissions: ['*'] });
const step = (s: string) => document.querySelector(`[data-testid="capability-ladder"] [data-ladder-step="${s}"]`)?.textContent?.trim();

beforeEach(() => { api.mockReset(); currentUser.mockReset(); });
afterEach(cleanup);

describe('DeliveryPlatformDetailScreen (known platform, client states)', () => {
  it('shows the ladder for a known platform from the two reads', async () => {
    owner();
    backend();
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');

    await screen.findByTestId('capability-ladder');
    expect(step('a')).toBe(m.ladder.a.set);
    expect(step('b')).toBe(m.ladder.b.pending);
    expect(step('c')).toBe(m.ladder.downstream.blocked);
    expect(step('d')).toBe(m.ladder.downstream.blocked);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Keeta');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('without invoices.view it makes no request', async () => {
    currentUser.mockReturnValue({ id: 'u', role: 'custom', permissions: ['reports.view'] });
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');

    await waitFor(() => expect(screen.getByTestId('integration-restricted').getAttribute('data-state')).toBe('denied'));
    expect(api).not.toHaveBeenCalled();
  });

  it('with the POS application off it stops after nav-state', async () => {
    owner();
    api.mockImplementation((path: string) => path === '/applications/nav-state'
      ? Promise.resolve({ data: { 'sales.pos': false } })
      : Promise.reject(new Error(`unexpected ${path}`)));
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');

    await waitFor(() => expect(screen.getByTestId('integration-restricted').getAttribute('data-state')).toBe('app_off'));
    expect(api.mock.calls.map((c) => c[0])).toEqual(['/applications/nav-state']);
  });

  it('internal evidence shows only when the server sent it (owner/admin), and never otherwise', async () => {
    owner();
    backend({ data: TODAY });
    const { unmount } = renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');
    expect((await screen.findByTestId('detail-advanced')).textContent).toContain('OWNER_GATE');
    unmount();

    currentUser.mockReturnValue({ id: 'u2', role: 'accountant', permissions: ['invoices.view', 'reports.view'] });
    backend({ data: PUBLIC });
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');
    await screen.findByTestId('capability-ladder');
    expect(screen.queryByTestId('detail-advanced')).toBeNull();
    expect(document.body.textContent).not.toContain('OWNER_GATE');
    // محاسب: لا إعداد ملف (company.manage) ولا صندوق توصيل (delivery_hub.view)، ويبقى تقرير القناة (reports.view).
    const hrefs = Array.from(screen.getByTestId('works-today').querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/reports/sales/delivery-channel']);
  });

  // مصفوفة الأدوار من الطرف إلى الطرف عبر الـhook: قوائم الصلاحيات كما يرسلها الخادم (`Rbac::MATRIX`
  // للمفاتيح الثلاثة)، وليس الدور: owner/admin `*`، والمحاسب والموظف `invoices.view` + `reports.view` فقط.
  it.each([
    ['owner', ['*'], ['/delivery-platforms', '/delivery-hub', '/reports/sales/delivery-channel']],
    ['admin', ['*'], ['/delivery-platforms', '/delivery-hub', '/reports/sales/delivery-channel']],
    ['accountant', ['invoices.view', 'invoices.manage', 'reports.view', 'branches.view'], ['/reports/sales/delivery-channel']],
    ['staff', ['invoices.view', 'reports.view', 'branches.view'], ['/reports/sales/delivery-channel']],
    ['custom (company.manage only)', ['invoices.view', 'company.manage'], ['/delivery-platforms']],
    ['custom (delivery_hub.view only)', ['invoices.view', 'delivery_hub.view'], ['/delivery-hub']],
    ['custom (invoices.view only)', ['invoices.view'], []],
  ])('role matrix through the hook — %s', async (role, permissions, hrefs) => {
    currentUser.mockReturnValue({ id: 'u9', role, permissions });
    backend({ data: PUBLIC });
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');

    await screen.findByTestId('capability-ladder');
    const links = Array.from(screen.getByTestId('works-today').querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(hrefs);
    // قيمة الإسناد اليدوي (A) تظهر للجميع أياً كانت الروابط المتاحة.
    expect(step('a')).toBe(m.ladder.a.set);
  });

  it('a role with a stored permission list that omits company.manage never gets the setup link even if its role name is admin', async () => {
    currentUser.mockReturnValue({ id: 'u10', role: 'admin', permissions: ['invoices.view', 'reports.view'] });
    backend({ data: PUBLIC });
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');

    await screen.findByTestId('capability-ladder');
    expect(screen.getByTestId('works-today').querySelector('a[href="/delivery-platforms"]')).toBeNull();
    expect(screen.getByTestId('setup-needs-permission')).toBeTruthy();
  });

  it('self-service: no data request and no links at all', async () => {
    currentUser.mockReturnValue({ id: 'u11', role: 'self_service', permissions: ['self_service.access'] });
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');

    await waitFor(() => expect(screen.getByTestId('integration-restricted').getAttribute('data-state')).toBe('denied'));
    expect(api).not.toHaveBeenCalled();
    expect(screen.queryByTestId('works-today')).toBeNull();
    const gated = ['/delivery-platforms', '/delivery-hub', '/reports/sales/delivery-channel'];
    expect(screen.queryAllByRole('link').filter((link) => gated.includes(link.getAttribute('href') ?? ''))).toHaveLength(0);
  });

  it('a failed read is unreadable with an alert, never "not available"', async () => {
    owner();
    api.mockImplementation((path: string) => path === '/applications/nav-state'
      ? Promise.resolve({ data: {} })
      : Promise.reject(new Error('down')));
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');

    await screen.findByRole('alert');
    expect(step('a')).toBe(m.ladder.a.unreadable);
    expect(step('b')).toBe(m.ladder.b.unreadable);
    expect(document.body.textContent).not.toContain(m.ladder.b.unavailable);
  });

  it('a platform absent from a readable readiness payload is unreadable, not "not available"', async () => {
    owner();
    backend({ data: TODAY.filter((row) => row.platform_key !== 'keeta') });
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');

    await screen.findByTestId('capability-ladder');
    expect(step('b')).toBe(m.ladder.b.unreadable);
  });
});
