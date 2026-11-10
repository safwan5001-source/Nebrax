// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_MESSAGES, type TestLocale } from '@/test-utils/intl';
import { OWNER_ID, owner, page } from './__fixtures__';

const state = vi.hoisted(() => ({ permissions: ['*'] as string[], handler: (_path: string, _opts?: { method?: string; body?: unknown }) => ({}) as unknown }));
const push = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
const calls = vi.hoisted(() => [] as Array<{ path: string; method: string; body: unknown }>);

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: toast, error: vi.fn() }) }));
vi.mock('@/lib/auth', () => ({ currentUser: () => ({ permissions: state.permissions }) }));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    calls.push({ path, method: opts.method ?? 'GET', body: opts.body });
    const result = state.handler(path, opts);
    if (result instanceof Error) throw result;
    return result;
  }),
}));

import { ApiError } from '@/lib/api';
import { OwnersScreen } from './owners-screen';

const T = (locale: TestLocale) => TEST_MESSAGES[locale].fuelTankers;
const reads = () => calls.filter((c) => c.method === 'GET');

beforeEach(() => {
  calls.length = 0;
  state.permissions = ['*'];
  state.handler = () => page([owner(), owner({ id: '66666666-6666-4666-8666-666666666666', name: 'مالك آخر', code: null, status: 'inactive' })]);
});
afterEach(() => { cleanup(); push.mockReset(); toast.mockReset(); });

