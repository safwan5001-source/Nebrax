// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_MESSAGES, type TestLocale } from '@/test-utils/intl';
import { attemptSummary, FILL_ID, FILL_ID_2, readyReadiness, row, STATION_ID, workspace } from './__fixtures__';

const state = vi.hoisted(() => ({ permissions: ['*'] as string[], handler: (_path: string) => ({}) as unknown }));
const calls = vi.hoisted(() => [] as Array<{ path: string; method: string }>);

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/lib/auth', () => ({ currentUser: () => ({ permissions: state.permissions }) }));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(async (path: string, opts: { method?: string } = {}) => {
    calls.push({ path, method: opts.method ?? 'GET' });
    if (path === '/fuel-stations/stations') return { data: [{ id: STATION_ID, name: 'محطة الدمام', code: 'DMM', status: 'active' }] };
    const result = state.handler(path);
    if (result instanceof Error) throw result;
    return result;
  }),
}));

import { ApiError } from '@/lib/api';
import { FillsScreen } from './fills-screen';

const T = (locale: TestLocale) => TEST_MESSAGES[locale].fuelTankerFills;
const workspaceCalls = () => calls.filter((c) => c.path.startsWith('/fuel-stations/tanker-fills/inventory-workspace'));

const pendingRows = () => [
  row({}, null, readyReadiness({ readiness: 'blocked', blockers: ['stock_record_missing', 'surprise_code'] })),
  row({ id: FILL_ID_2, number: 'FTF-2027-00002', voucher_number: '00077' }, { posting_status: null, posted_at: null, reversed_at: null, posted_cost_minor: null, last_attempt: attemptSummary({ reason_code: 'period_locked' }), attempts_count: 1 }, readyReadiness()),
];

beforeEach(() => {
  calls.length = 0;
  state.permissions = ['*'];
  state.handler = () => workspace(pendingRows(), { pending: 2, posted: 5, reversed: 1, attention: 1 });
});
afterEach(cleanup);

