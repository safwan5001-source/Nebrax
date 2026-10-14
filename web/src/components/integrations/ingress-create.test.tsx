// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryPlatformDetailScreen } from './delivery-platform-detail-screen';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES } from '@/test-utils/intl';

const { api, currentUser } = vi.hoisted(() => ({ api: vi.fn(), currentUser: vi.fn() }));

vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/auth', () => ({ currentUser }));

/**
 * INT-UX-5c: إنشاء نقطة استقبال موقّعة من تفاصيل المنصة. الخادم مُحاكى بحالة قابلة للتعديل (تظهر النقطة المُنشأة في القائمة)
 * كي تُختبر إعادة القراءة والتسوية فعلاً. هذه اختبارات واجهة بـAPI معترَض، لا إثبات تشغيل على Backend حقيقي.
 */
/** النص المعتمد حرفياً لنتيجة إنشاء لم تتأكد (مراجعة PR #1463). */
const UNCONFIRMED = {
  ar: 'تعذّر تأكيد نتيجة الإنشاء. لا تُعِد المحاولة قبل التحقق من نقطة الاستقبال أو التواصل مع المسؤول.',
  en: 'The creation result could not be confirmed. Do not retry until the ingress point has been verified or an administrator has been contacted.',
} as const;
/** عبارات تدّعي أن الإنشاء فشل أو لم يحدث: ممنوعة عند غياب النقطة عن القائمة. */
const CLAIMS_FAILURE = /not created|was not|did not create|failed to create|nothing was created|لم تُنشأ|لم يتم الإنشاء|فشل الإنشاء|لم تظهر/i;
const NEW_SECRET = 'dsec_SENTINEL_CREATED_SECRET_0123456789abcdef';
const SERVER_TEXT = 'RAW_SERVER_TEXT_MUST_NEVER_BE_SHOWN';
const PROFILE_ID = 'prof-keeta-1';

const READINESS = ['hungerstation', 'jahez', 'mrsool', 'keeta', 'ninja', 'the_chefz'].map((platform_key) => ({
  platform_key, ux_state: 'NOT_SUPPORTED', technical: 'BLOCKED', connect_enabled: false, sync_enabled: false, evidence_date: '2026-10-11', evidence_ref: 'docs/x.md',
}));

const row = (over: Record<string, unknown> = {}) => ({
  id: 'ing-1', delivery_platform_profile_id: PROFILE_ID, platform_key: 'keeta', external_store_id: 'Existing-1', branch_id: null,
  configured_by: 'u', operated_by: 'u', status: 'configured', secret_prefix: 'x', secret_version: 3, disabled_at: null, created_at: '2026-10-01T08:00:00Z', ...over,
});

type Outcome = unknown | (() => unknown);
let rows: ReturnType<typeof row>[];
let profiles: unknown;
let branches: Outcome;
let create: Outcome;
let listGate: (() => Promise<void>) | null;
let listFails: boolean;
/** ما يفعله الخادم المحاكى بعد استقبال طلب الإنشاء، بصرف النظر عن وصول الاستجابة. */
let serverCreates: boolean;
/** الخادم أنشأ النقطة لكنها خارج نطاق فروع المستخدم فلا تظهر في قائمته (تقييد الفروع). */
let createdHiddenFromList: boolean;

const settle = (outcome: Outcome) => Promise.resolve(typeof outcome === 'function' ? (outcome as () => unknown)() : outcome);

