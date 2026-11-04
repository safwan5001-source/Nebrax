// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ current: 'en' }));
vi.mock('next-intl', () => ({ useLocale: () => locale.current, useTranslations: () => (key: string) => key }));

const can = vi.hoisted(() => ({ allowed: new Set<string>(), hydrated: true }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ hydrated: can.hydrated, can: (p: string) => can.allowed.has(p) }) }));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { ToastProvider } from '@/components/ui/toast';
import { ShippingZonesScreen, saveErrorKey } from './shipping-zones-screen';

const zone = (over: Record<string, unknown> = {}) => ({ id: 'z1', name: 'Dammam zone', match_type: 'city', match_value: 'Dammam', rate_amount_minor: 1500, is_active: true, ...over });
const apiError = (status: number, body: Record<string, unknown> = {}) => Object.assign(new Error('x'), { status, body });
const mount = () => render(<ToastProvider><ShippingZonesScreen /></ToastProvider>);
const calls = (method: string) => apiMock.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === method);
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (r: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

describe('ShippingZonesScreen (COPS-H4-2)', () => {
  beforeEach(() => {
    locale.current = 'en';
    can.allowed = new Set(['commerce.manage']);
    can.hydrated = true;
    apiMock.mockReset();
    apiMock.mockResolvedValue({ data: [zone(), zone({ id: 'z2', name: 'Eastern zone', match_type: 'region', match_value: 'Eastern', rate_amount_minor: 0, is_active: false })] });
  });
  afterEach(cleanup);

  it('without commerce.manage nothing is requested and a forbidden state is shown', () => {
    can.allowed = new Set();
    mount();
    expect(screen.getByText('You do not have access to this screen')).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('lists zones: fees in SAR (never raw halalas), free shown as Free, status badges', async () => {
    mount();
    await screen.findByText('Dammam zone');
    expect(screen.getByText('Eastern zone')).toBeTruthy();
    expect(screen.getByText('Free')).toBeTruthy();
    expect(screen.getByText(/15\.00/)).toBeTruthy();
    expect(screen.queryByText('1500')).toBeNull();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Disabled')).toBeTruthy();
    expect(screen.getByText(/organisation-wide/)).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/shipping-zones');
  });

  it('shows an empty state and a retryable error state', async () => {
    apiMock.mockResolvedValueOnce({ data: [] });
    mount();
    await screen.findByText('No shipping zones yet');
    cleanup();
    apiMock.mockRejectedValueOnce(apiError(500));
    mount();
    await screen.findByText('Could not load shipping zones.');
  });

  it('creates a zone: SAR text becomes integer halalas in the POST body', async () => {
    mount();
    await screen.findByText('Dammam zone');
    fireEvent.click(screen.getByRole('button', { name: /Add zone/ }));
    fireEvent.change(screen.getByLabelText('Zone name'), { target: { value: 'Jubail' } });
    fireEvent.change(screen.getByLabelText('Value to match'), { target: { value: 'Jubail' } });
    fireEvent.change(screen.getByLabelText('Shipping fee (SAR)'), { target: { value: '12.5' } });
    apiMock.mockResolvedValueOnce({ data: zone({ id: 'z3', name: 'Jubail', rate_amount_minor: 1250 }) });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls('POST')).toHaveLength(1));
    expect(calls('POST')[0][0]).toBe('/commerce/workspace/shipping-zones');
    expect(calls('POST')[0][1]).toEqual({ method: 'POST', body: { name: 'Jubail', match_type: 'city', match_value: 'Jubail', rate_amount_minor: 1250, is_active: true } });
  });

  it('blocks an invalid form client-side: no request, per-field messages', async () => {
    mount();
    await screen.findByText('Dammam zone');
    fireEvent.click(screen.getByRole('button', { name: /Add zone/ }));
    fireEvent.change(screen.getByLabelText('Shipping fee (SAR)'), { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Zone name is required.')).toBeTruthy();
    expect(screen.getByText('Match value is required.')).toBeTruthy();
    expect(screen.getByText(/Enter a valid fee in SAR/)).toBeTruthy();
    expect(calls('POST')).toHaveLength(0);
  });

  it('edits with a full-body PUT and keeps the unchanged fields', async () => {
    mount();
    await screen.findByText('Dammam zone');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    expect((screen.getByLabelText('Shipping fee (SAR)') as HTMLInputElement).value).toBe('15.00');
    fireEvent.change(screen.getByLabelText('Shipping fee (SAR)'), { target: { value: '20' } });
    apiMock.mockResolvedValueOnce({ data: zone({ rate_amount_minor: 2000 }) });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    expect(calls('PUT')[0][0]).toBe('/commerce/workspace/shipping-zones/z1');
    expect(calls('PUT')[0][1]).toEqual({ method: 'PUT', body: { name: 'Dammam zone', match_type: 'city', match_value: 'Dammam', rate_amount_minor: 2000, is_active: true } });
  });

  it('a duplicate (422 without field errors) shows the duplicate message and keeps the dialog open', async () => {
    mount();
    await screen.findByText('Dammam zone');
    fireEvent.click(screen.getByRole('button', { name: /Add zone/ }));
    fireEvent.change(screen.getByLabelText('Zone name'), { target: { value: 'Dup' } });
    fireEvent.change(screen.getByLabelText('Value to match'), { target: { value: 'Dammam' } });
    apiMock.mockRejectedValueOnce(apiError(422, { message: 'dup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Another zone already uses the same match type and value.')).toBeTruthy();
    expect(screen.getByLabelText('Zone name')).toBeTruthy();
  });

  it('locks a double submit while the request is in flight', async () => {
    mount();
    await screen.findByText('Dammam zone');
    fireEvent.click(screen.getByRole('button', { name: /Add zone/ }));
    fireEvent.change(screen.getByLabelText('Zone name'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Value to match'), { target: { value: 'A' } });
    const pending = deferred<unknown>();
    apiMock.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.submit(screen.getByLabelText('Zone name').closest('form')!);
    fireEvent.submit(screen.getByLabelText('Zone name').closest('form')!);
    expect(calls('POST')).toHaveLength(1);
    pending.resolve({ data: zone({ id: 'z9' }) });
    await waitFor(() => expect(screen.queryByLabelText('Zone name')).toBeNull());
  });

  it('disabling asks for confirmation that explains the window impact, then PUTs is_active=false; cancel sends nothing', async () => {
    mount();
    await screen.findByText('Dammam zone');
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/hidden temporarily, not deleted/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(calls('PUT')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    apiMock.mockResolvedValueOnce({ data: zone({ is_active: false }) });
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Disable zone' }));
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    expect((calls('PUT')[0][1] as { body: { is_active: boolean } }).body.is_active).toBe(false);
  });

  it('turning an active zone off from the edit dialog goes through the same confirmation (no PUT until confirmed)', async () => {
    mount();
    await screen.findByText('Dammam zone');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alertdialog');
    expect(within(alert).getByText(/hidden temporarily, not deleted/)).toBeTruthy();
    expect(calls('PUT')).toHaveLength(0);
    // back out: the form returns, nothing sent
    fireEvent.click(within(alert).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(calls('PUT')).toHaveLength(0);
    // confirm: exactly one PUT with is_active=false
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    apiMock.mockResolvedValueOnce({ data: zone({ is_active: false }) });
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Disable zone' }));
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    expect((calls('PUT')[0][1] as { body: { is_active: boolean } }).body.is_active).toBe(false);
  });

  it('editing other fields of an active zone, or re-enabling an inactive one, asks for no confirmation', async () => {
    mount();
    await screen.findByText('Dammam zone');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    fireEvent.change(screen.getByLabelText('Shipping fee (SAR)'), { target: { value: '16' } });
    apiMock.mockResolvedValueOnce({ data: zone({ rate_amount_minor: 1600 }) });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('enabling a disabled zone needs no confirmation', async () => {
    mount();
    await screen.findByText('Eastern zone');
    apiMock.mockResolvedValueOnce({ data: zone({ id: 'z2', is_active: true }) });
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    expect(calls('PUT')[0][0]).toBe('/commerce/workspace/shipping-zones/z2');
  });

  it('the screen exposes no delete action and issues no DELETE request', async () => {
    mount();
    await screen.findByText('Dammam zone');
    expect(screen.queryByRole('button', { name: /delete|remove|حذف/i })).toBeNull();
    expect(calls('DELETE')).toHaveLength(0);
    expect(screen.getByText(/disable a zone instead of deleting it/)).toBeTruthy();
  });

  it('renders Arabic copy under the ar locale', async () => {
    locale.current = 'ar';
    mount();
    await screen.findByText('Dammam zone');
    expect(screen.getByRole('heading', { name: 'مناطق الشحن' })).toBeTruthy();
    expect(screen.getByText('مجاني')).toBeTruthy();
  });

  it('maps server rejections to the right message', () => {
    expect(saveErrorKey(apiError(403))).toBe('error.forbidden');
    expect(saveErrorKey(apiError(404))).toBe('error.not_found');
    expect(saveErrorKey(apiError(422, { message: 'x' }))).toBe('error.duplicate');
    expect(saveErrorKey(apiError(422, { message: 'x', errors: { name: ['bad'] } }))).toBe('error.validation');
    expect(saveErrorKey(apiError(500))).toBe('error.generic');
    expect(saveErrorKey(new Error('offline'))).toBe('error.generic');
  });
});
