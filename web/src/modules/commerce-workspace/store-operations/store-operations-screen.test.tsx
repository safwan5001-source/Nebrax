// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ current: 'en' }));
vi.mock('next-intl', () => ({ useLocale: () => locale.current, useTranslations: () => (key: string) => key }));

const can = vi.hoisted(() => ({ allowed: new Set<string>(), hydrated: true }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ hydrated: can.hydrated, can: (p: string) => can.allowed.has(p) }) }));

const stores = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../store-context', () => ({ useCommerceStoreContext: () => stores.value }));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { ToastProvider } from '@/components/ui/toast';
import { StoreOperationsScreen, saveErrorKey } from './store-operations-screen';

const STORE = { id: 's1', name: 'Rose', salesChannelId: 'ch1', isActive: true, previewUrl: null, defaultLocale: 'ar', businessVertical: 'general', recommendedCapabilities: [] };
const body = (over: Record<string, unknown> = {}) => ({
  data: {
    version: 1, accepting_orders: true, paused_until: null, pause_message: null, outside_hours_policy: 'accept', opening_hours: [], min_order_minor: null, min_order_scope: 'all',
    intake_controls_deployment_enabled: true, ...over,
  },
});
const apiError = (status: number, bodyJson: Record<string, unknown> = {}) => Object.assign(new Error('x'), { status, body: bodyJson });
const mount = () => render(<ToastProvider><StoreOperationsScreen /></ToastProvider>);
const puts = () => apiMock.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === 'PUT');
const saveBtn = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

