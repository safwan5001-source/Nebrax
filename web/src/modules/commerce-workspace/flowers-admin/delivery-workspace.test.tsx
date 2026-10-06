// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
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
});

const doc = (settings: Record<string, unknown> = {}, slots: unknown[] = []) => ({
  data: {
    settings: { enabled: true, required: true, timezone: 'Asia/Riyadh', lead_time_minutes: 120, cutoff_time: null, max_days_ahead: 30, ...settings },
    slots,
    blocked_dates: [],
  },
});
const slot = (over: Record<string, unknown> = {}) => ({
  id: 'w1', method: 'delivery', label: 'صباحاً', label_en: null, start_time: '09:00', end_time: '12:00', weekdays: [0, 1, 2, 3, 4, 5, 6], capacity: null, shipping_zone_id: null, sort_order: 0, is_active: true, ...over,
});

function renderWorkspace(storeId = 's1') {
  return renderIntl(
    <ToastProvider>
      <DeliveryWorkspace storeId={storeId} locale="en" />
    </ToastProvider>,
    'en',
  );
}

describe('DeliveryWorkspace — availability rules', () => {
  it('loads persisted rules, shows the lead time in the best unit and the channel clock', async () => {
    apiMock.mockResolvedValueOnce(doc({ lead_time_minutes: 180, cutoff_time: '15:30', max_days_ahead: 14 }, [slot()]));
    renderWorkspace();

    expect(await screen.findByRole('switch', { name: 'Enable delivery date selection' })).toBeTruthy();
    expect((screen.getByLabelText('Lead time before delivery') as HTMLInputElement).value).toBe('3');
    expect((screen.getByLabelText('Lead time unit') as HTMLSelectElement).value).toBe('hours');
    expect((screen.getByLabelText('Cut-off time') as HTMLInputElement).value).toBe('15:30');
    expect((screen.getByLabelText('Maximum booking horizon') as HTMLInputElement).value).toBe('14');
    expect(document.querySelector('[data-schedule-clock]')?.textContent).toMatch(/Time now in the store: \d\d:\d\d/);
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/s1/delivery-schedule');
  });

  it('shows honest readiness: enabled and active windows are separate prerequisites', async () => {
    apiMock.mockResolvedValueOnce(doc({ enabled: true }, [slot({ is_active: false })]));
    renderWorkspace();
    await screen.findByRole('switch', { name: 'Enable delivery date selection' });

    expect(document.querySelector('[data-readiness="enabled"]')?.getAttribute('data-done')).toBe('true');
    expect(document.querySelector('[data-readiness="windows"]')?.getAttribute('data-done')).toBe('false');
    expect(screen.getByText('Active delivery windows: 0')).toBeTruthy();
    expect(screen.getByText(/basic prerequisites only/)).toBeTruthy();
  });

  it('saves all six fields, converts units to minutes and re-renders what the server returned', async () => {
    apiMock
      .mockResolvedValueOnce(doc({ enabled: false }, [slot()]))
      .mockResolvedValueOnce(doc({ enabled: true, lead_time_minutes: 2880, cutoff_time: '14:00', max_days_ahead: 45 }, [slot()]));
    renderWorkspace();
    await userEvent.click(await screen.findByRole('switch', { name: 'Enable delivery date selection' }));
    const lead = screen.getByLabelText('Lead time before delivery');
    await userEvent.clear(lead);
    await userEvent.type(lead, '2');
    await userEvent.selectOptions(screen.getByLabelText('Lead time unit'), 'days');
    fireEvent.change(screen.getByLabelText('Cut-off time'), { target: { value: '14:00' } });
    const days = screen.getByLabelText('Maximum booking horizon');
    await userEvent.clear(days);
    await userEvent.type(days, '45');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText('All changes saved')).toBeTruthy());
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/workspace/storefronts/s1/delivery-schedule/settings', {
      method: 'PUT',
      body: { is_enabled: true, is_required: true, timezone: 'Asia/Riyadh', lead_time_minutes: 2880, cutoff_time: '14:00', max_days_ahead: 45 },
    });
    expect(document.querySelector('[data-readiness="enabled"]')?.getAttribute('data-done')).toBe('true');
  });

  it('refuses invalid inputs locally with described errors and never calls the server', async () => {
    apiMock.mockResolvedValueOnce(doc({}, [slot()]));
    renderWorkspace();
    const lead = await screen.findByLabelText('Lead time before delivery');
    await userEvent.clear(lead);
    await userEvent.type(lead, '99');
    await userEvent.selectOptions(screen.getByLabelText('Lead time unit'), 'days');
    fireEvent.blur(lead);
    const days = screen.getByLabelText('Maximum booking horizon');
    await userEvent.clear(days);
    await userEvent.type(days, '500');
    fireEvent.blur(days);

    expect(lead.getAttribute('aria-invalid')).toBe('true');
    expect(days.getAttribute('aria-invalid')).toBe('true');
    expect(days.getAttribute('aria-describedby')).toContain('sched-days-error');
    expect(screen.getByText('Enter a whole number between 1 and 90.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('clears the cut-off and sends null', async () => {
    apiMock.mockResolvedValueOnce(doc({ cutoff_time: '15:30' }, [slot()])).mockResolvedValueOnce(doc({ cutoff_time: null }, [slot()]));
    renderWorkspace();
    await userEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    expect(screen.getByText('No cut-off')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect((apiMock.mock.calls[1][1] as { body: Record<string, unknown> }).body.cutoff_time).toBeNull();
  });

  it('surfaces the server validation message and keeps the draft', async () => {
    apiMock.mockResolvedValueOnce(doc({ enabled: false }, [slot()])).mockRejectedValueOnce(new ApiError(422, 'المنطقة الزمنية غير صالحة', {}));
    renderWorkspace();
    await userEvent.click(await screen.findByRole('switch', { name: 'Enable delivery date selection' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('المنطقة الزمنية غير صالحة')).toBeTruthy();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('keeps an unusual saved zone selected and retries a failed load', async () => {
    apiMock.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(doc({ timezone: 'Pacific/Honolulu' }, [slot()]));
    renderWorkspace();
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    const select = (await screen.findByLabelText('Store time zone')) as HTMLSelectElement;
    expect(select.value).toBe('Pacific/Honolulu');
  });

  it('shows a permission state on 403 and ignores a late response from a previous store', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(403, 'no', {}));
    renderWorkspace();
    expect(await screen.findByText(/do not have permission/)).toBeTruthy();

    cleanup();
    apiMock.mockReset();
    let resolveFirst: (v: unknown) => void = () => undefined;
    apiMock.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; })).mockResolvedValueOnce(doc({ enabled: true }, [slot()]));
    const view = renderWorkspace('s1');
    view.rerender(
      <ToastProvider>
        <DeliveryWorkspace storeId="s2" locale="en" />
      </ToastProvider>,
    );
    expect((await screen.findByRole('switch', { name: 'Enable delivery date selection' })).getAttribute('aria-checked')).toBe('true');
    resolveFirst(doc({ enabled: false }, []));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByRole('switch', { name: 'Enable delivery date selection' }).getAttribute('aria-checked')).toBe('true');
  });
});
