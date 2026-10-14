// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryPlatformDetailScreen } from './delivery-platform-detail-screen';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES } from '@/test-utils/intl';

const { api, currentUser } = vi.hoisted(() => ({ api: vi.fn(), currentUser: vi.fn() }));

vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/auth', () => ({ currentUser }));

/**
 * INT-UX-5b: تدوير السر وتعطيل نقطة الاستقبال على شاشة تفاصيل المنصة. الخادم مُحاكى بحالة قابلة للتعديل
 * (يتغيّر `status` و`secret_version` بعد النجاح) كي تُختبر إعادة القراءة فعلاً لا افتراضاً.
 */
const NEW_SECRET = 'dsec_SENTINEL_NEW_ROTATED_SECRET_0123456789abcdef';
const SERVER_TEXT = 'RAW_SERVER_TEXT_MUST_NEVER_BE_SHOWN';

const READINESS = ['hungerstation', 'jahez', 'mrsool', 'keeta', 'ninja', 'the_chefz'].map((platform_key) => ({
  platform_key, ux_state: 'NOT_SUPPORTED', technical: 'BLOCKED', connect_enabled: false, sync_enabled: false, evidence_date: '2026-10-11', evidence_ref: 'docs/x.md',
}));

interface Row { id: string; external_store_id: string; status: 'configured' | 'disabled'; secret_version: number; disabled_at: string | null }
const row = (over: Partial<Row> = {}): Row & Record<string, unknown> => ({
  id: 'ing-1', delivery_platform_profile_id: 'p1', platform_key: 'keeta', external_store_id: 'Store-100', branch_id: null,
  configured_by: 'u', operated_by: 'u', status: 'configured', secret_prefix: 'x', secret_version: 3, disabled_at: null, created_at: '2026-10-01T08:00:00Z', ...over,
});

type Outcome = unknown | (() => Promise<unknown>);
let rows: ReturnType<typeof row>[];
let rotate: Outcome;
let disable: Outcome;
let listGate: (() => Promise<void>) | null;

const settle = (outcome: Outcome) => Promise.resolve(typeof outcome === 'function' ? (outcome as () => unknown)() : outcome);