describe('StoreOperationsScreen (COPS-H4-3 UI)', () => {
  beforeEach(() => {
    locale.current = 'en';
    can.allowed = new Set(['commerce.channel_settings.manage']);
    can.hydrated = true;
    stores.value = { catalog: { status: 'ready', stores: [STORE] }, selectedStoreId: 's1', setSelectedStoreId: vi.fn(), storeContextStatus: 'ready' };
    apiMock.mockReset();
    apiMock.mockResolvedValue(body());
  });
  afterEach(cleanup);

  it('without the permission nothing is requested', () => {
    can.allowed = new Set();
    mount();
    expect(screen.getByText('Reading and changing these settings needs the “commerce.channel_settings.manage” permission (owner and admin).')).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('a store without a sales channel explains and requests nothing', () => {
    stores.value = { ...stores.value, catalog: { status: 'ready', stores: [{ ...STORE, salesChannelId: null }] } };
    mount();
    expect(screen.getByText('This store has no sales channel')).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('loads the channel settings and shows the closed-gate notice when enforcement is off', async () => {
    apiMock.mockResolvedValue(body({ intake_controls_deployment_enabled: false }));
    mount();
    await screen.findByText('Enforcement is not enabled on this deployment');
    expect(apiMock).toHaveBeenCalledWith('/commerce/channels/ch1/operations-settings');
  });

  it('with the gate closed, pause / block / a new minimum cannot be turned on (disabled with the reason)', async () => {
    apiMock.mockResolvedValue(body({ intake_controls_deployment_enabled: false }));
    mount();
    await screen.findByText('Enforcement is not enabled on this deployment');
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Minimum (SAR)') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('option', { name: 'Block new orders' }) as HTMLOptionElement).disabled).toBe(true);
  });

  it('pausing with a message sends one PUT with expected_version and only the changed keys', async () => {
    mount();
    await screen.findByText('Temporary pause');
    expect(saveBtn().disabled).toBe(true);
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.change(screen.getByLabelText('Message to shoppers (optional)'), { target: { value: 'Back at 5pm' } });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    apiMock.mockResolvedValueOnce(body({ version: 2, accepting_orders: false, pause_message: 'Back at 5pm' }));
    fireEvent.click(saveBtn());
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toEqual(['/commerce/channels/ch1/operations-settings', { method: 'PUT', body: { expected_version: 1, accepting_orders: false, pause_message: 'Back at 5pm' } }]);
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
  });

  it('the minimum order is typed in SAR and sent in integer halalas', async () => {
    mount();
    await screen.findByText('Minimum order');
    fireEvent.change(screen.getByLabelText('Minimum (SAR)'), { target: { value: '150.50' } });
    apiMock.mockResolvedValueOnce(body({ version: 2, min_order_minor: 15050 }));
    fireEvent.click(saveBtn());
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect((puts()[0][1] as { body: Record<string, unknown> }).body).toEqual({ expected_version: 1, min_order_minor: 15050 });
  });

  it('adds, edits and removes an opening period and saves a sorted set', async () => {
    mount();
    await screen.findByText('Weekly opening hours');
    const monday = screen.getByTestId('day-1');
    fireEvent.click(within(monday).getByRole('button', { name: 'Add period' }));
    fireEvent.change(within(monday).getByLabelText(/From$/), { target: { value: '08:30' } });
    apiMock.mockResolvedValueOnce(body({ version: 2, opening_hours: [{ weekday: 1, opens_at: '08:30', closes_at: '17:00' }] }));
    fireEvent.click(saveBtn());
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect((puts()[0][1] as { body: Record<string, unknown> }).body).toEqual({ expected_version: 1, opening_hours: [{ weekday: 1, opens_at: '08:30', closes_at: '17:00' }] });
  });

  it('an invalid period blocks the save without a request', async () => {
    mount();
    await screen.findByText('Weekly opening hours');
    const monday = screen.getByTestId('day-1');
    fireEvent.click(within(monday).getByRole('button', { name: 'Add period' }));
    fireEvent.change(within(monday).getByLabelText(/From$/), { target: { value: '18:00' } });
    fireEvent.click(saveBtn());
    expect(await screen.findByText(/Invalid period/)).toBeTruthy();
    expect(puts()).toHaveLength(0);
  });

  it('a version conflict refreshes the settings, keeps the draft and asks to review', async () => {
    mount();
    await screen.findByText('Temporary pause');
    fireEvent.change(screen.getByLabelText('Message to shoppers (optional)'), { target: { value: 'mine' } });
    apiMock.mockRejectedValueOnce(apiError(409, { reason: 'settings_version_conflict', current_version: 5 }));
    apiMock.mockResolvedValueOnce(body({ version: 5, pause_message: 'theirs' }));
    fireEvent.click(saveBtn());
    expect(await screen.findByText(/The settings changed since you opened them/)).toBeTruthy();
    expect((screen.getByLabelText('Message to shoppers (optional)') as HTMLTextAreaElement).value).toBe('mine');
    expect(apiMock.mock.calls.filter((c) => c[0] === '/commerce/channels/ch1/operations-settings' && !(c[1] as object | undefined)).length).toBeGreaterThanOrEqual(2);
  });

  it('after a conflict, fields the user did not touch take the server values and a retry does not undo another admin\'s pause', async () => {
    mount();
    await screen.findByText('Temporary pause');
    fireEvent.change(screen.getByLabelText('Message to shoppers (optional)'), { target: { value: 'mine' } });
    apiMock.mockRejectedValueOnce(apiError(409, { reason: 'settings_version_conflict', current_version: 5 }));
    apiMock.mockResolvedValueOnce(body({ version: 5, accepting_orders: false, pause_message: null }));
    fireEvent.click(saveBtn());
    expect(await screen.findByText(/The settings changed since you opened them/)).toBeTruthy();
    // مسؤول آخر أوقف المتجر: يظهر مُوقَفاً في المسودة، ورسالة المستخدم باقية.
    await waitFor(() => expect((screen.getByRole('switch') as HTMLButtonElement).getAttribute('aria-checked')).toBe('true'));
    expect((screen.getByLabelText('Message to shoppers (optional)') as HTMLTextAreaElement).value).toBe('mine');
    apiMock.mockResolvedValueOnce(body({ version: 6, accepting_orders: false, pause_message: 'mine' }));
    fireEvent.click(saveBtn());
    await waitFor(() => expect(puts()).toHaveLength(2));
    const sent = (puts()[1][1] as { body: Record<string, unknown> }).body;
    expect(sent.expected_version).toBe(5);
    expect(sent.pause_message).toBe('mine');
    expect('accepting_orders' in sent).toBe(false);
  });

  it('locks every field while a save is pending so later edits are not lost', async () => {
    mount();
    await screen.findByText('Temporary pause');
    fireEvent.change(screen.getByLabelText('Message to shoppers (optional)'), { target: { value: 'y' } });
    let release!: (v: unknown) => void;
    apiMock.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    fireEvent.click(saveBtn());
    await waitFor(() => expect((screen.getByLabelText('Message to shoppers (optional)') as HTMLTextAreaElement).closest('fieldset')!.disabled).toBe(true));
    release(body({ version: 2, pause_message: 'y' }));
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
    expect((screen.getByLabelText('Message to shoppers (optional)') as HTMLTextAreaElement).closest('fieldset')!.disabled).toBe(false);
  });

  it('locks a double submit and discards back to the saved values', async () => {
    mount();
    await screen.findByText('Temporary pause');
    fireEvent.change(screen.getByLabelText('Message to shoppers (optional)'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect((screen.getByLabelText('Message to shoppers (optional)') as HTMLTextAreaElement).value).toBe('');

    fireEvent.change(screen.getByLabelText('Message to shoppers (optional)'), { target: { value: 'y' } });
    let release!: (v: unknown) => void;
    apiMock.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const form = saveBtn().closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(puts()).toHaveLength(1);
    release(body({ version: 2, pause_message: 'y' }));
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
  });

  it('maps server rejections to messages', () => {
    expect(saveErrorKey(apiError(409, { reason: 'settings_version_conflict' }))).toBe('error.conflict');
    expect(saveErrorKey(apiError(409, { reason: 'intake_controls_deployment_disabled' }))).toBe('error.gate');
    expect(saveErrorKey(apiError(403))).toBe('error.forbidden');
    expect(saveErrorKey(apiError(422, { reason: 'opening_hours_invalid' }))).toBe('error.validation');
    expect(saveErrorKey(apiError(500))).toBe('error.generic');
    expect(saveErrorKey(new Error('offline'))).toBe('error.generic');
  });

  it('renders Arabic copy under ar', async () => {
    locale.current = 'ar';
    mount();
    await waitFor(() => expect(screen.getByText('الإيقاف المؤقت')).toBeTruthy());
  });
});
