// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const messages = vi.hoisted(() => ({
  en: {
    title: 'Availability by channel', hint: 'hint', loading: 'Loading channels…', loadFailed: 'Could not load channel availability.', empty: 'There are no web or mobile channels to configure.',
    methodInactive: 'This method is disabled', saved: 'Channel availability updated', saveFailed: 'Could not save availability.', choiceLabel: 'Channel availability', channelInactive: 'Inactive channel',
    'type.web': 'Web', 'type.mobile': 'Mobile', 'effective.on': 'Shown to shoppers', 'effective.off': 'Not shown', 'choice.default': 'Default', 'choice.enabled': 'Enabled', 'choice.disabled': 'Disabled',
  } as Record<string, string>,
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => messages.en[key] ?? key }));

const can = vi.hoisted(() => ({ allowed: new Set<string>(), hydrated: true }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ hydrated: can.hydrated, can: (p: string) => can.allowed.has(p) }) }));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { ToastProvider } from '@/components/ui/toast';
import { choiceOf, mapChannelRow, mapView, overrideOf } from './channel-availability';
import { ChannelAvailabilitySection } from './ChannelAvailabilitySection';

const row = (over: Record<string, unknown> = {}) => ({ sales_channel_id: 'c1', name: 'Web store', type: 'web', is_active: true, override: null, effective: true, ...over });
const listPayload = (channels: unknown[]) => ({ data: { payment_method: { id: 'm1', name: 'Card', is_active: true, available_online: true }, channels } });
const mount = (props: { methodActive?: boolean } = {}) => render(<ToastProvider><ChannelAvailabilitySection methodId="m1" methodActive={props.methodActive ?? true} /></ToastProvider>);
const puts = () => apiMock.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === 'PUT');

describe('ChannelAvailabilitySection (COPS-H4-6)', () => {
  beforeEach(() => {
    can.allowed = new Set(['payments.manage', 'commerce.channel_settings.manage']);
    can.hydrated = true;
    apiMock.mockReset();
    apiMock.mockResolvedValue(listPayload([row(), row({ sales_channel_id: 'c2', name: 'Mobile app', type: 'mobile', override: false, effective: false })]));
  });
  afterEach(cleanup);

  it.each([[['payments.manage']], [['commerce.channel_settings.manage']], [[]]])('renders nothing and requests nothing without BOTH permissions (%j)', (granted) => {
    can.allowed = new Set(granted as string[]);
    const { container } = mount();
    expect(container.textContent).toBe('');
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('lists the channels with the server-computed effective state and the current choice', async () => {
    mount();
    await screen.findByText('Web store');
    expect(apiMock).toHaveBeenCalledWith('/payment-methods/m1/channel-availability');
    const web = screen.getByTestId('channel-row-c1');
    const mobile = screen.getByTestId('channel-row-c2');
    expect(within(web).getByText('Shown to shoppers')).toBeTruthy();
    expect((within(web).getByRole('combobox') as HTMLSelectElement).value).toBe('default');
    expect(within(mobile).getByText('Not shown')).toBeTruthy();
    expect((within(mobile).getByRole('combobox') as HTMLSelectElement).value).toBe('disabled');
  });

  it('a choice sends exactly one PUT with is_enabled and updates the row from the server answer', async () => {
    mount();
    await screen.findByText('Web store');
    apiMock.mockResolvedValueOnce({ data: row({ override: false, effective: false }) });
    fireEvent.change(within(screen.getByTestId('channel-row-c1')).getByRole('combobox'), { target: { value: 'disabled' } });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0][0]).toBe('/payment-methods/m1/channel-availability/c1');
    expect(puts()[0][1]).toEqual({ method: 'PUT', body: { is_enabled: false } });
    await waitFor(() => expect(within(screen.getByTestId('channel-row-c1')).getByText('Not shown')).toBeTruthy());
  });

  it('choosing "Default" resets the override (is_enabled null)', async () => {
    mount();
    await screen.findByText('Mobile app');
    apiMock.mockResolvedValueOnce({ data: row({ sales_channel_id: 'c2', name: 'Mobile app', type: 'mobile', override: null, effective: true }) });
    fireEvent.change(within(screen.getByTestId('channel-row-c2')).getByRole('combobox'), { target: { value: 'default' } });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0][1]).toEqual({ method: 'PUT', body: { is_enabled: null } });
  });

  it('re-selecting the current choice sends nothing', async () => {
    mount();
    await screen.findByText('Web store');
    fireEvent.change(within(screen.getByTestId('channel-row-c1')).getByRole('combobox'), { target: { value: 'default' } });
    expect(puts()).toHaveLength(0);
  });

  it('a failed save reloads the truth from the server and shows an error', async () => {
    mount();
    await screen.findByText('Web store');
    apiMock.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 403 }));
    fireEvent.change(within(screen.getByTestId('channel-row-c1')).getByRole('combobox'), { target: { value: 'enabled' } });
    await screen.findByText('Could not save availability.');
    await waitFor(() => expect(apiMock.mock.calls.filter((c) => c[0] === '/payment-methods/m1/channel-availability').length).toBeGreaterThanOrEqual(2));
  });

  it('shows empty, loading-failure and inactive-method states', async () => {
    apiMock.mockResolvedValueOnce(listPayload([]));
    mount({ methodActive: false });
    await screen.findByText('There are no web or mobile channels to configure.');
    expect(screen.getByText('This method is disabled')).toBeTruthy();
    cleanup();
    apiMock.mockRejectedValueOnce(new Error('offline'));
    mount();
    await screen.findByText('Could not load channel availability.');
  });

  it('maps the contract tolerantly: malformed rows are dropped and unknown override values are rejected', () => {
    expect(mapChannelRow(row())).toEqual({ channelId: 'c1', name: 'Web store', type: 'web', isActive: true, override: null, effective: true });
    expect(mapChannelRow(row({ override: 'yes' }))).toBeNull();
    expect(mapChannelRow(row({ effective: 1 }))).toBeNull();
    expect(mapChannelRow(null)).toBeNull();
    expect(mapView(listPayload([row(), { bad: true }]))?.channels).toHaveLength(1);
    expect(mapView({})).toBeNull();
    expect(choiceOf(null)).toBe('default');
    expect(choiceOf(true)).toBe('enabled');
    expect(overrideOf('disabled')).toBe(false);
    expect(overrideOf('default')).toBeNull();
  });
});