function installBackend() {
  api.mockImplementation((path: string, options?: { method?: string }) => {
    if (path === '/applications/nav-state') return Promise.resolve({ data: { 'sales.pos': true } });
    if (path === '/delivery-platforms') return Promise.resolve({ data: [] });
    if (path === '/delivery-platforms/readiness') return Promise.resolve({ data: READINESS });
    if (path === '/delivery-connectors' && !options) {
      const snapshot = rows.map((r) => ({ ...r }));
      return (listGate ? listGate() : Promise.resolve()).then(() => ({ data: snapshot }));
    }
    const target = /^\/delivery-connectors\/([^/]+)\/(rotate-secret|disable)$/.exec(path);
    if (target && options?.method === 'POST') {
      const [, id, action] = target;
      const point = rows.find((r) => r.id === id);
      return Promise.resolve(action === 'rotate-secret' ? settle(rotate) : settle(disable)).then((result) => {
        if (point && action === 'rotate-secret') point.secret_version += 1;
        if (point && action === 'disable') Object.assign(point, { status: 'disabled', disabled_at: '2026-10-14T00:00:00Z' });
        return result;
      });
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

const posts = () => api.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === 'POST').map((c) => c[0] as string);
const listReads = () => api.mock.calls.filter((c) => c[0] === '/delivery-connectors' && c.length === 1).length;
const asOwner = () => currentUser.mockReturnValue({ id: 'u1', role: 'owner', permissions: ['*'] });
const asUser = (permissions: string[]) => currentUser.mockReturnValue({ id: 'u2', role: 'custom', permissions });
const VIEW = ['invoices.view', 'delivery_connector.view'];
const httpError = (status: number, body: unknown = { message: SERVER_TEXT }) => () => Promise.reject(Object.assign(new Error(SERVER_TEXT), { status, body }));
const networkError = () => () => Promise.reject(new TypeError('Failed to fetch'));
const success = () => ({ data: { id: 'ing-1', status: 'configured' }, secret: NEW_SECRET });

async function mount(locale: 'ar' | 'en' = 'en') {
  renderIntl(<DeliveryPlatformDetailScreen platformKey="keeta" />, locale);
  await waitFor(() => expect(screen.getByTestId('signed-ingress-panel').getAttribute('data-state')).toBe('ready'));
  return TEST_MESSAGES[locale].integrationCenter.ingressManagement;
}

// الجدول والبطاقات كلاهما في DOM (CSS يخفي أحدهما): نأخذ أول زر مطابق.
const rotateButton = () => screen.getAllByTestId('ingress-rotate')[0];
const disableButton = () => screen.getAllByTestId('ingress-disable')[0];
const dialogOf = (name: string | RegExp) => screen.getByRole('dialog', { name });
const fill = (text: string) => fireEvent.change(screen.getByTestId('typed-confirmation-input'), { target: { value: text } });

let storageWrites: ReturnType<typeof vi.spyOn>;
let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  api.mockReset();
  currentUser.mockReset();
  rows = [row()];
  rotate = success;
  disable = () => ({ data: { id: 'ing-1', status: 'disabled' } });
  listGate = null;
  localStorage.clear();
  installBackend();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  storageWrites = vi.spyOn(Storage.prototype, 'setItem');
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.body.style.overflow = ''; });

describe('who sees which action (absent, never disabled)', () => {
  it('owner sees rotate and disable on a configured point and no action at all on a disabled one', async () => {
    asOwner();
    rows = [row(), row({ id: 'ing-2', external_store_id: 'Store-200', status: 'disabled', disabled_at: '2026-10-05T00:00:00Z' })];
    await mount();
    // نقطتان × (جدول + بطاقات) = زرّا تدوير وتعطيل لنقطة واحدة فقط في كل عرض.
    expect(screen.getAllByTestId('ingress-rotate')).toHaveLength(2);
    expect(screen.getAllByTestId('ingress-disable')).toHaveLength(2);
    expect(screen.getAllByTestId('ingress-row-actions').every((el) => el.closest('[data-testid="signed-ingress-row"]')?.textContent?.includes('Store-100'))).toBe(true);
    expect(screen.getByTestId('signed-ingress-manage-note')).toBeTruthy();
  });

  it('delivery_connector.manage alone (plus the view needed to see the panel) is enough; reassign adds nothing here', async () => {
    asUser([...VIEW, 'delivery_connector.manage']);
    await mount();
    expect(screen.getAllByTestId('ingress-rotate').length).toBeGreaterThan(0);
    expect(screen.queryByText(/reassign|إعادة إسناد/i)).toBeNull();
    cleanup();
    asUser([...VIEW, 'delivery_connector.reassign', 'users.view']);
    await mount();
    expect(screen.queryAllByTestId('ingress-rotate')).toHaveLength(0);
    expect(screen.queryAllByTestId('ingress-disable')).toHaveLength(0);
  });

  it('a viewer without manage gets a read-only panel: no buttons, no management dialog, and a read-only note', async () => {
    asUser(VIEW);
    await mount();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByTestId('signed-ingress-readonly-note')).toBeTruthy();
    expect(screen.queryByTestId('signed-ingress-manage-note')).toBeNull();
  });

  it('demo (preview) mode shows no management action and sends no write', async () => {
    asOwner();
    localStorage.setItem('demo', 'true');
    await mount();
    expect(screen.queryAllByTestId('ingress-rotate')).toHaveLength(0);
    expect(screen.queryAllByTestId('ingress-disable')).toHaveLength(0);
    expect(posts()).toEqual([]);
  });

  it('never offers create, reassign or re-enable', async () => {
    asOwner();
    rows = [row(), row({ id: 'ing-2', external_store_id: 'Store-200', status: 'disabled' })];
    await mount();
    const panel = screen.getByTestId('signed-ingress-panel');
    // الأزرار في اللوحة كلها تدوير أو تعطيل لنقطة مهيّأة؛ لا شيء آخر (لا إنشاء ولا إعادة إسناد ولا إعادة تفعيل).
    const names = within(panel).getAllByRole('button').map((b) => b.getAttribute('data-testid'));
    expect(new Set(names)).toEqual(new Set(['ingress-rotate', 'ingress-disable']));
    expect(within(panel).queryAllByRole('button', { name: /add|new|reassign|operator|re-?enable|reactivate|إنشاء|إضافة|إعادة إسناد|إعادة تفعيل/i })).toHaveLength(0);
    expect(within(panel).queryAllByRole('link')).toHaveLength(0);
  });
});

