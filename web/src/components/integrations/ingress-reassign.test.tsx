// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryPlatformDetailScreen } from './delivery-platform-detail-screen';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES } from '@/test-utils/intl';

const { api, currentUser } = vi.hoisted(() => ({ api: vi.fn(), currentUser: vi.fn() }));

vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/auth', () => ({ currentUser }));

/**
 * INT-UX-5d: إعادة إسناد المشغّل المسؤول عن نقطة استقبال موقّعة. الخادم مُحاكى بحالة قابلة للتعديل (يتغيّر `operated_by` بعد النجاح)
 * كي تُختبر إعادة القراءة فعلاً. هذا اختبار بواجهة API معترَضة — لا يُثبت سلوك خادم حقيقي.
 */
const SERVER_TEXT = 'RAW_SERVER_TEXT_MUST_NEVER_BE_SHOWN';
const EMAIL_DOMAIN = 'leak-sentinel.test';
const SECRET_PREFIX = 'px_SENTINEL';

const READINESS = ['hungerstation', 'jahez', 'mrsool', 'keeta', 'ninja', 'the_chefz'].map((platform_key) => ({
  platform_key, ux_state: 'NOT_SUPPORTED', technical: 'BLOCKED', connect_enabled: false, sync_enabled: false, evidence_date: '2026-10-11', evidence_ref: 'docs/x.md',
}));

const person = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, email: `${id}@${EMAIL_DOMAIN}`, role: 'cashier', is_active: true, branch_ids: [], employee_id: `emp-${id}`, ...over,
});
const USERS = () => [
  person('u-self', 'Olga Current'),
  person('u-amal', 'Amal Free'),
  person('u-bader', 'Bader Branch1', { branch_ids: ['br-1'] }),
  person('u-cara', 'Cara Branch2', { branch_ids: ['br-2'] }),
  person('u-dina', 'Dina Inactive', { is_active: false }),
];

type Row = Record<string, unknown> & { id: string; operated_by: string | null; status: string; branch_id: string | null; secret_version: number };
const row = (over: Partial<Row> = {}): Row => ({
  id: 'ing-1', delivery_platform_profile_id: 'p1', platform_key: 'keeta', external_store_id: 'Store-100', branch_id: null,
  configured_by: 'u-cfg', operated_by: 'u-self', status: 'configured', secret_prefix: SECRET_PREFIX, secret_version: 3, disabled_at: null, created_at: '2026-10-01T08:00:00Z', ...over,
});

type Outcome = unknown | (() => Promise<unknown>);
let rows: Row[];
let users: unknown;
let reassign: Outcome;
let usersGate: (() => Promise<void>) | null;

const settle = (outcome: Outcome) => Promise.resolve(typeof outcome === 'function' ? (outcome as () => unknown)() : outcome);