function installBackend() {
  api.mockImplementation((path: string, options?: { method?: string; body?: Record<string, string> }) => {
    if (path === '/applications/nav-state') return Promise.resolve({ data: { 'sales.pos': true } });
    if (path === '/delivery-platforms') return Promise.resolve(profiles);
    if (path === '/delivery-platforms/readiness') return Promise.resolve({ data: READINESS });
    if (path === '/branches') return settle(branches);
    if (path === '/delivery-connectors' && !options) {
      if (listFails) return Promise.reject(Object.assign(new Error('down'), { status: 500 }));
      const snapshot = rows.filter((r) => !(r as { hidden?: boolean }).hidden).map((r) => ({ ...r }));
      return (listGate ? listGate() : Promise.resolve()).then(() => ({ data: snapshot }));
    }
    if (path === '/delivery-connectors' && options?.method === 'POST') {
      // الخادم يُنشئ عند الاستقبال بصرف النظر عن وصول الاستجابة (هذا هو الغموض الذي نختبره).
      if (serverCreates) {
        rows.push(row({ id: 'ing-new', external_store_id: String(options.body?.external_store_id), branch_id: options.body?.branch_id ?? null, secret_version: 1, hidden: createdHiddenFromList }));
      }
      return settle(create);
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

const posts = () => api.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === 'POST');
const listReads = () => api.mock.calls.filter((c) => c[0] === '/delivery-connectors' && c.length === 1).length;
const asOwner = () => currentUser.mockReturnValue({ id: 'u1', role: 'owner', permissions: ['*'] });
const asUser = (permissions: string[]) => currentUser.mockReturnValue({ id: 'u2', role: 'custom', permissions });
const VIEW = ['invoices.view', 'delivery_connector.view'];
const httpError = (status: number, body: unknown = { message: SERVER_TEXT }) => () => Promise.reject(Object.assign(new Error(SERVER_TEXT), { status, body }));
const networkError = () => () => Promise.reject(new TypeError('Failed to fetch'));
const created = () => ({ data: { id: 'ing-new', status: 'configured', secret_version: 1 }, secret: NEW_SECRET });
const activeProfile = (extra: Record<string, unknown> = {}) => ({ data: [{ id: PROFILE_ID, platform_key: 'keeta', is_active: true, ...extra }] });

async function mount(locale: 'ar' | 'en' = 'en') {
  renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, locale);
  await waitFor(() => expect(screen.getByTestId('signed-ingress-panel').getAttribute('data-state')).toBe('ready'));
  return TEST_MESSAGES[locale].integrationCenter.ingressManagement;
}

const openCreate = () => fireEvent.click(screen.getByTestId('ingress-create-open'));
const storeInput = () => screen.getByTestId('ingress-create-store-id') as HTMLInputElement;
const typeStore = (value: string) => fireEvent.change(storeInput(), { target: { value } });
const submit = () => fireEvent.click(screen.getByTestId('ingress-create-submit'));
const dialogOf = (name: string | RegExp) => screen.getByRole('dialog', { name });

let storageWrites: ReturnType<typeof vi.spyOn>;
let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  api.mockReset();
  currentUser.mockReset();
  rows = [row()];
  profiles = activeProfile();
  branches = { data: [{ id: 'br-1', name: 'Dammam Branch', is_active: true }, { id: 'br-2', name: 'Khobar Branch', is_active: true }, { id: 'br-3', name: 'Closed Branch', is_active: false }] };
  create = created;
  listGate = null;
  listFails = false;
  serverCreates = true;
  createdHiddenFromList = false;
  localStorage.clear();
  installBackend();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  storageWrites = vi.spyOn(Storage.prototype, 'setItem');
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.body.style.overflow = ''; });