describe.each(TEST_LOCALES)('rotate the secret (%s)', (locale) => {
  it('asks for confirmation first, says the old secret stops at once, and sends nothing until confirmed or when cancelled', async () => {
    asOwner();
    const m = await mount(locale);
    fireEvent.click(rotateButton());
    const dialog = dialogOf(m.rotate.title);
    expect(dialog.textContent).toContain(m.rotate.message);
    expect(within(dialog).getByText('Store-100')).toBeTruthy();
    expect(posts()).toEqual([]);

    fireEvent.click(within(dialog).getByRole('button', { name: m.common.cancel }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(posts()).toEqual([]);
  });

  it('uses only the existing endpoint, reveals the new secret once (masked, locked), then clears it and re-reads the list', async () => {
    asOwner();
    const m = await mount(locale);
    const before = listReads();
    fireEvent.click(rotateButton());
    fireEvent.click(within(dialogOf(m.rotate.title)).getByRole('button', { name: m.rotate.confirm }));

    const title = m.secret.title;
    const reveal = await screen.findByRole('dialog', { name: title });
    expect(reveal.textContent).toContain('Store-100');
    expect(posts()).toEqual(['/delivery-connectors/ing-1/rotate-secret']);
    expect(api.mock.calls.find((c) => String(c[0]).endsWith('rotate-secret'))?.[1]).toEqual({ method: 'POST' });

    // مقنّع افتراضياً: القيمة ليست في DOM حتى الكشف.
    expect(document.body.innerHTML).not.toContain(NEW_SECRET);
    // قفل الإغلاق: لا زر X، وEscape لا يغلق ويُظهر التلميح.
    expect(within(reveal).queryByRole('button', { name: /close|إغلاق/i })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: title })).toBeTruthy();
    expect(screen.getByTestId('secret-dismiss-hint').textContent).toBe(m.secret.confirmHint);

    fireEvent.click(within(reveal).getByRole('button', { name: m.secret.reveal }));
    expect(within(reveal).getByText(NEW_SECRET)).toBeTruthy();

    // قائمة النقاط أُعيد جلبها بعد النجاح (الإصدار تغيّر في الخادم المحاكى).
    await waitFor(() => expect(listReads()).toBeGreaterThan(before));

    fireEvent.click(within(reveal).getByRole('checkbox'));
    const done = within(reveal).getAllByRole('button', { name: m.secret.confirm }).find((b) => b.tagName === 'BUTTON' && !(b as HTMLButtonElement).disabled) as HTMLElement;
    fireEvent.click(done);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // بعد الإغلاق: لا أثر للسر في DOM، ولا في التخزين، ولا في السجلّ، وتظهر رسالة نجاح بلا السر.
    expect(document.body.innerHTML).not.toContain(NEW_SECRET);
    expect(storageWrites.mock.calls.flat().join('|')).not.toContain(NEW_SECRET);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    for (const spy of consoleSpies) expect(JSON.stringify(spy.mock.calls)).not.toContain(NEW_SECRET);
    expect(window.location.href).not.toContain(NEW_SECRET);
    expect(screen.getByTestId('ingress-management-notice').textContent).toContain('Store-100');
  });

  it('a double submit sends one request', async () => {
    asOwner();
    let release: (v: unknown) => void = () => {};
    rotate = () => new Promise((resolve) => { release = resolve; });
    const m = await mount(locale);
    fireEvent.click(rotateButton());
    const confirm = within(dialogOf(m.rotate.title)).getByRole('button', { name: m.rotate.confirm });
    // نقرتان قبل أن يُعاد الرسم (دفعة واحدة): القفل لا الزر المعطّل هو الحارس.
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
    expect(posts()).toHaveLength(1);
    await act(async () => { release(success()); });
    await screen.findByRole('dialog', { name: m.secret.title });
    expect(posts()).toHaveLength(1);
  });

  it('while the request runs the dialog cannot be closed (Escape, cancel, X) and both buttons are inert', async () => {
    asOwner();
    let release: (v: unknown) => void = () => {};
    rotate = () => new Promise((resolve) => { release = resolve; });
    const m = await mount(locale);
    fireEvent.click(rotateButton());
    const dialog = dialogOf(m.rotate.title);
    fireEvent.click(within(dialog).getByRole('button', { name: m.rotate.confirm }));
    await within(dialog).findByRole('button', { name: m.rotate.busy });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: m.rotate.title })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /close|إغلاق/i })).toBeNull();
    expect((within(dialog).getByRole('button', { name: m.common.cancel }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole('button', { name: m.rotate.busy }) as HTMLButtonElement).disabled).toBe(true);
    const backdrop = document.querySelector('[aria-hidden="true"].absolute') as HTMLElement;
    fireEvent.click(backdrop);
    expect(screen.getByRole('dialog', { name: m.rotate.title })).toBeTruthy();

    await act(async () => { release(success()); });
    await screen.findByRole('dialog', { name: m.secret.title });
  });

  it('a lost response (network failure) is an unknown outcome: one request, no retry button, no automatic repeat, list re-read', async () => {
    asOwner();
    rotate = networkError();
    const m = await mount(locale);
    const before = listReads();
    fireEvent.click(rotateButton());
    fireEvent.click(within(dialogOf(m.rotate.title)).getByRole('button', { name: m.rotate.confirm }));

    const notice = await screen.findByTestId('ingress-management-notice');
    expect(notice.textContent).toContain(m.errors.outcomeUnknown);
    expect(notice.getAttribute('role')).toBe('alert');
    await waitFor(() => expect(listReads()).toBeGreaterThan(before));
    // لا زر «إعادة المحاولة» ولا زر تدوير ثانٍ داخل الإشعار؛ ولا طلب ثانٍ تلقائياً.
    expect(within(notice).getAllByRole('button')).toHaveLength(1);
    expect(within(notice).queryByText(/retry|try again|إعادة المحاولة/i)).toBeNull();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(posts()).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a 5xx and a success response without a readable secret are both unknown outcomes (never a reveal, never a retry)', async () => {
    asOwner();
    for (const outcome of [httpError(502), () => ({ data: { id: 'ing-1', status: 'configured' } }), () => ({ data: {}, secret: '' }), () => ({ secret: 'has whitespace in it' })]) {
      rotate = outcome;
      api.mockClear();
      installBackend();
      const m = await mount(locale);
      fireEvent.click(rotateButton());
      fireEvent.click(within(dialogOf(m.rotate.title)).getByRole('button', { name: m.rotate.confirm }));
      const notice = await screen.findByTestId('ingress-management-notice');
      expect(notice.textContent).toContain(m.errors.outcomeUnknown);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(posts()).toHaveLength(1);
      expect(document.body.innerHTML).not.toContain('has whitespace');
      cleanup();
    }
  });

  it.each([
    [403, 'forbidden'],
    [404, 'notFound'],
    [409, 'conflict'],
    [422, 'validation'],
  ] as const)('maps a %s answer to the fixed dictionary message and never shows the server text', async (status, key) => {
    asOwner();
    rotate = httpError(status);
    const m = await mount(locale);
    fireEvent.click(rotateButton());
    fireEvent.click(within(dialogOf(m.rotate.title)).getByRole('button', { name: m.rotate.confirm }));
    const notice = await screen.findByTestId('ingress-management-notice');
    expect(notice.textContent).toContain(m.errors[key]);
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(posts()).toHaveLength(1);
  });
});