function installBackend() {
  api.mockImplementation((path: string, options?: { method?: string; body?: { user_id?: string } }) => {
    if (path === '/applications/nav-state') return Promise.resolve({ data: { 'sales.pos': true } });
    if (path === '/delivery-platforms') return Promise.resolve({ data: [] });
    if (path === '/delivery-platforms/readiness') return Promise.resolve({ data: READINESS });
    if (path === '/branches') return Promise.resolve({ data: [{ id: 'br-1', name: 'Riyadh Branch' }, { id: 'br-2', name: 'Jeddah Branch' }] });
    if (path === '/users') return (usersGate ? usersGate() : Promise.resolve()).then(() => (users instanceof Error ? Promise.reject(users) : { data: users }));
    if (path === '/delivery-connectors' && !options) return Promise.resolve({ data: rows.map((r) => ({ ...r })) });
    const target = /^\/delivery-connectors\/([^/]+)\/reassign$/.exec(path);
    if (target && options?.method === 'POST') {
      const point = rows.find((r) => r.id === target[1]);
      return settle(reassign).then((result) => {
        if (point && options.body?.user_id) point.operated_by = options.body.user_id;
        return result;
      });
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

const posts = () => api.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === 'POST');
const listReads = () => api.mock.calls.filter((c) => c[0] === '/delivery-connectors' && c.length === 1).length;
const userReads = () => api.mock.calls.filter((c) => c[0] === '/users').length;
const asOwner = () => currentUser.mockReturnValue({ id: 'u1', role: 'owner', permissions: ['*'] });
const asUser = (permissions: string[]) => currentUser.mockReturnValue({ id: 'u2', role: 'custom', permissions });
const VIEW = ['invoices.view', 'delivery_connector.view'];
const httpError = (status: number, body: unknown = { message: SERVER_TEXT }) => () => Promise.reject(Object.assign(new Error(SERVER_TEXT), { status, body }));
const networkError = () => () => Promise.reject(new TypeError('Failed to fetch'));
const ok = () => ({ data: { id: 'ing-1', status: 'configured' } });

async function mount(locale: 'ar' | 'en' = 'en') {
  renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, locale);
  await waitFor(() => expect(screen.getByTestId('signed-ingress-panel').getAttribute('data-state')).toBe('ready'));
  return TEST_MESSAGES[locale].integrationCenter.ingressManagement;
}

const reassignButton = (index = 0) => screen.getAllByTestId('ingress-reassign')[index];
const dialogOf = (name: string | RegExp) => screen.getByRole('dialog', { name });
const options = () => within(screen.getByTestId('reassign-select')).getAllByRole('option').map((o) => o.textContent);
const choose = (id: string) => fireEvent.change(screen.getByTestId('reassign-select'), { target: { value: id } });

async function openDialog(m: ReturnType<typeof mount> extends Promise<infer T> ? T : never, index = 0) {
  await waitFor(() => expect(screen.getAllByTestId('signed-ingress-operator')[0].textContent).not.toMatch(/…|Loading|جارٍ/));
  fireEvent.click(reassignButton(index));
  return dialogOf(m.reassign.title);
}

beforeEach(() => {
  api.mockReset();
  currentUser.mockReset();
  rows = [row()];
  users = USERS();
  reassign = ok;
  usersGate = null;
  localStorage.clear();
  sessionStorage.clear();
  installBackend();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.body.style.overflow = ''; });

describe('permission matrix: delivery_connector.reassign AND users.view, together', () => {
  const noReassignUi = () => {
    expect(screen.queryAllByTestId('ingress-reassign')).toHaveLength(0);
    expect(screen.queryAllByTestId('signed-ingress-operator')).toHaveLength(0);
  };

  it('owner (wildcard) sees the action and the operator column', async () => {
    asOwner();
    await mount();
    expect(screen.getAllByTestId('ingress-reassign').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByTestId('signed-ingress-operator')[0].textContent).toBe('Olga Current'));
  });

  it('reassign + users.view (without manage) sees reassign only — no rotate/disable', async () => {
    asUser([...VIEW, 'delivery_connector.reassign', 'users.view']);
    await mount();
    expect(screen.getAllByTestId('ingress-reassign').length).toBeGreaterThan(0);
    expect(screen.queryAllByTestId('ingress-rotate')).toHaveLength(0);
    expect(screen.queryAllByTestId('ingress-disable')).toHaveLength(0);
    expect(screen.getByTestId('signed-ingress-reassign-note')).toBeTruthy();
  });

  it('reassign without users.view: no action, no operator column, and /users is never requested', async () => {
    asUser([...VIEW, 'delivery_connector.reassign']);
    await mount();
    noReassignUi();
    expect(userReads()).toBe(0);
  });

  it('users.view without reassign: no action, no operator column, and /users is never requested', async () => {
    asUser([...VIEW, 'users.view']);
    await mount();
    noReassignUi();
    expect(userReads()).toBe(0);
  });

  it('manage alone: rotate/disable stay, reassign is absent (not disabled), no /users read', async () => {
    asUser([...VIEW, 'delivery_connector.manage']);
    await mount();
    expect(screen.getAllByTestId('ingress-rotate').length).toBeGreaterThan(0);
    noReassignUi();
    expect(userReads()).toBe(0);
  });

  it('a viewer gets no buttons at all', async () => {
    asUser(VIEW);
    await mount();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    noReassignUi();
    expect(userReads()).toBe(0);
  });

  it('demo mode: no action, no operator data, no /users read, no write', async () => {
    asOwner();
    localStorage.setItem('demo', 'true');
    await mount();
    noReassignUi();
    expect(userReads()).toBe(0);
    expect(posts()).toEqual([]);
  });

  it('is offered on a configured point only (never a disabled one)', async () => {
    asOwner();
    rows = [row(), row({ id: 'ing-2', external_store_id: 'Store-200', status: 'disabled', disabled_at: '2026-10-05T00:00:00Z' })];
    await mount();
    expect(screen.getAllByTestId('ingress-reassign')).toHaveLength(2); // جدول + بطاقات لنقطة واحدة
    for (const el of screen.getAllByTestId('ingress-row-actions')) expect(el.closest('[data-testid="signed-ingress-row"]')?.textContent).toContain('Store-100');
  });
});

describe.each(TEST_LOCALES)('reassign flow (%s)', (locale) => {
  it('shows the operator by name only, never an email, id or secret hint', async () => {
    asOwner();
    await mount(locale);
    await waitFor(() => expect(screen.getAllByTestId('signed-ingress-operator')[0].textContent).toBe('Olga Current'));
    const html = document.body.innerHTML;
    expect(html).not.toContain(EMAIL_DOMAIN);
    expect(html).not.toContain('u-self');
    expect(html).not.toContain('emp-');
  });

  it('lists only eligible operators (active, scope fits, not the current one) by name, never email', async () => {
    asOwner();
    const m = await mount(locale);
    await openDialog(m);
    // نقطة غير موجّهة لفرع: غير المقيَّد النشط فقط (دون الحالي ودون غير النشط ودون المقيَّدين بفروع).
    expect(options()).toEqual([m.reassign.select.placeholder, 'Amal Free']);
    expect(document.body.innerHTML).not.toContain(EMAIL_DOMAIN);
    expect(screen.getByTestId('reassign-current').textContent).toContain('Olga Current');
  });

  it('a branch-routed point also admits users whose scope includes its branch', async () => {
    asOwner();
    rows = [row({ branch_id: 'br-1' })];
    const m = await mount(locale);
    await openDialog(m);
    expect(options()).toEqual([m.reassign.select.placeholder, 'Amal Free', 'Bader Branch1']);
  });

  it('confirm is blocked until a valid operator is chosen; cancel sends nothing', async () => {
    asOwner();
    const m = await mount(locale);
    const dialog = await openDialog(m);
    const confirm = within(dialog).getByRole('button', { name: m.reassign.confirm }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(posts()).toEqual([]);
    choose('');
    expect(confirm.disabled).toBe(true);
    choose('u-dina'); // غير نشط وليس في القائمة أصلاً: لا يصير اختياراً صالحاً
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: m.common.cancel }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(posts()).toEqual([]);
  });

  it('sends exactly { user_id } to the existing route, updates the shown name from the server, and changes nothing else', async () => {
    asOwner();
    const m = await mount(locale);
    const before = listReads();
    const dialog = await openDialog(m);
    choose('u-amal');
    expect(screen.getByTestId('reassign-summary').textContent).toContain('Olga Current');
    expect(screen.getByTestId('reassign-summary').textContent).toContain('Amal Free');
    fireEvent.click(within(dialog).getByRole('button', { name: m.reassign.confirm }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posts()).toHaveLength(1);
    expect(posts()[0]).toEqual(['/delivery-connectors/ing-1/reassign', { method: 'POST', body: { user_id: 'u-amal' } }]);
    // الإشعار باسم المشغّل لا بريده؛ والقائمة أُعيدت قراءتها من الخادم.
    const notice = await screen.findByTestId('ingress-management-notice');
    expect(notice.textContent).toContain('Amal Free');
    expect(notice.textContent).toContain('Store-100');
    await waitFor(() => expect(listReads()).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getAllByTestId('signed-ingress-operator')[0].textContent).toBe('Amal Free'));
    // لا فرع ولا حالة ولا سرّ تغيّر في الخادم المحاكى (وما من طلب غير الإسناد).
    expect(rows[0]).toMatchObject({ branch_id: null, status: 'configured', secret_version: 3, secret_prefix: SECRET_PREFIX, external_store_id: 'Store-100' });
    expect(document.body.innerHTML).not.toContain(EMAIL_DOMAIN);
    expect(JSON.stringify(api.mock.calls)).not.toMatch(/@leak-sentinel/);
  });

  it('a double click sends one request; while busy the dialog cannot be closed or edited', async () => {
    asOwner();
    let release: (value: unknown) => void = () => {};
    reassign = () => new Promise((resolve) => { release = resolve; });
    const m = await mount(locale);
    const dialog = await openDialog(m);
    choose('u-amal');
    const confirm = within(dialog).getByRole('button', { name: m.reassign.confirm });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(within(dialogOf(m.reassign.title)).getByRole('button', { name: m.reassign.busy })).toBeTruthy());
    expect(posts()).toHaveLength(1);

    const busyDialog = dialogOf(m.reassign.title);
    expect((screen.getByTestId('reassign-select') as HTMLSelectElement).disabled).toBe(true);
    expect((within(busyDialog).getByRole('button', { name: m.common.cancel }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(busyDialog).queryByRole('button', { name: /close|إغلاق/i })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: m.reassign.title })).toBeTruthy();

    release(ok());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posts()).toHaveLength(1);
  });
});

