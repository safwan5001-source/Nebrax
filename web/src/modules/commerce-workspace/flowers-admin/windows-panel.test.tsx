// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
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

const slot = (over: Record<string, unknown> = {}) => ({
  id: 'w1', method: 'delivery', label: 'صباحاً', label_en: 'Morning', start_time: '09:00', end_time: '12:00',
  weekdays: [0, 1, 2, 3, 4, 5, 6], capacity: null, shipping_zone_id: null, sort_order: 0, is_active: true, ...over,
});
const doc = (slots: unknown[]) => ({
  data: {
    settings: { enabled: true, required: true, timezone: 'Asia/Riyadh', lead_time_minutes: 0, cutoff_time: null, max_days_ahead: 30 },
    slots,
    blocked_dates: [],
  },
});
const zones = { data: [{ id: 'z1', name: 'الرياض', match_type: 'city', match_value: 'riyadh', rate_amount_minor: 1000, is_active: true }] };

/** يوجّه كل مسار لجوابه: الكتابة تعيد مستنداً مبنياً من الجسم المرسَل (كما يفعل الخادم). */
function server(initial: unknown[], opts: { rejectSave?: ApiError } = {}) {
  let current = initial;
  const writes: unknown[] = [];
  apiMock.mockImplementation(async (path: string, options?: { method?: string; body?: { slots: Record<string, unknown>[] } }) => {
    if (path.includes('shipping-zones')) return zones;
    if (options?.method === 'PUT' && path.endsWith('/slots')) {
      if (opts.rejectSave) throw opts.rejectSave;
      writes.push(options.body);
      current = options.body!.slots.map((s, i) => ({
        id: s.id ?? `new-${i}`, label_en: null, shipping_zone_id: null, sort_order: i, ...s,
        weekdays: s.weekdays,
      }));
      return doc(current);
    }
    return doc(current);
  });
  return { writes, setRemote: (next: unknown[]) => { current = next; } };
}

async function openWindows(slots: unknown[], opts: { rejectSave?: ApiError } = {}) {
  window.history.replaceState(null, '', '/commerce/delivery?tab=windows');
  const srv = server(slots, opts);
  renderIntl(
    <ToastProvider>
      <DeliveryWorkspace storeId="s1" locale="en" />
    </ToastProvider>,
    'en',
  );
  await screen.findByRole('region', { name: 'Delivery windows' });
  return srv;
}