describe.each(TEST_LOCALES)('disable the ingress point (%s)', (locale) => {
  it('warns that it cannot be undone and requires the store ID typed literally before the confirm button works', async () => {
    asOwner();
    const m = await mount(locale);
    fireEvent.click(disableButton());
    const dialog = dialogOf(m.disable.title);
    expect(dialog.textContent).toContain(m.disable.message);
    const confirm = within(dialog).getByRole('button', { name: m.disable.confirm }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    for (const wrong of ['', 'store-100', 'Store-100 ', ' Store-100', 'Store-10', 'Store-1000']) {
      fill(wrong);
      expect(confirm.disabled, JSON.stringify(wrong)).toBe(true);
    }
    fireEvent.click(confirm);
    expect(posts()).toEqual([]);

    fill('Store-100');
    expect(confirm.disabled).toBe(false);
  });

  it('disables through the existing endpoint only, reports success, re-reads the list, and then offers no action and no re-enable', async () => {
    asOwner();
    const m = await mount(locale);
    const before = listReads();
    fireEvent.click(disableButton());
    fill('Store-100');
    fireEvent.click(within(dialogOf(m.disable.title)).getByRole('button', { name: m.disable.confirm }));

    const notice = await screen.findByTestId('ingress-management-notice');
    expect(notice.textContent).toContain(m.notices.disabled.replace('{storeId}', 'Store-100'));
    expect(notice.getAttribute('role')).toBe('status');
    expect(posts()).toEqual(['/delivery-connectors/ing-1/disable']);
    expect(api.mock.calls.find((c) => String(c[0]).endsWith('/disable'))?.[1]).toEqual({ method: 'POST' });
    await waitFor(() => expect(listReads()).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getByTestId('signed-ingress-panel').getAttribute('data-state')).toBe('ready'));
    await waitFor(() => expect(screen.getAllByTestId('signed-ingress-status')[0].getAttribute('data-status')).toBe('disabled'));
    expect(screen.queryAllByTestId('ingress-rotate')).toHaveLength(0);
    expect(screen.queryAllByTestId('ingress-disable')).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a double submit sends one request, and the dialog cannot be closed while it runs', async () => {
    asOwner();
    let release: (v: unknown) => void = () => {};
    disable = () => new Promise((resolve) => { release = resolve; });
    const m = await mount(locale);
    fireEvent.click(disableButton());
    fill('Store-100');
    const dialog = dialogOf(m.disable.title);
    const confirm = within(dialog).getByRole('button', { name: m.disable.confirm });
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
    expect(posts()).toHaveLength(1);

    await within(dialog).findByRole('button', { name: m.disable.busy });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: m.disable.title })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /close|إغلاق/i })).toBeNull();
    expect((screen.getByTestId('typed-confirmation-input') as HTMLInputElement).disabled).toBe(true);

    await act(async () => { release({ data: { id: 'ing-1', status: 'disabled' } }); });
    await screen.findByTestId('ingress-management-notice');
    expect(posts()).toHaveLength(1);
  });

  it('an unknown outcome re-reads the state first: no action is available until the fresh list arrives, and nothing is repeated', async () => {
    asOwner();
    disable = networkError();
    const m = await mount(locale);
    fireEvent.click(disableButton());
    fill('Store-100');

    // أبقِ إعادة القراءة معلّقة لنرى أن لا إجراء متاحاً قبل وصولها.
    let releaseList: () => void = () => {};
    listGate = () => new Promise<void>((resolve) => { releaseList = resolve; });
    fireEvent.click(within(dialogOf(m.disable.title)).getByRole('button', { name: m.disable.confirm }));

    const notice = await screen.findByTestId('ingress-management-notice');
    expect(notice.textContent).toContain(m.errors.disableOutcomeUnknown);
    await waitFor(() => expect(screen.getByTestId('signed-ingress-panel').getAttribute('data-state')).toBe('loading'));
    expect(screen.queryAllByTestId('ingress-disable')).toHaveLength(0);
    expect(screen.queryAllByTestId('ingress-rotate')).toHaveLength(0);
    expect(within(notice).queryByText(/retry|try again|إعادة المحاولة/i)).toBeNull();

    await act(async () => { releaseList(); });
    await waitFor(() => expect(screen.getByTestId('signed-ingress-panel').getAttribute('data-state')).toBe('ready'));
    expect(screen.getAllByTestId('ingress-disable').length).toBeGreaterThan(0);
    expect(posts()).toHaveLength(1);
  });

  it('opening the dialog again starts with an empty confirmation field', async () => {
    asOwner();
    const m = await mount(locale);
    fireEvent.click(disableButton());
    fill('Store-100');
    fireEvent.click(within(dialogOf(m.disable.title)).getByRole('button', { name: m.common.cancel }));
    fireEvent.click(disableButton());
    expect((screen.getByTestId('typed-confirmation-input') as HTMLInputElement).value).toBe('');
    expect((within(dialogOf(m.disable.title)).getByRole('button', { name: m.disable.confirm }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    [403, 'forbidden'],
    [404, 'notFound'],
    [409, 'conflict'],
    [422, 'validation'],
  ] as const)('maps a %s answer to the fixed dictionary message and never shows the server text', async (status, key) => {
    asOwner();
    disable = httpError(status);
    const m = await mount(locale);
    fireEvent.click(disableButton());
    fill('Store-100');
    fireEvent.click(within(dialogOf(m.disable.title)).getByRole('button', { name: m.disable.confirm }));
    const notice = await screen.findByTestId('ingress-management-notice');
    expect(notice.textContent).toContain(m.errors[key]);
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
    expect(posts()).toHaveLength(1);
  });
});

describe('wording', () => {
  it.each(TEST_LOCALES)('never claims a native connection, linked merchant account or synchronization in the new copy (%s)', (locale) => {
    const text = JSON.stringify(TEST_MESSAGES[locale].integrationCenter.ingressManagement) + JSON.stringify(TEST_MESSAGES[locale].integrationCenter.ingressPanel);
    const phrases = ['متصل بالمنصة', 'حساب التاجر مرتبط', 'المزامنة مفعّلة', 'جاهز للتكامل الأصلي', 'connected to the platform', 'merchant account is linked', 'sync is enabled', 'ready for native integration'];
    for (const phrase of phrases) expect(text, phrase).not.toContain(phrase);
  });
});