describe.each(['ar', 'en'] as const)('FillsScreen (%s)', (locale) => {
  const text = T(locale);
  const mount = () => renderIntl(<FillsScreen />, locale);

  it('shows four tabs with server counts, defaults to pending, and asks only for the workspace list (GET)', async () => {
    mount();
    const tablist = await screen.findByRole('tablist');
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      `${text.tabs.pending}2`, `${text.tabs.posted}5`, `${text.tabs.reversed}1`, `${text.tabs.attention}1`,
    ]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(workspaceCalls()).toHaveLength(1));
    expect(workspaceCalls()[0].path).toBe('/fuel-stations/tanker-fills/inventory-workspace');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('switching tab refetches with the tab and resets the page', async () => {
    mount();
    await screen.findAllByText('FTF-2027-00001');
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(text.tabs.attention) }));
    await waitFor(() => expect(workspaceCalls().some((c) => c.path.includes('tab=attention'))).toBe(true));
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(text.tabs.posted) }));
    await waitFor(() => expect(workspaceCalls().some((c) => c.path.includes('tab=posted'))).toBe(true));
  });

  it('keeps the fill state and the last attempt apart: a status badge and a separate "last attempt" chip', async () => {
    mount();
    await screen.findAllByText('FTF-2027-00002');
    const rows = Array.from(document.querySelectorAll('tr[data-fill-row]')) as HTMLElement[];
    const second = rows.find((el) => el.textContent?.includes('FTF-2027-00002')) as HTMLElement;
    expect(within(second).getByText(text.inventoryStatus.pending_integration)).toBeTruthy();
    const chip = second.querySelector('[data-attempt-chip]') as HTMLElement;
    expect(chip.getAttribute('data-outcome')).toBe('rejected');
    expect(chip.textContent).toContain(text.attempt.label);
    expect(chip.textContent).toContain(text.operation.post);
    expect(chip.textContent).toContain(text.attempt.outcome.rejected);
    expect(chip.textContent).toContain(text.reason.period_locked);
    // الحالة لا تتبع المحاولة: بقيت «بانتظار الدمج» رغم الرفض.
    expect(second.getAttribute('data-inventory-status')).toBe('pending_integration');
    // الصف الأول بلا محاولة ⇒ لا شارة.
    const first = rows.find((el) => el.textContent?.includes('FTF-2027-00001')) as HTMLElement;
    expect(first.querySelector('[data-attempt-chip]')).toBeNull();
  });

  it('shows the electronic number and the paper voucher separately, readiness and translated blockers (unknown codes raw)', async () => {
    mount();
    await screen.findAllByText('FTF-2027-00001');
    const first = (Array.from(document.querySelectorAll('tr[data-fill-row]')) as HTMLElement[])[0];
    expect(first.textContent).toContain('FTF-2027-00001');
    expect(first.textContent).toContain('04052');
    expect(within(first).getByText(text.readiness.blocked)).toBeTruthy();
    expect(within(first).getByText(text.blocker.stock_record_missing)).toBeTruthy();
    expect(within(first).getByText(text.blocker.unknown.replace('{code}', 'surprise_code'))).toBeTruthy();
  });

  it('renders both the mobile cards and the desktop table, linking to the detail by id', async () => {
    mount();
    await screen.findAllByText('FTF-2027-00001');
    expect(document.querySelectorAll('ul li[data-fill-row]').length).toBe(2);
    expect(document.querySelectorAll('tr[data-fill-row]').length).toBe(2);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(`/fuel-stations/tanker-fills/${FILL_ID}`);
    expect(hrefs).toContain(`/fuel-stations/tanker-fills/${FILL_ID_2}`);
    // بطاقة الجوال: السند الورقي والمحطة في سطر مستقل عن رقم السند الإلكتروني.
    const card = document.querySelector('ul li[data-fill-row]') as HTMLElement;
    expect(card.textContent).toContain('04052');
  });

  it('searches with a debounce and filters by station, sending station_id and q', async () => {
    mount();
    await screen.findAllByText('FTF-2027-00001');
    fireEvent.change(screen.getByRole('searchbox', { name: text.list.searchLabel }), { target: { value: ' 04052 ' } });
    await waitFor(() => expect(workspaceCalls().some((c) => c.path.includes('q=04052'))).toBe(true));
    await screen.findByRole('option', { name: /محطة الدمام/ });
    fireEvent.change(screen.getByLabelText(text.list.stationFilter), { target: { value: STATION_ID } });
    await waitFor(() => expect(workspaceCalls().some((c) => c.path.includes(`station_id=${STATION_ID}`))).toBe(true));
  });

  it('shows the empty state per tab and a no-results state with a clear-filters action', async () => {
    state.handler = () => workspace([], { pending: 0 });
    mount();
    expect(await screen.findByText(text.list.empty.pending)).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: text.list.searchLabel }), { target: { value: '999' } });
    expect(await screen.findByText(text.list.noResults)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: text.list.clearFilters }));
    expect(await screen.findByText(text.list.empty.pending)).toBeTruthy();
  });

  it('shows the friendly gate-closed state on a 404 and offers no list', async () => {
    state.handler = () => new ApiError(404, 'Not Found', {});
    mount();
    expect(await screen.findByText(TEST_MESSAGES[locale].fuelTankers.states.gateClosedTitle)).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('shows a forbidden state without any request when the permission is missing', async () => {
    state.permissions = ['fuel_stations.view'];
    mount();
    expect(await screen.findByText(TEST_MESSAGES[locale].fuelTankers.states.forbiddenTitle)).toBeTruthy();
    expect(screen.getByText('fuel.tanker.fill.inventory.view')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('shows an error with a retry on a server failure and a malformed response, then recovers', async () => {
    state.handler = () => new ApiError(500, 'boom', {});
    mount();
    expect(await screen.findByText(text.list.loadFailed)).toBeTruthy();
    state.handler = () => workspace(pendingRows(), { pending: 2 });
    fireEvent.click(screen.getByRole('button', { name: TEST_MESSAGES[locale].nebrax.retry }));
    await screen.findAllByText('FTF-2027-00001');

    cleanup();
    state.handler = () => ({ data: 'nope' });
    mount();
    expect(await screen.findByText(text.list.loadFailed)).toBeTruthy();
  });

  it('formats dates in the UI language (English never gets RLM-marked dates)', async () => {
    mount();
    await screen.findAllByText('FTF-2027-00001');
    const body = document.body.textContent ?? '';
    if (locale === 'en') expect(body).not.toContain('‏');
    else expect(body).toContain('‏');
  });
});