describe.each(['ar', 'en'] as const)('OwnersScreen (%s)', (locale) => {
  it('lists owners with status badges, mobile cards and a desktop table (both rendered, CSS picks one)', async () => {
    renderIntl(<OwnersScreen />, locale);
    expect((await screen.findAllByText('مالك تجريبي')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(T(locale).status.active).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(T(locale).status.inactive).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('heading', { name: T(locale).list.title })).toBeTruthy();
    expect(reads().map((c) => c.path)).toEqual(['/fuel-stations/tanker-owners']);
    // رابط التفاصيل بمعرّف الصاحب.
    expect(screen.getAllByRole('link').some((a) => a.getAttribute('href') === `/fuel-stations/tanker-owners/${OWNER_ID}`)).toBe(true);
  });

  it('formats dates in the UI language (English never gets Arabic-style RLM-marked dates)', async () => {
    renderIntl(<OwnersScreen />, locale);
    await screen.findAllByText('مالك تجريبي');
    const text = document.body.textContent ?? '';
    if (locale === 'en') {
      expect(text).toMatch(/Jan\s+5,\s+2026|5\s+Jan\s+2026|05\/01\/2026/);
      expect(text).not.toContain('\u200f');
    } else {
      expect(text).toContain('\u200f');
    }
  });

  it('shows the explicit forbidden state without calling the API when the view permission is missing', async () => {
    state.permissions = ['fuel_stations.view', 'fuel_stations.manage']; // المفتاح القديم لا يكفي
    renderIntl(<OwnersScreen />, locale);
    expect(await screen.findByText(T(locale).states.forbiddenTitle)).toBeTruthy();
    expect(screen.getByText('fuel.tanker.view')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('shows the closed-feature state when the server answers 404 on the list', async () => {
    state.handler = () => new ApiError(404, 'Not Found', {});
    renderIntl(<OwnersScreen />, locale);
    expect(await screen.findByText(T(locale).states.gateClosedTitle)).toBeTruthy();
    expect(screen.queryByText(T(locale).list.title)).toBeNull();
  });

  it('shows forbidden when the server itself answers 403', async () => {
    state.permissions = ['fuel.tanker.view'];
    state.handler = () => new ApiError(403, 'Forbidden', {});
    renderIntl(<OwnersScreen />, locale);
    expect(await screen.findByText(T(locale).states.forbiddenTitle)).toBeTruthy();
  });

  it('shows an error with retry, and retry reloads', async () => {
    let fail = true;
    state.handler = () => (fail ? new ApiError(500, 'boom', {}) : page([owner()]));
    renderIntl(<OwnersScreen />, locale);
    expect(await screen.findByText(T(locale).list.loadFailed)).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: TEST_MESSAGES[locale].nebrax.retry }));
    expect((await screen.findAllByText('مالك تجريبي')).length).toBeGreaterThan(0);
  });

  it('shows the empty state with an add action for managers, and without it for viewers', async () => {
    state.handler = () => page([]);
    const manager = renderIntl(<OwnersScreen />, locale);
    expect(await screen.findByText(T(locale).list.empty)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: T(locale).owner.create }).length).toBeGreaterThanOrEqual(1);
    manager.unmount();

    state.permissions = ['fuel.tanker.view'];
    renderIntl(<OwnersScreen />, locale);
    expect(await screen.findByText(T(locale).list.empty)).toBeTruthy();
    const add = screen.getAllByRole('button', { name: T(locale).owner.create });
    expect(add.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  it('view-only users see an explanatory notice and a disabled add button naming the missing permission', async () => {
    state.permissions = ['fuel.tanker.view'];
    renderIntl(<OwnersScreen />, locale);
    await screen.findAllByText('مالك تجريبي');
    expect(screen.getByRole('note').textContent).toContain('fuel.tanker.manage');
    const add = screen.getByRole('button', { name: T(locale).owner.create }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.getAttribute('title')).toContain('fuel.tanker.manage');
  });

  it('searches and filters on the server (debounced), keeps filters in the request, and offers to clear them when nothing matches', async () => {
    renderIntl(<OwnersScreen />, locale);
    await screen.findAllByText('مالك تجريبي');
    state.handler = () => page([]);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' عسكر ' } });
    fireEvent.change(screen.getByLabelText(T(locale).list.statusFilter), { target: { value: 'suspended' } });
    expect(await screen.findByText(T(locale).list.noResults)).toBeTruthy();
    // البحث مؤجَّل (debounce) فيصل بعد التصفية بالحالة؛ الطلب الأخير يحمل الاثنين معاً والنص مقصوصاً.
    await waitFor(() => expect(decodeURIComponent(reads().at(-1)!.path)).toContain('q=عسكر'));
    const last = reads().at(-1)!.path;
    expect(last).toContain('status=suspended');
    state.handler = () => page([owner()]);
    fireEvent.click(screen.getByRole('button', { name: T(locale).list.clearFilters }));
    expect((await screen.findAllByText('مالك تجريبي')).length).toBeGreaterThan(0);
    expect(reads().at(-1)!.path).toBe('/fuel-stations/tanker-owners');
  });

  it('paginates from the server meta', async () => {
    state.handler = (path) => page([owner()], { current_page: path.includes('page=2') ? 2 : 1, last_page: 2, total: 51 });
    renderIntl(<OwnersScreen />, locale);
    await screen.findAllByText('مالك تجريبي');
    const next = screen.getAllByRole('button').find((b) => /next|التالي/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''));
    expect(next).toBeTruthy();
    fireEvent.click(next!);
    await waitFor(() => expect(reads().at(-1)!.path).toContain('page=2'));
  });

  it('validates the create form before sending, then posts only the whitelisted fields and opens the new owner', async () => {
    renderIntl(<OwnersScreen />, locale);
    await screen.findAllByText('مالك تجريبي');
    fireEvent.click(screen.getByRole('button', { name: T(locale).owner.create }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.submit(dialog.querySelector('form')!);
    expect(await screen.findByText(T(locale).errors.required)).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    state.handler = (_path, opts) => (opts?.method === 'POST' ? { data: owner({ id: OWNER_ID }) } : page([owner()]));
    fireEvent.change(dialog.querySelector('#tanker-owner-name')!, { target: { value: '  مالك جديد  ' } });
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/fuel-stations/tanker-owners/${OWNER_ID}`));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/fuel-stations/tanker-owners');
    expect(post.body).toEqual({ name: 'مالك جديد', code: null, phone: null, notes: null, status: 'active' });
    expect(Object.keys(post.body as object)).not.toContain('tenant_id');
    expect(toast).toHaveBeenCalledWith(T(locale).owner.created);
  });

  it('maps server validation (duplicate code) onto the field and keeps the dialog open without navigating', async () => {
    renderIntl(<OwnersScreen />, locale);
    await screen.findAllByText('مالك تجريبي');
    fireEvent.click(screen.getByRole('button', { name: T(locale).owner.create }));
    const dialog = await screen.findByRole('dialog');
    state.handler = (_path, opts) => (opts?.method === 'POST' ? new ApiError(422, 'invalid', { errors: { code: ['رمز صاحب الصهريج مسجَّل مسبقاً.'] } }) : page([]));
    fireEvent.change(dialog.querySelector('#tanker-owner-name')!, { target: { value: 'س' } });
    fireEvent.change(dialog.querySelector('#tanker-owner-code')!, { target: { value: 'TO-1' } });
    fireEvent.submit(dialog.querySelector('form')!);
    expect(await screen.findByText('رمز صاحب الصهريج مسجَّل مسبقاً.')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('does not submit twice while a save is in flight', async () => {
    renderIntl(<OwnersScreen />, locale);
    await screen.findAllByText('مالك تجريبي');
    fireEvent.click(screen.getByRole('button', { name: T(locale).owner.create }));
    const dialog = await screen.findByRole('dialog');
    let release: (value: unknown) => void = () => {};
    state.handler = (_path, opts) => (opts?.method === 'POST' ? (new Promise((resolve) => { release = resolve; }) as unknown) : page([]));
    fireEvent.change(dialog.querySelector('#tanker-owner-name')!, { target: { value: 'س' } });
    fireEvent.submit(dialog.querySelector('form')!);
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1));
    release({ data: owner() });
    await waitFor(() => expect(push).toHaveBeenCalled());
  });
});
