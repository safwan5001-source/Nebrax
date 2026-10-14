// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryPlatformDetailScreen } from './delivery-platform-detail-screen';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES } from '@/test-utils/intl';

const { api, currentUser } = vi.hoisted(() => ({ api: vi.fn(), currentUser: vi.fn() }));

vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/auth', () => ({ currentUser }));

const READINESS = ['hungerstation', 'jahez', 'mrsool', 'keeta', 'ninja', 'the_chefz'].map((platform_key) => ({
  platform_key, ux_state: 'NOT_SUPPORTED', technical: 'BLOCKED', connect_enabled: false, sync_enabled: false, evidence_date: '2026-10-11', evidence_ref: 'docs/x.md',
}));

const SECRET_SENTINELS = ['SENTINEL_PREFIX_ab12', 'SENTINEL_SECRET_value', 'SENTINEL_TOKEN', 'SENTINEL_KEY', 'SENTINEL_OPERATOR_ID', 'SENTINEL_ACCOUNT_ID', 'SENTINEL_PROFILE_ID'];

const account = (over: Record<string, unknown> = {}) => ({
  id: 'SENTINEL_ACCOUNT_ID',
  delivery_platform_profile_id: 'SENTINEL_PROFILE_ID',
  platform_key: 'keeta',
  external_store_id: 'store-100',
  branch_id: 'br-1',
  configured_by: 'SENTINEL_OPERATOR_ID',
  operated_by: 'SENTINEL_OPERATOR_ID',
  status: 'configured',
  secret_prefix: 'SENTINEL_PREFIX_ab12',
  secret_version: 3,
  disabled_at: null,
  created_at: '2026-10-01T08:00:00Z',
  ...over,
});

