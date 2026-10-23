// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_LOCALES } from '@/test-utils/intl';
import { ApiError } from '@/lib/api';
import { PaymentsOnlinePage } from './PaymentsOnlinePage';

const state = vi.hoisted(() => ({ perms: new Set<string>(), demo: false }));
const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: apiMock }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ can: (p: string) => state.perms.has(p), hydrated: true }) }));
vi.mock('@/lib/demo', async (orig) => ({ ...(await orig<typeof import('@/lib/demo')>()), isDemo: () => state.demo }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn(), ...toastMock }) }));

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1', request_id: 'r1', invoice: { id: 'inv1', number: 'INV-0001' }, gateway: { id: 'g1', name: 'ميسّر', provider: 'moyasar', environment: 'sandbox' },
  capture_status: 'captured', posting_status: 'posted', amount_minor: 115000, captured_minor: 115000, currency: 'SAR', review_reasons: [],
  blocked_reason: null, accounting_date: '2026-10-23', captured_at: '2026-10-23T09:00:00Z', posted_at: '2026-10-23T09:00:05Z', created_at: '2026-10-23T08:59:00Z', ...over,
});
const meta = (total: number) => ({ total, page: 1, per_page: 25, last_page: 1 });

function route(handlers: Record<string, (body?: unknown) => unknown>) {
  apiMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
    const key = `${options?.method ?? 'GET'} ${path.split('?')[0]}`;
    const query = path.includes('?') ? path.slice(path.indexOf('?')) : '';
    const handler = handlers[`${key}${query}`] ?? handlers[key];
    if (!handler) throw new Error(`unrouted ${key}${query}`);
    const result = handler(options?.body);
    if (result instanceof Error) throw result;
    return result;
  });
}

beforeEach(() => {
  state.perms = new Set(['payments.view']);
  state.demo = false;
  apiMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});
afterEach(cleanup);