describe('failures: dictionary text only, no raw server text, no automatic retry', () => {
  async function submit(m: Awaited<ReturnType<typeof mount>>) {
    const dialog = await openDialog(m);
    choose('u-amal');
    fireEvent.click(within(dialog).getByRole('button', { name: m.reassign.confirm }));
  }

  it.each([
    [403, 'forbidden'],
    [404, 'notFound'],
  ] as const)('%s closes the dialog, shows the dictionary notice and re-reads the list', async (status, key) => {
    asOwner();
    reassign = httpError(status);
    const m = await mount();
    const before = listReads();
    await submit(m);
    const notice = await screen.findByTestId('ingress-management-notice');
    expect(notice.textContent).toContain(m.errors[key]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
    await waitFor(() => expect(listReads()).toBeGreaterThan(before));
    expect(posts()).toHaveLength(1);
  });

  it('422 operator_ineligible keeps the dialog open with the safe message and refreshes the operator list', async () => {
    asOwner();
    reassign = httpError(422, { message: SERVER_TEXT, error_code: 'operator_ineligible' });
    const m = await mount();
    const readsBefore = userReads();
    await submit(m);
    const error = await screen.findByTestId('reassign-error');
    expect(error.textContent).toBe(m.errors.operatorIneligible);
    expect(screen.getByRole('dialog', { name: m.reassign.title })).toBeTruthy();
    await waitFor(() => expect(userReads()).toBeGreaterThan(readsBefore));
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
    expect(posts()).toHaveLength(1);
  });

  it('422 without a known code maps to the generic validation text', async () => {
    asOwner();
    reassign = httpError(422);
    const m = await mount();
    await submit(m);
    expect((await screen.findByTestId('reassign-error')).textContent).toBe(m.errors.validation);
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
  });

  it('409 keeps the dialog with the conflict text (no raw text, one request)', async () => {
    asOwner();
    reassign = httpError(409);
    const m = await mount();
    await submit(m);
    expect((await screen.findByTestId('reassign-error')).textContent).toBe(m.errors.conflict);
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
    expect(posts()).toHaveLength(1);
  });

  it.each([
    ['network loss', networkError()],
    ['502', httpError(502)],
    ['unreadable success', () => Promise.resolve({ data: null })],
  ])('unknown outcome (%s): one request, no retry control, list re-read, neutral notice', async (_name, outcome) => {
    asOwner();
    reassign = outcome;
    const m = await mount();
    const before = listReads();
    await submit(m);
    const notice = await screen.findByTestId('ingress-management-notice');
    expect(notice.textContent).toContain(m.errors.reassignOutcomeUnknown);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /retry|try again|إعادة المحاولة/i })).toBeNull();
    await waitFor(() => expect(listReads()).toBeGreaterThan(before));
    expect(posts()).toHaveLength(1);
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
  });
});

