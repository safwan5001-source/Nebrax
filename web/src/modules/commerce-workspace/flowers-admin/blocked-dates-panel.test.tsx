// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

import { ApiError } from '@/lib/api';
import { ToastProvider } from '@/components/ui/toast';
import { renderIntl } from '@/test-utils/intl';
import { DeliveryWorkspace } from './delivery-workspace';

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  window.history.replaceState(null, '', '/');
});

type Row = { date: string; method: string; reason: string | null };
const doc = (blocked: Row[]) => ({
  data: {
    settings: { enabled: true, required: true, timezone: 'Asia/Riyadh', lead_time_minutes: 0, cutoff_time: null, max_days_ahead: 30 },
    slots: [],
    blocked_dates: blocked,
  },
});

function server(initial: Row[], opts: { rejectSave?: ApiError } = {}) {
  let current = initial;
  const writes: Row[][] = [];
  apiMock.mockImplementation(async (path: string, options?: { method?: string; body?: { blocked_dates: Row[] } }) => {
    if (options?.method === 'PUT' && path.endsWith('/blocked-dates')) {
      if (opts.rejectSave) throw opts.rejectSave;
      writes.push(options.body!.blocked_dates);
      current = [...options.body!.blocked_dates].sort((a, b) => a.date.localeCompare(b.date));
    }
    return doc(current);
  });
  return { writes, setRemote: (next: Row[]) => { current = next; } };
}

async function openBlocked(initial: Row[], opts: { rejectSave?: ApiError } = {}) {
  window.history.replaceState(null, '', '/commerce/delivery?tab=blocked');
  const srv = server(initial, opts);
  renderIntl(
    <ToastProvider>
      <DeliveryWorkspace storeId="s1" locale="en" />
    </ToastProvider>,
    'en',
  );
  await screen.findByRole('region', { name: 'Blocked dates' });
  return srv;
}

const FUTURE = '2099-12-25';
const PAST = '2000-01-01';

describe('BlockedDatesPanel', () => {
  it('shows the empty state and explains the date is in the store time zone', async () => {
    await openBlocked([]);
    expect(screen.getByText('No blocked dates')).toBeTruthy();
    expect(screen.getByText(/calendar day in the store time zone \(Asia\/Riyadh\)/)).toBeTruthy();
  });

  it('lists upcoming first with weekday + day/month/year, and folds past dates away', async () => {
    await openBlocked([{ date: FUTURE, method: 'all', reason: 'Holiday' }, { date: PAST, method: 'pickup', reason: null }]);
    const upcoming = document.querySelector('[data-blocked-upcoming]') as HTMLElement;
    expect(upcoming.textContent).toContain('Friday');
    expect(upcoming.textContent).toContain('25/12/2099');
    expect(upcoming.textContent).toContain('All methods');
    expect(upcoming.textContent).toContain('Holiday');
    expect(screen.queryByText('01/01/2000')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Past (1)' }));
    expect(screen.getByText('01/01/2000')).toBeTruthy();
  });

  it('adds a date as a plain Y-m-d string with the reason trimmed, sending the full list', async () => {
    const srv = await openBlocked([{ date: '2099-11-01', method: 'all', reason: null }]);
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: FUTURE } });
    await userEvent.selectOptions(screen.getByLabelText('Applies to'), 'delivery');
    await userEvent.type(screen.getByLabelText('Reason (optional)'), '  Holiday  ');
    await userEvent.click(screen.getByRole('button', { name: 'Block date' }));

    await waitFor(() => expect(srv.writes).toHaveLength(1));
    expect(srv.writes[0]).toEqual([
      { date: '2099-11-01', method: 'all', reason: null },
      { date: FUTURE, method: 'delivery', reason: 'Holiday' },
    ]);
    expect(await screen.findByText('25/12/2099')).toBeTruthy();
  });

  it('refuses an empty/invalid date, a duplicate and a redundant partial block before any request', async () => {
    const srv = await openBlocked([{ date: FUTURE, method: 'all', reason: null }]);
    await userEvent.click(screen.getByRole('button', { name: 'Block date' }));
    expect(screen.getByText('Pick a date.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: FUTURE } });
    await userEvent.click(screen.getByRole('button', { name: 'Block date' }));
    expect(screen.getByText('This date is already blocked for the same method.')).toBeTruthy();
    expect(screen.getByLabelText('Date').getAttribute('aria-describedby')).toBe('blk-error');

    await userEvent.selectOptions(screen.getByLabelText('Applies to'), 'pickup');
    await userEvent.click(screen.getByRole('button', { name: 'Block date' }));
    expect(screen.getByText('This day is already blocked for all methods.')).toBeTruthy();
    expect(srv.writes).toHaveLength(0);
  });

  it('removes one block by sending the list without it', async () => {
    const srv = await openBlocked([{ date: FUTURE, method: 'all', reason: null }, { date: '2099-12-26', method: 'pickup', reason: null }]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove block: 25/12/2099' }));
    await waitFor(() => expect(srv.writes).toHaveLength(1));
    expect(srv.writes[0]).toEqual([{ date: '2099-12-26', method: 'pickup', reason: null }]);
  });

  it('removes past dates only after confirmation, keeping upcoming ones', async () => {
    const srv = await openBlocked([{ date: PAST, method: 'all', reason: null }, { date: FUTURE, method: 'all', reason: null }]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove past dates' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('does not affect any order');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(srv.writes).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Remove past dates' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove past dates' }));
    await waitFor(() => expect(srv.writes).toHaveLength(1));
    expect(srv.writes[0]).toEqual([{ date: FUTURE, method: 'all', reason: null }]);
  });

  it('shows server rejections and never overwrites a list another admin changed', async () => {
    const failing = await openBlocked([], { rejectSave: new ApiError(422, 'سبب الحجب أطول من المسموح.', {}) });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: FUTURE } });
    await userEvent.click(screen.getByRole('button', { name: 'Block date' }));
    expect(await screen.findByText('سبب الحجب أطول من المسموح.')).toBeTruthy();
    expect(failing.writes).toHaveLength(0);

    cleanup();
    apiMock.mockReset();
    const srv = await openBlocked([]);
    srv.setRemote([{ date: '2099-01-01', method: 'all', reason: 'Added elsewhere' }]);
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: FUTURE } });
    await userEvent.click(screen.getByRole('button', { name: 'Block date' }));
    expect(await screen.findByText(/changed on the server since you opened this page/)).toBeTruthy();
    expect(srv.writes).toHaveLength(0);
    expect(await screen.findByText('Added elsewhere')).toBeTruthy();
  });
});