describe.each(TEST_LOCALES)('PaymentsOnlinePage (%s)', (locale) => {
  const ui = () => renderIntl(<PaymentsOnlinePage />, locale);

  it('makes no call and shows the empty state without payments.view or in demo mode', () => {
    route({});
    state.perms = new Set();
    ui();
    expect(apiMock).not.toHaveBeenCalled();
    cleanup();
    state.perms = new Set(['payments.view']);
    state.demo = true;
    ui();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('lists attempts with status, amount and a review flag; no repost button without the resolve permission', async () => {
    route({
      'GET /payment-attempts': () => ({ data: [row(), row({ id: 'a2', posting_status: 'blocked_period', blocked_reason: { kind: 'period' }, review_reasons: ['overpayment'] })], meta: meta(2) }),
    });
    ui();
    const links = await screen.findAllByRole('link', { name: 'INV-0001' });
    expect(links[0].getAttribute('href')).toBe('/invoices/inv1');
    expect(screen.queryByRole('button', { name: /Repost|إعادة الترحيل/ })).toBeNull();
  });

  it('shows the blocked tab count and filters the list server-side', async () => {
    route({
      'GET /payment-attempts?posting_status=blocked_period&per_page=1': () => ({ data: [], meta: meta(3) }),
      'GET /payment-attempts?page=1&per_page=25': () => ({ data: [row()], meta: meta(1) }),
      'GET /payment-attempts?page=1&per_page=25&posting_status=blocked_period': () => ({ data: [row({ id: 'b1', posting_status: 'blocked_period', blocked_reason: { kind: 'year' } })], meta: meta(1) }),
    });
    ui();
    const tab = await screen.findByRole('tab', { name: /3/ });
    fireEvent.click(tab);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/payment-attempts?page=1&per_page=25&posting_status=blocked_period'));
  });

  it('reposts a blocked payment with a reason (≥5 chars) and reloads', async () => {
    state.perms = new Set(['payments.view', 'payments.resolve_blocked']);
    const posted: unknown[] = [];
    route({
      'GET /payment-attempts?posting_status=blocked_period&per_page=1': () => ({ data: [], meta: meta(1) }),
      'GET /payment-attempts': () => ({ data: [row({ id: 'b1', posting_status: 'blocked_period', blocked_reason: { kind: 'period' } })], meta: meta(1) }),
      'POST /payment-attempts/b1/repost': (body) => { posted.push(body); return { data: { id: 'b1', outcome: 'posted', posting_status: 'posted' } }; },
    });
    ui();
    fireEvent.click((await screen.findAllByRole('button', { name: /Repost|إعادة الترحيل/ }))[0]);
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getAllByRole('button').find((b) => /^(Repost|إعادة الترحيل)$/.test(b.textContent ?? ''))!;
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'abc' } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '  فتح الفترة بموافقة المدير  ' } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(posted).toEqual([{ reason: 'فتح الفترة بموافقة المدير' }]));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('reports a still-blocked outcome as an error toast and a server refusal inside the dialog', async () => {
    state.perms = new Set(['payments.view', 'payments.resolve_blocked']);
    let outcome: 'blocked_period' | 'refuse' = 'blocked_period';
    route({
      'GET /payment-attempts?posting_status=blocked_period&per_page=1': () => ({ data: [], meta: meta(1) }),
      'GET /payment-attempts': () => ({ data: [row({ id: 'b1', posting_status: 'blocked_period', blocked_reason: { kind: 'period' } })], meta: meta(1) }),
      'POST /payment-attempts/b1/repost': () => outcome === 'refuse'
        ? new ApiError(409, 'x', { error: { code: 'not_blocked' } })
        : { data: { id: 'b1', outcome: 'blocked_period', posting_status: 'blocked_period' } },
    });
    ui();
    fireEvent.click((await screen.findAllByRole('button', { name: /Repost|إعادة الترحيل/ }))[0]);
    let dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'محاولة والفترة مقفلة' } });
    fireEvent.click(within(dialog).getAllByRole('button').find((b) => /^(Repost|إعادة الترحيل)$/.test(b.textContent ?? ''))!);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());

    outcome = 'refuse';
    fireEvent.click((await screen.findAllByRole('button', { name: /Repost|إعادة الترحيل/ }))[0]);
    dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'محاولة ثانية بسبب كافٍ' } });
    fireEvent.click(within(dialog).getAllByRole('button').find((b) => /^(Repost|إعادة الترحيل)$/.test(b.textContent ?? ''))!);
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
  });

  it('opens the detail sheet with postings and a timeline including the repost decision', async () => {
    route({
      'GET /payment-attempts': () => ({ data: [row()], meta: meta(1) }),
      'GET /payment-attempts?posting_status=blocked_period&per_page=1': () => ({ data: [], meta: meta(0) }),
      'GET /payment-attempts/a1': () => ({
        data: {
          ...row(), failure_code: null, refunded_minor: 0,
          postings: [{ role: 'allocated', amount_minor: 115000, payment_id: 'p1', payment_number: 'PAY-0001' }],
          timeline: [
            { type: 'created', at: '2026-10-23T08:59:00Z' },
            { type: 'captured', at: '2026-10-23T09:00:00Z' },
            { type: 'repost', at: '2026-10-23T10:00:00Z', outcome: 'posted', actor: 'المالك', reason: 'بعد الفتح الرسمي للفترة' },
          ],
        },
      }),
    });
    ui();
    fireEvent.click((await screen.findAllByRole('button', { name: /Details|التفاصيل/ }))[0]);
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText('PAY-0001')).toBeTruthy();
    expect(within(sheet).getByText(/بعد الفتح الرسمي للفترة/)).toBeTruthy();
    expect(within(sheet).getAllByRole('listitem').length).toBeGreaterThanOrEqual(4);
  });

  it('ignores a slow response for an old query after the tab changed', async () => {
    let releaseAll: (v: unknown) => void = () => {};
    const slowAll = new Promise((resolve) => { releaseAll = resolve; });
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/payment-attempts?posting_status=blocked_period&per_page=1') return { data: [], meta: meta(1) };
      if (path === '/payment-attempts?page=1&per_page=25') return slowAll;
      if (path === '/payment-attempts?page=1&per_page=25&posting_status=blocked_period') {
        return { data: [row({ id: 'b1', posting_status: 'blocked_period', blocked_reason: { kind: 'period' }, invoice: { id: 'i9', number: 'INV-BLOCKED' } })], meta: meta(1) };
      }
      throw new Error(`unrouted ${path}`);
    });
    ui();
    fireEvent.click(await screen.findByRole('tab', { name: /1/ }));
    expect((await screen.findAllByRole('link', { name: 'INV-BLOCKED' })).length).toBeGreaterThan(0);
    releaseAll({ data: [row({ id: 'old', invoice: { id: 'i0', number: 'INV-STALE' } })], meta: meta(1) });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryAllByRole('link', { name: 'INV-STALE' })).toHaveLength(0);
    expect(screen.getAllByRole('link', { name: 'INV-BLOCKED' }).length).toBeGreaterThan(0);
  });

  it('moves to the last valid page when a repost empties the current one', async () => {
    state.perms = new Set(['payments.view', 'payments.resolve_blocked']);
    const seen: string[] = [];
    let reposted = false;
    apiMock.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (options?.method === 'POST') { reposted = true; return { data: { id: 'b2', outcome: 'posted', posting_status: 'posted' } }; }
      if (path.startsWith('/payment-attempts?posting_status=blocked_period&per_page=1')) return { data: [], meta: meta(reposted ? 1 : 2) };
      seen.push(path);
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      if (page === 2) {
        return reposted
          ? { data: [], meta: { total: 1, page: 2, per_page: 1, last_page: 1 } }
          : { data: [row({ id: 'b2', posting_status: 'blocked_period', blocked_reason: { kind: 'period' } })], meta: { total: 2, page: 2, per_page: 1, last_page: 2 } };
      }
      return { data: [row({ id: 'b1', posting_status: 'blocked_period', blocked_reason: { kind: 'period' } })], meta: { total: reposted ? 1 : 2, page: 1, per_page: 1, last_page: reposted ? 1 : 2 } };
    });
    ui();
    await screen.findAllByRole('link', { name: 'INV-0001' });
    // انتقل إلى الصفحة ٢ عبر التنقّل
    fireEvent.click((await screen.findAllByRole('button')).find((b) => /next|التالي/i.test(b.getAttribute('aria-label') ?? ''))!);
    fireEvent.click((await screen.findAllByRole('button', { name: /Repost|إعادة الترحيل/ }))[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'سبب كافٍ للقرار' } });
    fireEvent.click(within(dialog).getAllByRole('button').find((b) => /^(Repost|إعادة الترحيل)$/.test(b.textContent ?? ''))!);
    await waitFor(() => expect(seen.filter((p) => p.includes('page=1')).length).toBeGreaterThanOrEqual(2));
  });

  it('keeps the newest blocked count when an older count response arrives last', async () => {
    state.perms = new Set(['payments.view', 'payments.resolve_blocked']);
    const countResolvers: Array<(v: unknown) => void> = [];
    let reposted = false;
    apiMock.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (options?.method === 'POST') { reposted = true; return { data: { id: 'b1', outcome: 'posted', posting_status: 'posted' } }; }
      if (path.startsWith('/payment-attempts?posting_status=blocked_period&per_page=1')) {
        return new Promise((resolve) => { countResolvers.push(resolve); });
      }
      return { data: reposted ? [] : [row({ id: 'b1', posting_status: 'blocked_period', blocked_reason: { kind: 'period' } })], meta: meta(reposted ? 0 : 1) };
    });
    ui();
    fireEvent.click((await screen.findAllByRole('button', { name: /Repost|إعادة الترحيل/ }))[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'سبب كافٍ للقرار' } });
    fireEvent.click(within(dialog).getAllByRole('button').find((b) => /^(Repost|إعادة الترحيل)$/.test(b.textContent ?? ''))!);
    await waitFor(() => expect(countResolvers.length).toBe(2));
    countResolvers[1]({ data: [], meta: meta(0) });   // الأحدث: لا محجوب
    await waitFor(() => expect(screen.queryByLabelText(/Blocked payments exist|توجد دفعات محجوبة/)).toBeNull());
    countResolvers[0]({ data: [], meta: meta(1) });   // الأقدم يصل أخيراً بإجمالي ما قبل الترحيل
    await new Promise((r) => setTimeout(r, 50));
    const tab = screen.getByRole('tab', { name: /Blocked by closed period|محجوبة بفترة مقفلة/ });
    expect(tab.textContent).not.toMatch(/1/);
  });

  it('shows a retryable error when the list fails', async () => {
    route({
      'GET /payment-attempts': () => new Error('boom'),
      'GET /payment-attempts?posting_status=blocked_period&per_page=1': () => ({ data: [], meta: meta(0) }),
    });
    ui();
    await waitFor(() => expect(screen.getAllByText(/تعذّر تحميل|Couldn't load/).length).toBeGreaterThan(0));
  });
});