describe('operator directory states are safe', () => {
  it('a failed directory read is an error with a read-only retry — not "no operators" — and offers no submit', async () => {
    asOwner();
    users = new TypeError('Failed to fetch');
    const m = await mount();
    fireEvent.click(await waitFor(() => { const b = screen.getAllByTestId('ingress-reassign')[0]; expect(b).toBeTruthy(); return b; }));
    const dialog = dialogOf(m.reassign.title);
    expect(within(dialog).getByTestId('reassign-directory-error').textContent).toContain(m.reassign.directoryError);
    expect(screen.queryByTestId('reassign-empty')).toBeNull();
    expect(screen.queryByTestId('reassign-select')).toBeNull();
    expect((within(dialog).getByRole('button', { name: m.reassign.confirm }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByTestId('signed-ingress-operator')[0].textContent).toBe(TEST_MESSAGES.en.integrationCenter.ingressPanel.operator.unknown);

    users = USERS();
    const reads = userReads();
    fireEvent.click(within(dialog).getByRole('button', { name: m.reassign.retry }));
    await waitFor(() => expect(userReads()).toBeGreaterThan(reads));
    await waitFor(() => expect(screen.getByTestId('reassign-select')).toBeTruthy());
    expect(posts()).toEqual([]);
  });

  it('no eligible operator shows the explicit empty state and no select', async () => {
    asOwner();
    users = [person('u-self', 'Olga Current'), person('u-dina', 'Dina Inactive', { is_active: false })];
    const m = await mount();
    await openDialog(m);
    expect(screen.getByTestId('reassign-empty').textContent).toBe(m.reassign.empty);
    expect(screen.queryByTestId('reassign-select')).toBeNull();
  });

  it('while the directory loads the dialog says so and cannot submit', async () => {
    asOwner();
    let open: () => void = () => {};
    usersGate = () => new Promise<void>((resolve) => { open = resolve; });
    const m = await mount();
    fireEvent.click(screen.getAllByTestId('ingress-reassign')[0]);
    const dialog = dialogOf(m.reassign.title);
    expect(within(dialog).getByTestId('reassign-loading').textContent).toBe(m.reassign.loading);
    expect((within(dialog).getByRole('button', { name: m.reassign.confirm }) as HTMLButtonElement).disabled).toBe(true);
    open();
    await waitFor(() => expect(screen.getByTestId('reassign-select')).toBeTruthy());
  });

  it('a current operator missing from the directory is shown as unknown, never as a raw id', async () => {
    asOwner();
    rows = [row({ operated_by: 'u-ghost' })];
    const m = await mount();
    await waitFor(() => expect(screen.getAllByTestId('signed-ingress-operator')[0].textContent).toBe(TEST_MESSAGES.en.integrationCenter.ingressPanel.operator.unknown));
    fireEvent.click(reassignButton());
    expect(screen.getByTestId('reassign-current').textContent).toContain(m.reassign.unknownOperator);
    expect(document.body.innerHTML).not.toContain('u-ghost');
  });

  it('a user list that lacks branch scope cannot make anyone eligible (fail closed)', async () => {
    asOwner();
    users = USERS().map(({ branch_ids: _omit, ...rest }) => rest);
    const m = await mount();
    await openDialog(m);
    expect(screen.getByTestId('reassign-empty').textContent).toBe(m.reassign.empty);
  });

  it('duplicate names are told apart by order, never by email', async () => {
    asOwner();
    users = [person('u-self', 'Olga Current'), person('u-s1', 'Sam'), person('u-s2', 'Sam')];
    const m = await mount();
    await openDialog(m);
    expect(options()).toEqual([m.reassign.select.placeholder, 'Sam (1)', 'Sam (2)']);
    expect(document.body.innerHTML).not.toContain(EMAIL_DOMAIN);
  });
});

describe('no storage, no console, and the 5b/5c actions stay separate', () => {
  it('writes nothing to browser storage and logs no operator data during a full reassign', async () => {
    asOwner();
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    const m = await mount();
    const dialog = await openDialog(m);
    choose('u-amal');
    fireEvent.click(within(dialog).getByRole('button', { name: m.reassign.confirm }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(storage).not.toHaveBeenCalled();
    // الضجيج المسبق في بيئة الاختبار (مفاتيح ترجمة قديمة) موجود أصلاً؛ المهم أن لا شيء من البيانات يُسجَّل.
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toMatch(/leak-sentinel|u-amal|u-self|Amal Free|Olga/);
    expect(sessionStorage.length + localStorage.length).toBe(0);
  });

  it('owner keeps rotate and disable next to reassign, each on the same configured row', async () => {
    asOwner();
    await mount();
    const actions = screen.getAllByTestId('ingress-row-actions')[0];
    expect(within(actions).getAllByRole('button').map((b) => b.getAttribute('data-testid'))).toEqual(['ingress-rotate', 'ingress-reassign', 'ingress-disable']);
  });
});
