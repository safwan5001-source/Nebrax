// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
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

const wh = (id: string, over: Record<string, unknown> = {}) => ({ id, code: `0000${id}`, name: `مخزن ${id}`, city: null, is_active: true, ...over });
const schedule = (windows = 1, enabled = true) => ({
  data: {
    settings: { enabled, required: true, timezone: 'Asia/Riyadh', lead_time_minutes: 0, cutoff_time: null, max_days_ahead: 30 },
    slots: Array.from({ length: windows }, (_, i) => ({ id: `w${i}`, method: 'delivery', label: 'x', label_en: null, start_time: '09:00', end_time: '12:00', weekdays: [0], capacity: null, shipping_zone_id: null, sort_order: i, is_active: true })),
    blocked_dates: [],
  },
});
const fulfil = (current: unknown, warehouses: unknown[]) => ({ data: { fulfillment: { warehouse: current }, warehouses } });

function open(state: { current: unknown; warehouses: unknown[]; windows?: number; rejectSave?: ApiError }) {
  window.history.replaceState(null, '', '/commerce/delivery?tab=fulfilment');
  const writes: unknown[] = [];
  apiMock.mockImplementation(async (path: string, options?: { method?: string; body?: { warehouse_id: string } }) => {
    if (path.endsWith('/fulfillment')) {
      if (options?.method === 'PUT') {
        if (state.rejectSave) throw state.rejectSave;
        writes.push(options.body);
        state.current = (state.warehouses as { id: string }[]).find((w) => w.id === options.body!.warehouse_id) ?? null;
      }
      return fulfil(state.current, state.warehouses);
    }
    return schedule(state.windows ?? 1);
  });
  renderIntl(
    <ToastProvider>
      <DeliveryWorkspace storeId="s1" locale="en" />
    </ToastProvider>,
    'en',
  );
  return writes;
}

describe('FulfillmentPanel', () => {
  it('explains why the warehouse is needed and states no assignment honestly', async () => {
    open({ current: null, warehouses: [wh('1'), wh('2')] });
    expect(await screen.findByRole('region', { name: 'Fulfilment warehouse' })).toBeTruthy();
    expect(screen.getByText(/To compute “Deliver today”/)).toBeTruthy();
    expect(document.querySelector('[data-fulfillment-current]')?.textContent).toContain('No warehouse assigned yet');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-readiness="warehouse"]')?.getAttribute('data-done')).toBe('false');
  });

  it('assigns a warehouse with only its id and then reports the prerequisite as met', async () => {
    const writes = open({ current: null, warehouses: [wh('1'), wh('2')] });
    await userEvent.selectOptions(await screen.findByLabelText('Fulfilment warehouse', { selector: 'select' }), '2');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(writes).toEqual([{ warehouse_id: '2' }]));
    await waitFor(() => expect(document.querySelector('[data-fulfillment-current]')?.textContent).toContain('مخزن 2'));
    expect(document.querySelector('[data-readiness="warehouse"]')?.getAttribute('data-done')).toBe('true');
    expect(screen.getByText('All changes saved')).toBeTruthy();
  });

  it('warns the browser before leaving with an unsaved choice, like every other settings screen', async () => {
    open({ current: null, warehouses: [wh('1'), wh('2')] });
    const select = await screen.findByLabelText('Fulfilment warehouse', { selector: 'select' });
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);
    await userEvent.selectOptions(select, '2');
    expect(leave()).toBe(true);
  });

  it('offers only active warehouses and warns when the assigned one went inactive', async () => {
    open({ current: wh('1', { is_active: false }), warehouses: [wh('1', { is_active: false }), wh('2'), wh('3', { is_active: false })] });
    await screen.findByRole('region', { name: 'Fulfilment warehouse' });
    expect(screen.getByText(/currently inactive/)).toBeTruthy();
    const options = Array.from((screen.getByLabelText('Fulfilment warehouse', { selector: 'select' }) as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(['1', '2']);
    expect(document.querySelector('[data-readiness="warehouse"]')?.getAttribute('data-done')).toBe('false');
  });

  it('shows an empty state with a way to create a warehouse when none exist', async () => {
    open({ current: null, warehouses: [] });
    expect(await screen.findByText('No active warehouses')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create warehouse' }).getAttribute('href')).toBe('/warehouses/new');
  });

  it('surfaces the server rejection and keeps the choice', async () => {
    open({ current: null, warehouses: [wh('1')], rejectSave: new ApiError(422, 'المخزن غير موجود.', {}) });
    await userEvent.selectOptions(await screen.findByLabelText('Fulfilment warehouse', { selector: 'select' }), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('المخزن غير موجود.')).toBeTruthy();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('does not block the schedule when the fulfilment read fails', async () => {
    window.history.replaceState(null, '', '/commerce/delivery');
    apiMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/fulfillment')) throw new ApiError(500, 'x', {});
      return schedule(1);
    });
    renderIntl(<ToastProvider><DeliveryWorkspace storeId="s1" locale="en" /></ToastProvider>, 'en');
    expect(await screen.findByRole('switch', { name: 'Enable delivery date selection' })).toBeTruthy();
    expect(document.querySelector('[data-readiness="warehouse"]')).toBeNull();
  });
});
