// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_MESSAGES, type TestLocale } from '@/test-utils/intl';
import { ACCOUNT_CLEARING, actions, attemptSummary, detail, FILL_ID, postingFacts, postingPreview, readyReadiness, reversalPreview, STATION_ID } from './__fixtures__';

const state = vi.hoisted(() => ({ permissions: ['*'] as string[], handler: (_path: string, _opts?: { method?: string }) => ({}) as unknown }));
const calls = vi.hoisted(() => [] as Array<{ path: string; method: string }>);

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/lib/auth', () => ({ currentUser: () => ({ permissions: state.permissions }) }));
vi.mock('../attachments/tanker-fill-attachments', () => ({ TankerFillAttachments: ({ fillId }: { fillId: string }) => <div data-attachments-stub={fillId} /> }));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(async (path: string, opts: { method?: string } = {}) => {
    calls.push({ path, method: opts.method ?? 'GET' });
    if (path === '/fuel-stations/stations') return { data: [{ id: STATION_ID, name: 'محطة الدمام', code: 'DMM', status: 'active' }] };
    const result = state.handler(path, opts);
    if (result instanceof Error) throw result;
    return result;
  }),
}));

import { ApiError } from '@/lib/api';
import { FillDetailScreen } from './fill-detail-screen';

const T = (locale: TestLocale) => TEST_MESSAGES[locale].fuelTankerFills;

const postedDetail = (posting: Record<string, unknown> = postingFacts(), extra: Record<string, unknown> = {}) =>
  detail({ inventory_status: 'posted' }, { posting, accounts: { clearing: { id: ACCOUNT_CLEARING, code: '1145', name: 'وسيط التعبئة' }, inventory: { id: 'x', code: '1140', name: 'المخزون' } }, attempts: [{ id: 'a1', ...attemptSummary({ outcome: 'succeeded', reason_code: null }), actor: { id: 'u1', name: 'ماجد' } }] },
    { actions: actions({ preview_post: false, post: false, preview_reversal: true, reverse: true }), ...extra });

beforeEach(() => {
  calls.length = 0;
  state.permissions = ['*'];
  state.handler = () => detail({}, {}, { readiness: readyReadiness({ readiness: 'blocked', blockers: ['clearing_account_missing'] }) });
});
afterEach(cleanup);