type Reply = unknown | (() => Promise<unknown>);
function backend(opts: { connectors?: Reply; branches?: Reply; navState?: unknown } = {}) {
  api.mockImplementation((path: string) => {
    const reply = (r: Reply) => (typeof r === 'function' ? (r as () => Promise<unknown>)() : Promise.resolve(r));
    if (path === '/applications/nav-state') return Promise.resolve(opts.navState ?? { data: { 'sales.pos': true } });
    if (path === '/delivery-platforms') return Promise.resolve({ data: [] });
    if (path === '/delivery-platforms/readiness') return Promise.resolve({ data: READINESS });
    if (path === '/delivery-connectors') return reply(opts.connectors ?? { data: [account()] });
    if (path === '/branches') return reply(opts.branches ?? { data: [{ id: 'br-1', name: 'Dammam Branch' }, { id: 'br-2', name: 'Khobar Branch' }] });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}
const paths = () => api.mock.calls.map((c) => c[0] as string);
const asOwner = () => currentUser.mockReturnValue({ id: 'u1', role: 'owner', permissions: ['*'] });
const asUser = (permissions: string[], role = 'custom') => currentUser.mockReturnValue({ id: 'u2', role, permissions });
const forbidden = () => () => Promise.reject(Object.assign(new Error('forbidden'), { status: 403 }));
const failing = () => () => Promise.reject(Object.assign(new Error('boom'), { status: 500 }));

beforeEach(() => { api.mockReset(); currentUser.mockReset(); });
afterEach(cleanup);

describe('SignedIngressPanel on the platform detail screen', () => {
  it.each(TEST_LOCALES)('lists the platform ingress points read-only (viewer without manage) with authorized branch names (%s)', async (locale) => {
    asUser(['invoices.view', 'delivery_connector.view', 'branches.view']);
    backend({ connectors: { data: [account(), account({ id: 'a2', branch_id: 'br-2', external_store_id: 'store-200', status: 'disabled', disabled_at: '2026-10-05T00:00:00Z' }), account({ id: 'a3', platform_key: 'jahez', external_store_id: 'other-platform' })] } });
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, locale);
    const m = TEST_MESSAGES[locale].integrationCenter.ingressPanel;

    const panel = await screen.findByTestId('signed-ingress-panel');
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('ready'));
    expect(within(panel).getByRole('heading', { level: 2 }).textContent).toBe(m.title);
    const rows = within(panel).getAllByTestId('signed-ingress-row');
    // الجدول والبطاقات كلاهما في DOM (CSS يخفي أحدهما): صفّان لكل منهما.
    expect(rows).toHaveLength(4);
    expect(panel.textContent).toContain('store-100');
    expect(panel.textContent).toContain('store-200');
    expect(panel.textContent).not.toContain('other-platform');
    expect(panel.textContent).toContain('Dammam Branch');
    expect(panel.textContent).toContain('Khobar Branch');
    expect(within(panel).getAllByText(m.status.configured).length).toBeGreaterThan(0);
    expect(within(panel).getAllByText(m.status.disabled).length).toBeGreaterThan(0);
    expect(panel.textContent).toContain(m.columns.version);
    expect(panel.textContent).toContain(m.branchNote);
    expect(panel.textContent).toContain(m.statusNote);
    // من لا يملك delivery_connector.manage: لوحة قراءة فقط، لا أزرار إطلاقاً (الإجراء غائب لا معطّل).
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByTestId('signed-ingress-readonly-note').textContent).toBe(m.readOnlyNote);
    expect(screen.queryByTestId('signed-ingress-manage-note')).toBeNull();
  });

  it('never puts a secret, prefix, key, token, operator id, profile id or ingress id into the DOM', async () => {
    asOwner();
    backend({ connectors: { data: [account({ secret: 'SENTINEL_SECRET_value', token: 'SENTINEL_TOKEN', signing_key: 'SENTINEL_KEY' })] } });
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');
    await waitFor(() => expect(screen.getByTestId('signed-ingress-panel').getAttribute('data-state')).toBe('ready'));

    const html = document.body.innerHTML;
    for (const sentinel of SECRET_SENTINELS) expect(html, sentinel).not.toContain(sentinel);
    // لا خاصية title/aria-label/data-* تحمل شيئاً من ذلك أيضاً (الفحص على كل المصدر المُصيَّر).
    expect(html).not.toMatch(/secret_prefix|configured_by|operated_by/);
  });

  it('performs only GET reads: every request has no options argument (no write, no body)', async () => {
    asOwner();
    backend();
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');
    await waitFor(() => expect(screen.getByTestId('signed-ingress-panel').getAttribute('data-state')).toBe('ready'));
    expect(paths().sort()).toEqual(['/applications/nav-state', '/branches', '/delivery-connectors', '/delivery-platforms', '/delivery-platforms/readiness']);
    for (const call of api.mock.calls) expect(call, String(call[0])).toHaveLength(1);
  });

  it('without branches.view: no /branches request, neutral branch text, no name and no id', async () => {
    asUser(['invoices.view', 'delivery_connector.view']);
    backend();
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');
    const panel = await screen.findByTestId('signed-ingress-panel');
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('ready'));

    expect(paths()).not.toContain('/branches');
    expect(panel.textContent).toContain(TEST_MESSAGES.en.integrationCenter.ingressPanel.branch.routed);
    expect(panel.textContent).not.toMatch(/Dammam|Khobar|br-1/);
  });

  it('with branches.view but a branch outside the readable list shows "not available", never the id', async () => {
    asUser(['invoices.view', 'delivery_connector.view', 'branches.view']);
    backend({ connectors: { data: [account({ branch_id: 'br-9' })] } });
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');
    const panel = await screen.findByTestId('signed-ingress-panel');
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('ready'));
    expect(panel.textContent).toContain(TEST_MESSAGES.en.integrationCenter.ingressPanel.branch.unavailable);
    expect(panel.textContent).not.toContain('br-9');
  });

  it('a failed /branches read degrades only the branch text, not the panel', async () => {
    asOwner();
    backend({ branches: failing() });
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');
    const panel = await screen.findByTestId('signed-ingress-panel');
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('ready'));
    expect(panel.textContent).toContain('store-100');
    expect(panel.textContent).toContain(TEST_MESSAGES.en.integrationCenter.ingressPanel.branch.unavailable);
  });

  it('does not request /branches when no point is routed, and shows the unrouted text', async () => {
    asOwner();
    backend({ connectors: { data: [account({ branch_id: null })] } });
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');
    const panel = await screen.findByTestId('signed-ingress-panel');
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('ready'));
    expect(paths()).not.toContain('/branches');
    expect(panel.textContent).toContain(TEST_MESSAGES.en.integrationCenter.ingressPanel.branch.unrouted);
  });

  it('without delivery_connector.view the panel is absent and no connector request is made', async () => {
    asUser(['invoices.view', 'reports.view', 'branches.view'], 'accountant');
    backend();
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');
    await screen.findByTestId('capability-ladder');
    await waitFor(() => expect(paths()).toContain('/delivery-platforms/readiness'));
    expect(screen.queryByTestId('signed-ingress-panel')).toBeNull();
    expect(paths()).not.toContain('/delivery-connectors');
    expect(paths()).not.toContain('/branches');
  });

  it('with the POS application off the connector list is never requested', async () => {
    asOwner();
    backend({ navState: { data: { 'sales.pos': false } } });
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');
    await waitFor(() => expect(screen.getByTestId('integration-restricted').getAttribute('data-state')).toBe('app_off'));
    expect(paths()).toEqual(['/applications/nav-state']);
    expect(screen.queryByTestId('signed-ingress-panel')).toBeNull();
  });

  it.each(TEST_LOCALES)('a real empty result is a distinct, honest empty state (%s)', async (locale) => {
    asOwner();
    backend({ connectors: { data: [account({ platform_key: 'jahez' })] } });
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, locale);
    const empty = await screen.findByTestId('signed-ingress-empty');
    const m = TEST_MESSAGES[locale].integrationCenter.ingressPanel;
    expect(empty.textContent).toContain(m.empty.body);
    expect(within(screen.getByTestId('signed-ingress-panel')).queryByRole('table')).toBeNull();
    expect(screen.queryByTestId('signed-ingress-error')).toBeNull();
  });

  it('a 403 from the server is "not available to you", never "no ingress points"', async () => {
    asOwner();
    backend({ connectors: forbidden() });
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');
    const note = await screen.findByTestId('signed-ingress-forbidden');
    expect(note.textContent).toBe(TEST_MESSAGES.en.integrationCenter.ingressPanel.forbidden);
    expect(screen.queryByTestId('signed-ingress-empty')).toBeNull();
    expect(screen.queryByTestId('signed-ingress-row')).toBeNull();
  });

  it.each([
    ['network/server failure', failing()],
    ['non-list payload', { data: 'nope' }],
    ['malformed row of this platform', { data: [account({ status: 'weird' })] }],
    ['malformed row envelope', { data: [null] }],
  ] as [string, Reply][])('%s is an error with retry, never an empty list', async (_label, connectors) => {
    asOwner();
    backend({ connectors });
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');
    const error = await screen.findByTestId('signed-ingress-error');
    expect(error.getAttribute('role')).toBe('alert');
    expect(screen.queryByTestId('signed-ingress-empty')).toBeNull();
    expect(screen.queryByTestId('signed-ingress-row')).toBeNull();
    expect(within(error).getAllByRole('button')).toHaveLength(1);
  });

  it('retry re-reads only the panel and recovers to the data', async () => {
    asOwner();
    let calls = 0;
    backend({ connectors: () => (++calls === 1 ? Promise.reject(new Error('down')) : Promise.resolve({ data: [account()] })) });
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');
    const error = await screen.findByTestId('signed-ingress-error');
    const before = paths().filter((p) => p === '/delivery-platforms').length;
    fireEvent.click(within(error).getByRole('button'));

    await waitFor(() => expect(screen.getByTestId('signed-ingress-panel').getAttribute('data-state')).toBe('ready'));
    expect(screen.getByTestId('signed-ingress-panel').textContent).toContain('store-100');
    expect(paths().filter((p) => p === '/delivery-platforms')).toHaveLength(before);
  });

  it('a permission lost mid-session is honored on the next read: the panel disappears and nothing is requested', async () => {
    asOwner();
    backend({ connectors: () => Promise.reject(new Error('down')) });
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');
    const error = await screen.findByTestId('signed-ingress-error');
    const before = paths().filter((p) => p === '/delivery-connectors').length;

    asUser(['invoices.view'], 'staff');
    fireEvent.click(within(error).getByRole('button'));

    await waitFor(() => expect(screen.queryByTestId('signed-ingress-panel')).toBeNull());
    expect(paths().filter((p) => p === '/delivery-connectors')).toHaveLength(before);
  });

  it('shows the loading state first, announced as a status', async () => {
    asOwner();
    let release: (value: unknown) => void = () => {};
    backend({ connectors: () => new Promise((resolve) => { release = resolve; }) });
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');
    const loading = await screen.findByTestId('signed-ingress-loading');
    expect(loading.getAttribute('role')).toBe('status');
    release({ data: [] });
    await screen.findByTestId('signed-ingress-empty');
  });

  it.each(TEST_LOCALES)('uses the approved term, states the routing boundary, and never claims a native connection (%s)', async (locale) => {
    asOwner();
    backend({ connectors: { data: [account(), account({ id: 'a2', status: 'disabled', external_store_id: 's2' })] } });
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, locale);
    const panel = await screen.findByTestId('signed-ingress-panel');
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('ready'));
    const m = TEST_MESSAGES[locale].integrationCenter.ingressPanel;
    const text = panel.textContent ?? '';

    expect(text).toContain(m.branchNote);
    expect(text).toContain(m.statusNote);
    const forbiddenPhrases = locale === 'ar'
      ? ['متصل بالمنصة', 'حساب التاجر مرتبط', 'المزامنة مفعّلة', 'جاهز للتكامل الأصلي', 'نشطة', 'متصلة بالمنصة']
      : ['connected to the platform', 'merchant account is linked', 'sync is enabled', 'ready for native integration', 'Active', 'Connected'];
    for (const phrase of forbiddenPhrases) expect(text, phrase).not.toContain(phrase);
    if (locale === 'ar') expect(m.title).toContain('نقاط استقبال الأحداث الموقّعة');
  });

  it('the configured status uses no green/positive styling (green is not a native-connection signal)', async () => {
    asOwner();
    backend();
    renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, 'en');
    await waitFor(() => expect(screen.getByTestId('signed-ingress-panel').getAttribute('data-state')).toBe('ready'));
    for (const badge of screen.getAllByTestId('signed-ingress-status')) expect(badge.className).not.toMatch(/positive|green/);
  });
});