describe('who can create, and the manual-profile gate (absent, never disabled)', () => {
  it('owner with an active manual profile sees the create action, also when the list is empty', async () => {
    asOwner();
    rows = [];
    await mount();
    expect(screen.getByTestId('signed-ingress-empty')).toBeTruthy();
    expect(screen.getByTestId('ingress-create-open')).toBeTruthy();
    expect(screen.queryByTestId('ingress-create-guidance')).toBeNull();
  });

  it('delivery_connector.manage alone is enough; a viewer without it sees neither the action nor any guidance', async () => {
    asUser([...VIEW, 'delivery_connector.manage']);
    await mount();
    expect(screen.getByTestId('ingress-create-open')).toBeTruthy();
    cleanup();
    asUser(VIEW);
    await mount();
    expect(screen.queryByTestId('ingress-create-open')).toBeNull();
    expect(screen.queryByTestId('ingress-create-guidance')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('reassign alone gives no create action', async () => {
    asUser([...VIEW, 'delivery_connector.reassign', 'users.view']);
    await mount();
    expect(screen.queryByTestId('ingress-create-open')).toBeNull();
  });

  it('demo (preview) mode shows no create action and sends no write', async () => {
    asOwner();
    localStorage.setItem('demo', 'true');
    await mount();
    expect(screen.queryByTestId('ingress-create-open')).toBeNull();
    expect(screen.queryByTestId('ingress-create-guidance')).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it.each(TEST_LOCALES)('without an active manual profile it explains and links to the existing setup — it creates no profile (%s)', async (locale) => {
    asOwner();
    profiles = { data: [] };
    const m = await mount(locale);
    const guidance = screen.getByTestId('ingress-create-guidance');
    expect(guidance.getAttribute('data-state')).toBe('missing');
    expect(guidance.textContent).toContain(m.create.guidance.title);
    expect(within(guidance).getByRole('link').getAttribute('href')).toBe('/delivery-platforms');
    expect(screen.queryByTestId('ingress-create-open')).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it('a disabled profile gets its own guidance; no company.manage means no link, only the permission note', async () => {
    asUser([...VIEW, 'delivery_connector.manage']);
    profiles = { data: [{ id: PROFILE_ID, platform_key: 'keeta', is_active: false }] };
    await mount();
    expect(screen.getByTestId('ingress-create-guidance').getAttribute('data-state')).toBe('disabled');
    expect(within(screen.getByTestId('ingress-create-guidance')).queryByRole('link')).toBeNull();
    expect(screen.getByTestId('ingress-create-setup-needs-permission')).toBeTruthy();
    expect(screen.queryByTestId('ingress-create-open')).toBeNull();
  });

  it('an unreadable profile read is not "no profile": guidance says so, with no create action and no setup link', async () => {
    asOwner();
    profiles = { data: [{ id: PROFILE_ID, platform_key: 'keeta', is_active: 'yes' }] };
    await mount();
    const guidance = screen.getByTestId('ingress-create-guidance');
    expect(guidance.getAttribute('data-state')).toBe('unreadable');
    expect(within(guidance).queryByRole('link')).toBeNull();
    expect(screen.queryByTestId('ingress-create-open')).toBeNull();
  });
});

describe.each(TEST_LOCALES)('the create form (%s)', (locale) => {
  it('shows the platform context and the boundary, and sends nothing until submitted or when cancelled', async () => {
    asOwner();
    const m = await mount(locale);
    openCreate();
    const dialog = dialogOf(m.create.title);
    expect(dialog.textContent).toContain(m.create.boundary);
    expect(storeInput().getAttribute('dir')).toBe('ltr');
    expect(storeInput().getAttribute('autocomplete')).toBe('off');
    expect(posts()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: m.common.cancel }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it.each([
    ['empty', '', 'required'],
    ['whitespace only', '   ', 'required'],
    ['control characters', 'Store\u0007100', 'invalidChars'],
    ['over 191 bytes (Arabic is two bytes per letter)', 'م'.repeat(100), 'tooLong'],
    ['over 191 ASCII bytes', 'a'.repeat(192), 'tooLong'],
  ] as const)('validates the store ID before sending: %s', async (_name, value, problem) => {
    asOwner();
    const m = await mount(locale);
    openCreate();
    await screen.findByTestId('ingress-create-branch');
    typeStore(value);
    submit();
    expect(screen.getByTestId('ingress-create-store-id-error').textContent).toBe(m.create.validation[problem]);
    expect(posts()).toHaveLength(0);
  });

  it('accepts exactly 191 bytes, and trims surrounding spaces before sending', async () => {
    asOwner();
    await mount(locale);
    openCreate();
    await screen.findByTestId('ingress-create-branch');
    typeStore(`  ${'a'.repeat(191)}  `);
    submit();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][1]).toEqual({ method: 'POST', body: { delivery_platform_profile_id: PROFILE_ID, external_store_id: 'a'.repeat(191) } });
  });

  it('offers only active branches from the user\'s own list, plus "no branch"; the request carries the chosen branch', async () => {
    asOwner();
    const m = await mount(locale);
    openCreate();
    const select = await screen.findByTestId('ingress-create-branch');
    const labels = Array.from((select as HTMLSelectElement).options).map((o) => o.textContent);
    expect(labels).toEqual([m.create.branch.none, 'Dammam Branch', 'Khobar Branch']);
    typeStore('Store-100');
    fireEvent.change(select, { target: { value: 'br-2' } });
    submit();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toBe('/delivery-connectors');
    expect(posts()[0][1]).toEqual({ method: 'POST', body: { delivery_platform_profile_id: PROFILE_ID, external_store_id: 'Store-100', branch_id: 'br-2' } });
  });

  it('without branches.view there is no branch field, the reason is shown, and no branch is sent', async () => {
    asUser([...VIEW, 'delivery_connector.manage']);
    const m = await mount(locale);
    openCreate();
    expect(screen.getByTestId('ingress-create-branch-unavailable').textContent).toBe(m.create.branch.noPermission);
    expect(screen.queryByTestId('ingress-create-branch')).toBeNull();
    expect(api.mock.calls.some((c) => c[0] === '/branches')).toBe(false);
    typeStore('Store-100');
    submit();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect((posts()[0][1] as { body: Record<string, string> }).body).not.toHaveProperty('branch_id');
  });

  it('a failed branch read blocks submission (no silent unrouted point) and offers a read retry', async () => {
    asOwner();
    branches = httpError(500);
    const m = await mount(locale);
    openCreate();
    const error = await screen.findByTestId('ingress-create-branch-error');
    expect(error.textContent).toContain(m.create.branch.error);
    typeStore('Store-100');
    submit();
    expect(posts()).toHaveLength(0);
    branches = { data: [{ id: 'br-1', name: 'Dammam Branch', is_active: true }] };
    fireEvent.click(within(error).getByRole('button', { name: m.create.branch.retry }));
    await screen.findByTestId('ingress-create-branch');
    submit();
    await waitFor(() => expect(posts()).toHaveLength(1));
  });

  it('Enter inside the store ID field submits once', async () => {
    asOwner();
    await mount(locale);
    openCreate();
    await screen.findByTestId('ingress-create-branch');
    typeStore('Store-100');
    fireEvent.keyDown(storeInput(), { key: 'Enter' });
    await waitFor(() => expect(posts()).toHaveLength(1));
  });
});

describe.each(TEST_LOCALES)('creating (%s)', (locale) => {
  it('shows the secret once (masked, locked), refreshes the list only after the dialog is closed, and leaves no trace of the secret', async () => {
    asOwner();
    const m = await mount(locale);
    openCreate();
    await screen.findByTestId('ingress-create-branch');
    typeStore('Store-100');
    const before = listReads();
    submit();

    const reveal = await screen.findByRole('dialog', { name: m.secret.title });
    expect(reveal.textContent).toContain('Store-100');
    expect(reveal.textContent).toContain(m.secret.warning);
    expect(document.body.innerHTML).not.toContain(NEW_SECRET);
    // قفل الإغلاق: لا X، وEscape لا يغلق ويُظهر التلميح.
    expect(within(reveal).queryByRole('button', { name: /close|إغلاق/i })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: m.secret.title })).toBeTruthy();
    expect(screen.getByTestId('secret-dismiss-hint').textContent).toBe(m.secret.confirmHint);
    // القائمة لم تُحدَّث خلف السرّ.
    expect(listReads()).toBe(before);

    fireEvent.click(within(reveal).getByRole('button', { name: m.secret.reveal }));
    expect(within(reveal).getByText(NEW_SECRET)).toBeTruthy();
    fireEvent.click(within(reveal).getByRole('checkbox'));
    const done = within(reveal).getAllByRole('button', { name: m.secret.confirm }).find((b) => !(b as HTMLButtonElement).disabled) as HTMLElement;
    fireEvent.click(done);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await waitFor(() => expect(listReads()).toBeGreaterThan(before));
    expect(screen.getByTestId('ingress-management-notice').textContent).toContain(m.notices.created.replace('{storeId}', 'Store-100'));
    await waitFor(() => expect(screen.getByTestId('signed-ingress-panel').textContent).toContain('Store-100'));
    expect(document.body.innerHTML).not.toContain(NEW_SECRET);
    expect(storageWrites.mock.calls.flat().join('|')).not.toContain(NEW_SECRET);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    for (const spy of consoleSpies) expect(JSON.stringify(spy.mock.calls)).not.toContain(NEW_SECRET);
    expect(window.location.href).not.toContain(NEW_SECRET);
    expect(posts()).toHaveLength(1);
  });

  it('a double submit sends one request, and the form cannot be closed or edited while it runs', async () => {
    asOwner();
    let release: (v: unknown) => void = () => {};
    create = () => new Promise((resolve) => { release = resolve; });
    const m = await mount(locale);
    openCreate();
    await screen.findByTestId('ingress-create-branch');
    typeStore('Store-100');
    const button = screen.getByTestId('ingress-create-submit');
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(posts()).toHaveLength(1);

    const dialog = dialogOf(m.create.title);
    await within(dialog).findByRole('button', { name: m.create.busy });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: m.create.title })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /close|إغلاق/i })).toBeNull();
    expect((within(dialog).getByRole('button', { name: m.common.cancel }) as HTMLButtonElement).disabled).toBe(true);
    expect(storeInput().disabled).toBe(true);
    fireEvent.click(document.querySelector('[aria-hidden="true"].absolute') as HTMLElement);
    expect(screen.getByRole('dialog', { name: m.create.title })).toBeTruthy();

    await act(async () => { release(created()); });
    await screen.findByRole('dialog', { name: m.secret.title });
    expect(posts()).toHaveLength(1);
  });

  it.each([
    [409, { error_code: 'mapping_ambiguous', message: SERVER_TEXT }, 'mappingAmbiguous'],
    [422, { error_code: 'branch_required', message: SERVER_TEXT }, 'branchRequired'],
    [422, { error_code: 'invalid_store', message: SERVER_TEXT }, 'invalidStore'],
    [422, { error_code: 'branch_inactive', message: SERVER_TEXT }, 'branchInactive'],
    [404, { error_code: 'branch_unavailable', message: SERVER_TEXT }, 'branchUnavailable'],
    [404, { error_code: 'profile_unavailable', message: SERVER_TEXT }, 'profileUnavailable'],
    [403, { message: SERVER_TEXT }, 'forbidden'],
    [404, { message: SERVER_TEXT }, 'notFound'],
    [422, { message: SERVER_TEXT, errors: { external_store_id: ['x'] } }, 'validation'],
  ] as const)('an explicit refusal (%s %j) keeps the form open with a fixed message, never the server text', async (status, body, key) => {
    asOwner();
    create = httpError(status, body);
    serverCreates = false;
    const m = await mount(locale);
    openCreate();
    await screen.findByTestId('ingress-create-branch');
    typeStore('Store-100');
    submit();
    const error = await screen.findByTestId('ingress-create-error');
    expect(error.textContent).toBe(m.errors[key]);
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
    expect(screen.getByRole('dialog', { name: m.create.title })).toBeTruthy();
    expect(posts()).toHaveLength(1);
    // لم يُنشأ شيء، فالتصحيح وإرسال جديد بقصد المستخدم جائزان (ليس إعادة محاولة عمياء).
    create = created;
    typeStore('Store-101');
    submit();
    await screen.findByRole('dialog', { name: m.secret.title });
    expect(posts()).toHaveLength(2);
  });
});