describe.each(['ar', 'en'] as const)('FillDetailScreen (%s)', (locale) => {
  const text = T(locale);
  const mount = () => renderIntl(<FillDetailScreen fillId={FILL_ID} />, locale);

  it('shows the electronic number and the paper voucher as two separate fields, the owner, plate, station and liters', async () => {
    mount();
    const dl = (await screen.findByText(text.detail.basics)).closest('[data-awj-card]') as HTMLElement;
    const field = (label: string) => within(dl).getByText(label).closest('div') as HTMLElement;
    expect(field(text.field.number).textContent).toContain('FTF-2027-00001');
    expect(field(text.field.voucher).textContent).toContain('04052');
    expect(field(text.field.voucher).textContent).not.toContain('FTF');
    expect(field(text.field.owner).textContent).toContain('عسكر');
    expect(field(text.field.tanker).textContent).toContain('أ ب ج 1234');
    await waitFor(() => expect(field(text.field.station).textContent).toContain('محطة الدمام'));
    expect(field(text.field.quantity).textContent).toContain('2000.000');
    expect(calls.map((c) => c.method).every((m) => m === 'GET')).toBe(true);
    expect(calls[0].path).toBe(`/fuel-stations/tanker-fills/${FILL_ID}/inventory`);
    expect(document.querySelector(`[data-attachments-stub="${FILL_ID}"]`)).not.toBeNull();
  });

  it('shows buttons strictly from data.actions: pending with post allowed shows only the posting button', async () => {
    mount();
    await screen.findByText(text.detail.basics);
    expect(document.querySelector('[data-action="post"]')).not.toBeNull();
    expect(document.querySelector('[data-action="reverse"]')).toBeNull();
    expect(screen.getByRole('button', { name: text.actions.post })).toBeTruthy();
  });

  it('renders no action button at all when the server grants none — even for a wildcard permission holder', async () => {
    state.handler = () => detail({}, {}, { actions: actions({ preview_post: false, post: false }) });
    mount();
    await screen.findByText(text.detail.basics);
    expect(document.querySelector('[data-actions]')).toBeNull();
    expect(screen.queryByRole('button', { name: text.actions.post })).toBeNull();
    expect(screen.queryByRole('button', { name: text.actions.reverse })).toBeNull();
  });

  it('a posted fill shows only the reversal button when the server grants it, plus posting facts', async () => {
    state.handler = () => postedDetail();
    mount();
    await screen.findByText(text.detail.basics);
    expect(document.querySelector('[data-action="post"]')).toBeNull();
    expect(document.querySelector('[data-action="reverse"]')).not.toBeNull();
    const facts = document.querySelector('[data-posting-facts]') as HTMLElement;
    expect(facts.textContent).toContain('ماجد');
    expect(facts.textContent).toContain('JE-2027-00042');
    expect((facts.querySelector('[data-amount]') as HTMLElement).textContent).toContain('6,543.21');
    expect(document.querySelector('[data-no-posting]')).toBeNull();
  });

  it('masks what the server withheld: no cost, no journal and no movement ids without cost permission; no accounts without accounts.view', async () => {
    const withheld = postingFacts();
    for (const key of ['posted_cost_minor', 'journal_entry', 'reversal_journal_entry', 'stock_movement_id', 'cost_movement_id', 'reversal_stock_movement_id', 'reversal_cost_movement_id']) delete (withheld as Record<string, unknown>)[key];
    const payload = postedDetail(withheld);
    (payload.data.inventory as Record<string, unknown>).accounts = null;
    state.handler = () => payload;
    mount();
    await screen.findByText(text.detail.basics);
    expect(document.querySelector('[data-amount]')).toBeNull();
    expect(document.querySelector('[data-journal]')).toBeNull();
    expect(document.querySelector('[data-movements]')).toBeNull();
    expect(document.querySelector('[data-accounts]')).toBeNull();
    expect(screen.getByText(text.posting.costHidden)).toBeTruthy();
    expect(document.body.textContent).not.toContain('654');
  });

  it('shows the historical accounts only when the server sent them, and movement ids behind a collapsed section', async () => {
    state.handler = () => postedDetail();
    mount();
    await screen.findByText(text.detail.basics);
    const accounts = document.querySelector('[data-accounts]') as HTMLElement;
    expect(accounts.textContent).toContain('1145');
    expect(accounts.textContent).toContain('وسيط التعبئة');
    expect(accounts.textContent).toContain('1140');
    const movements = document.querySelector('[data-movements]') as HTMLDetailsElement;
    expect(movements.open).toBe(false);
    expect(movements.textContent).toContain('aaaaaaaa…');
  });

  it('shows reversal facts for a reversed fill, with the reason and the reversing entry', async () => {
    state.handler = () => detail({ inventory_status: 'reversed' }, {
      posting: postingFacts({ status: 'reversed', reversed_by: { id: 'u2', name: 'سلمان' }, reversed_at: '2027-02-01T08:00:00+03:00', reversal_reason: 'خطأ في الكمية', reversal_journal_entry: { id: 'je2', number: 'JE-2027-00050' }, reversal_stock_movement_id: 'cccccccc-3333-4333-8333-333333333333', reversal_cost_movement_id: 'dddddddd-4444-4444-8444-444444444444' }),
    }, { actions: actions({ preview_post: false, post: false }) });
    mount();
    await screen.findByText(text.detail.basics);
    expect((document.querySelector('[data-reversal-reason]') as HTMLElement).textContent).toBe('خطأ في الكمية');
    expect((document.querySelector('[data-posting-facts]') as HTMLElement).textContent).toContain('JE-2027-00050');
    expect(document.querySelector('[data-actions]')).toBeNull();
  });

  it('lists the attempts history with operation, outcome, reason and actor, apart from the fill state', async () => {
    state.handler = () => detail({}, { attempts: [
      { id: 'a2', ...attemptSummary({ reason_code: 'insufficient_stock' }), actor: { id: 'u1', name: 'ماجد' } },
      { id: 'a1', ...attemptSummary({ outcome: 'failed', reason_code: 'mystery_code', attempted_at: '2027-01-26T08:00:00+03:00' }), actor: { id: 'u1', name: 'ماجد' } },
    ] });
    mount();
    await screen.findByText(text.attempts.title);
    const items = Array.from(document.querySelectorAll('[data-attempts] li')) as HTMLElement[];
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain(text.attempt.outcome.rejected);
    expect(items[0].textContent).toContain(text.reason.insufficient_stock);
    expect(items[1].textContent).toContain(text.reason.unknown.replace('{code}', 'mystery_code'));
    // شارة آخر محاولة في بطاقة الدمج منفصلة عن شارة الحالة.
    const stateRow = document.querySelector('[data-state-row]') as HTMLElement;
    expect(within(stateRow).getByText(text.inventoryStatus.pending_integration)).toBeTruthy();
    expect(stateRow.querySelector('[data-attempt-chip]')).toBeNull();
    expect((document.querySelector('[data-last-attempt] [data-attempt-chip]') as HTMLElement).getAttribute('data-outcome')).toBe('rejected');
  });

  it('shows the empty attempts message and the not-posted note for a fresh fill', async () => {
    mount();
    expect(await screen.findByText(text.attempts.empty)).toBeTruthy();
    expect(screen.getByText(text.detail.noPosting)).toBeTruthy();
    expect(screen.getByText(text.readiness.blocked)).toBeTruthy();
    expect(screen.getByText(text.blocker.clearing_account_missing)).toBeTruthy();
  });

  it('marks a voided fill and a historical one', async () => {
    state.handler = () => detail({ status: 'voided', voided_at: '2027-01-27T08:00:00+03:00', void_reason: 'سند خاطئ' }, {}, { readiness: readyReadiness({ historical: true, overdue: true }), actions: actions({ preview_post: false, post: false }) });
    mount();
    await screen.findByText(text.detail.basics);
    expect(document.querySelector('[data-voided]')).not.toBeNull();
    expect(document.querySelector('[data-historical-badge]')).not.toBeNull();
    expect(screen.getByText('سند خاطئ')).toBeTruthy();
  });

  it('handles a 404 as not found (no leak), a 403 as forbidden, a malformed response and a bad id', async () => {
    state.handler = () => new ApiError(404, 'Not Found', {});
    mount();
    expect(await screen.findByText(text.detail.notFoundTitle)).toBeTruthy();
    cleanup();
    state.handler = () => new ApiError(403, 'Forbidden', {});
    mount();
    expect(await screen.findByText(TEST_MESSAGES[locale].fuelTankers.states.forbiddenTitle)).toBeTruthy();
    cleanup();
    state.handler = () => ({ data: { id: 'x' } });
    mount();
    expect(await screen.findByText(text.detail.loadFailed)).toBeTruthy();
    cleanup();
    calls.length = 0;
    renderIntl(<FillDetailScreen fillId="not-a-uuid" />, locale);
    expect(await screen.findByText(text.detail.notFoundTitle)).toBeTruthy();
    expect(calls.filter((c) => c.path.includes('/inventory'))).toHaveLength(0);
  });

  it('forbids without the view permission and never requests the fill', async () => {
    state.permissions = ['fuel_stations.view', 'fuel.tanker.view'];
    mount();
    expect(await screen.findByText(TEST_MESSAGES[locale].fuelTankers.states.forbiddenTitle)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('opens the posting dialog from the button and the reversal dialog from its button (previews are GETs)', async () => {
    state.handler = (path) => (path.endsWith('/inventory-posting/preview') ? postingPreview() : path.endsWith('/inventory-reversal/preview') ? reversalPreview() : detail({}, {}, { actions: actions({ preview_reversal: true, reverse: true }) }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: text.actions.post }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/inventory-posting/preview'))).toBe(true));
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });
});