describe('WindowsPanel', () => {
  it('opens on the deep-linked tab and lists windows grouped by method with real values', async () => {
    await openWindows([slot(), slot({ id: 'p1', method: 'pickup', label: 'من الفرع', start_time: '10:00', end_time: '20:00', capacity: 15, weekdays: [0, 1, 5], is_active: false })]);
    const delivery = document.querySelector('[data-window-group="delivery"]') as HTMLElement;
    const pickup = document.querySelector('[data-window-group="pickup"]') as HTMLElement;
    expect(within(delivery).getByText('صباحاً')).toBeTruthy();
    expect(delivery.textContent).toContain('09:00 – 12:00');
    expect(delivery.textContent).toContain('Every day');
    expect(delivery.textContent).toContain('Unlimited');
    expect(pickup.textContent).toContain('15 orders per day');
    expect(pickup.textContent).toContain('Sun, Mon, Fri');
    expect(within(pickup).getByText('Off')).toBeTruthy();
    expect(window.location.search).toBe('?tab=windows');
  });

  it('shows the empty state with an add action', async () => {
    await openWindows([]);
    expect(screen.getByText('No delivery windows yet')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add window' }).length).toBeGreaterThan(0);
  });

  it('adds a window: validates locally, then sends the whole list with the new one id-less', async () => {
    const srv = await openWindows([slot()]);
    await userEvent.click(screen.getAllByRole('button', { name: 'Add window' })[0]);
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('This field is required.')).toBeTruthy();
    expect(srv.writes).toHaveLength(0);

    await userEvent.type(within(dialog).getByLabelText('Window name'), 'مساءً');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Store pickup' }));
    await userEvent.type(within(dialog).getByLabelText('Capacity (optional)'), '8');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const sent = (srv.writes[0] as { slots: Record<string, unknown>[] }).slots;
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ id: 'w1' });
    expect('id' in sent[1]).toBe(false);
    expect(sent[1]).toMatchObject({ method: 'pickup', label: 'مساءً', capacity: 8, shipping_zone_id: null, weekdays: [0, 1, 2, 3, 4, 5, 6] });
    expect(await screen.findByText('مساءً')).toBeTruthy();
  });

  it('rejects an end time that does not follow the start before any request', async () => {
    const srv = await openWindows([slot()]);
    await userEvent.click(screen.getAllByRole('button', { name: 'Add window' })[0]);
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Window name'), 'x');
    const end = within(dialog).getByLabelText('To') as HTMLInputElement;
    await userEvent.clear(end);
    await userEvent.type(end, '08:00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('The window must end after it starts on the same day.')).toBeTruthy();
    expect(end.getAttribute('aria-invalid')).toBe('true');
    expect(srv.writes).toHaveLength(0);
  });

  it('edits in place keeping the id, and offers real shipping zones for delivery', async () => {
    const srv = await openWindows([slot()]);
    await userEvent.click(screen.getByRole('button', { name: 'Edit: صباحاً' }));
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByRole('option', { name: 'الرياض' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Delivery destination'), 'z1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(srv.writes).toHaveLength(1));
    expect((srv.writes[0] as { slots: Record<string, unknown>[] }).slots[0]).toMatchObject({ id: 'w1', shipping_zone_id: 'z1' });
  });

  it('toggles active and reorders only within the method, sending the full list each time', async () => {
    const srv = await openWindows([slot({ id: 'a', label: 'A' }), slot({ id: 'b', label: 'B', start_time: '13:00', end_time: '15:00' })]);
    await userEvent.click(screen.getByRole('switch', { name: 'A: Active (visible to shoppers)' }));
    await waitFor(() => expect(srv.writes).toHaveLength(1));
    expect((srv.writes[0] as { slots: Record<string, unknown>[] }).slots.map((s) => [s.id, s.is_active])).toEqual([['a', false], ['b', true]]);

    await userEvent.click(screen.getByRole('button', { name: 'Move up: B' }));
    await waitFor(() => expect(srv.writes).toHaveLength(2));
    expect((srv.writes[1] as { slots: Record<string, unknown>[] }).slots.map((s) => s.id)).toEqual(['b', 'a']);
    expect((screen.getByRole('button', { name: 'Move up: B' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('confirms deletion, explains orders are untouched, and then sends the list without the window', async () => {
    const srv = await openWindows([slot({ id: 'a', label: 'A' }), slot({ id: 'b', label: 'B' })]);
    await userEvent.click(screen.getByRole('button', { name: 'Delete: A' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Existing orders keep their recorded slot');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(srv.writes).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Delete: A' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(srv.writes).toHaveLength(1));
    expect((srv.writes[0] as { slots: Record<string, unknown>[] }).slots.map((s) => s.id)).toEqual(['b']);
  });

  it('shows the server rejection inside the dialog and keeps it open', async () => {
    await openWindows([slot()], { rejectSave: new ApiError(422, 'سعة النافذة خارج النطاق المسموح.', {}) });
    await userEvent.click(screen.getAllByRole('button', { name: 'Add window' })[0]);
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Window name'), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('سعة النافذة خارج النطاق المسموح.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('refuses to overwrite windows another admin changed: refreshes the view and does not write', async () => {
    const srv = await openWindows([slot({ id: 'a', label: 'A' })]);
    srv.setRemote([slot({ id: 'a', label: 'A' }), slot({ id: 'z', label: 'Added elsewhere' })]);
    await userEvent.click(screen.getByRole('button', { name: 'Delete: A' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText(/changed on the server since you opened this page/)).toBeTruthy();
    expect(srv.writes).toHaveLength(0);
  });
});