describe.each(TEST_LOCALES)('an unknown outcome (%s)', (locale) => {
  it.each([
    ['network failure', networkError()],
    ['502', httpError(502)],
    ['a 2xx without a readable secret', () => ({ data: { id: 'ing-new' } })],
    ['a 2xx with an empty secret', () => ({ data: {}, secret: '' })],
  ] as const)('%s: one request, no retry control, the list is re-read, and a point that did appear is reported as "secret lost"', async (_name, outcome) => {
    asOwner();
    create = outcome;
    serverCreates = true;
    const m = await mount(locale);
    const before = listReads();
    openCreate();
    await screen.findByTestId('ingress-create-branch');
    typeStore('Store-100');
    submit();

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(listReads()).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getByTestId('ingress-management-notice').getAttribute('data-kind')).toBe('createLost'));
    const notice = screen.getByTestId('ingress-management-notice');
    expect(notice.textContent).toContain(m.notices.createLost.replace('{storeId}', 'Store-100'));
    expect(within(notice).getAllByRole('button')).toHaveLength(1);
    expect(within(notice).queryByText(/retry|try again|إعادة المحاولة/i)).toBeNull();
    expect(document.body.innerHTML).not.toContain(NEW_SECRET);
    // لا تدوير تلقائي ولا طلب ثانٍ، والنقطة الجديدة تحمل زرّ التدوير المعتمد (5b) ليقرّر المستخدم.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(posts()).toHaveLength(1);
    expect(api.mock.calls.some((c) => String(c[0]).includes('rotate-secret'))).toBe(false);
    const newRow = screen.getAllByTestId('signed-ingress-row').find((el) => el.textContent?.includes('Store-100')) as HTMLElement;
    expect(within(newRow).getByTestId('ingress-rotate')).toBeTruthy();
  });

  it.each([
    ['the server did create it but the user\'s branch scope hides it from the list', true, true],
    ['the server really did not create it', false, false],
  ] as const)('a fresh list WITHOUT the point never means the creation failed (%s): one neutral, identical "could not be confirmed" notice, no failure claim, no retry', async (_name, serverCreated, hidden) => {
    asOwner();
    create = networkError();
    serverCreates = serverCreated;
    createdHiddenFromList = hidden;
    const m = await mount(locale);
    const before = listReads();
    openCreate();
    await screen.findByTestId('ingress-create-branch');
    typeStore('Store-100');
    submit();

    await waitFor(() => expect(screen.getByTestId('ingress-management-notice').getAttribute('data-kind')).toBe('createUnconfirmed'));
    await waitFor(() => expect(listReads()).toBeGreaterThan(before));
    const notice = screen.getByTestId('ingress-management-notice');
    expect(notice.getAttribute('role')).toBe('alert');
    expect(m.notices.createUnconfirmed).toBe(UNCONFIRMED[locale]);
    expect(notice.textContent).toContain(UNCONFIRMED[locale]);
    // لا ادّعاء فشل، ولا «السرّ ضاع»، ولا زر إعادة محاولة، ولا تدوير تلقائي، ولا طلب ثانٍ.
    expect(notice.textContent).not.toMatch(CLAIMS_FAILURE);
    expect(notice.getAttribute('data-kind')).not.toBe('createLost');
    expect(within(notice).getAllByRole('button')).toHaveLength(1);
    expect(within(notice).queryByText(/retry again|try again|إعادة المحاولة/i)).toBeNull();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(posts()).toHaveLength(1);
    expect(api.mock.calls.some((c) => String(c[0]).includes('rotate-secret'))).toBe(false);
    expect(document.body.innerHTML).not.toContain(NEW_SECRET);
  });

  it('the stale list shown at the moment of failure never decides the outcome: nothing is reported until the re-read finishes', async () => {
    asOwner();
    create = networkError();
    serverCreates = true;
    const m = await mount(locale);
    openCreate();
    await screen.findByTestId('ingress-create-branch');
    typeStore('Store-100');
    let releaseList: () => void = () => {};
    listGate = () => new Promise<void>((resolve) => { releaseList = resolve; });
    submit();
    await waitFor(() => expect(screen.getByTestId('signed-ingress-panel').getAttribute('data-state')).toBe('loading'));
    const notice = screen.getByTestId('ingress-management-notice');
    expect(notice.getAttribute('data-kind')).toBe('error');
    expect(notice.textContent).toContain(m.errors.outcomeUnknown);
    expect(screen.queryByTestId('ingress-create-open')).toBeNull();
    await act(async () => { releaseList(); });
    await waitFor(() => expect(screen.getByTestId('ingress-management-notice').getAttribute('data-kind')).toBe('createLost'));
  });

  it('if the re-read itself fails the "outcome unknown" notice stays, and nothing is claimed', async () => {
    asOwner();
    create = networkError();
    const m = await mount(locale);
    openCreate();
    await screen.findByTestId('ingress-create-branch');
    typeStore('Store-100');
    listFails = true;
    submit();
    await waitFor(() => expect(screen.getByTestId('signed-ingress-panel').getAttribute('data-state')).toBe('error'));
    const notice = screen.getByTestId('ingress-management-notice');
    expect(notice.getAttribute('data-kind')).toBe('error');
    expect(notice.textContent).toContain(m.errors.outcomeUnknown);
    expect(posts()).toHaveLength(1);
  });

  it('a pre-existing point with the same store ID is not mistaken for the lost creation', async () => {
    asOwner();
    rows = [row({ external_store_id: 'Store-100' })];
    create = httpError(503);
    serverCreates = false;
    await mount(locale);
    openCreate();
    await screen.findByTestId('ingress-create-branch');
    typeStore('Store-100');
    submit();
    await waitFor(() => expect(screen.getByTestId('ingress-management-notice').getAttribute('data-kind')).toBe('createUnconfirmed'));
    expect(screen.queryByText(TEST_MESSAGES[locale].integrationCenter.ingressManagement.notices.createLost.replace('{storeId}', 'Store-100'))).toBeNull();
  });
});

describe('wording', () => {
  it.each(TEST_LOCALES)('the create copy never claims a native connection, a linked merchant account or synchronization (%s)', (locale) => {
    const text = JSON.stringify(TEST_MESSAGES[locale].integrationCenter.ingressManagement.create) + JSON.stringify(TEST_MESSAGES[locale].integrationCenter.ingressManagement.notices);
    const phrases = ['متصل بالمنصة', 'حساب التاجر مرتبط', 'المزامنة مفعّلة', 'جاهز للتكامل الأصلي', 'connected to the platform', 'merchant account is linked', 'sync is enabled', 'ready for native integration'];
    for (const phrase of phrases) expect(text, phrase).not.toContain(phrase);
  });
});
