// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn() }));

import { ApiError, api } from '@/lib/api';
import { UID, staff } from '../admin/__fixtures__';
import type { StaffView } from '../admin/schemas';
import { StationPinSection } from './pin-section';

const apiMock = vi.mocked(api);
const ID = UID(1);
const base = (over: Partial<StaffView> = {}): StaffView => staff(ID, 'Emp One', {
  user: { id: ID, name: 'Emp One', email: 'e@x.test', is_active: true, employee_no: 'EMP-00042' },
  station_pin: { has_pin: false, set_at: null },
  ...over,
});
const view = (hasPin: boolean, extra: Record<string, unknown> = {}) => ({ data: { ...base(), station_pin: { has_pin: hasPin, set_at: hasPin ? '2026-11-07T10:00:00+00:00' : null }, ...extra } });

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  localStorage.clear(); sessionStorage.clear(); apiMock.mockReset();
});
afterEach(() => cleanup());

const open = async (name: RegExp) => { const u = userEvent.setup(); await u.click(screen.getByRole('button', { name })); return u; };

describe('station PIN section (manager)', () => {
  it('shows the employee number and the PIN status', () => {
    renderIntl(<StationPinSection staff={base()} isSelf={false} />, 'en');
    expect(screen.getByText('EMP-00042')).toBeTruthy();
    expect(screen.getByText('Not set')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Remove PIN' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('generates a PIN, shows it exactly once, and wipes it from the DOM when closed', async () => {
    apiMock.mockResolvedValueOnce(view(true, { generated_pin: '482915' }));
    renderIntl(<StationPinSection staff={base()} isSelf={false} />, 'en');
    const u = await open(/^Set PIN$/);
    await u.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(apiMock).toHaveBeenCalledWith(`/fuel-stations/staff/${ID}/pin`, expect.objectContaining({ method: 'POST', body: {} }));
    expect((await screen.findByTestId('generated-pin')).textContent).toBe('482915');
    expect(screen.getByText('Set')).toBeTruthy(); // الحالة تحدّثت خلف الحوار

    await u.click(screen.getByRole('button', { name: 'Done, hide the PIN' }));
    await waitFor(() => expect(screen.queryByTestId('generated-pin')).toBeNull());
    expect(document.body.textContent).not.toContain('482915');
    // لا تخزين للرمز في أي مكان.
    expect(JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })).not.toContain('482915');
  });

  it('sends a manually chosen PIN (digits only, 6 required) with an optional reason', async () => {
    apiMock.mockResolvedValueOnce(view(true));
    renderIntl(<StationPinSection staff={base()} isSelf={false} />, 'en');
    const u = await open(/^Set PIN$/);
    await u.click(screen.getByLabelText('Enter a PIN manually'));
    const confirm = screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await u.type(screen.getByLabelText('PIN (6 digits)'), '48-29x');
    expect(confirm.disabled).toBe(true); // 5 أرقام
    await u.type(screen.getByLabelText('PIN (6 digits)'), '15');
    await u.type(screen.getByLabelText('Reason (optional)'), ' new device ');
    await u.click(confirm);

    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(apiMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: { pin: '482915', reason: 'new device' } });
    expect(await screen.findByText('The PIN you entered was saved. It will not be shown again.')).toBeTruthy();
    expect(screen.queryByTestId('generated-pin')).toBeNull();
  });

  it('shows the server refusal (e.g. a weak PIN) and keeps the dialog open for another try', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(422, 'رمز PIN ضعيف', {}));
    renderIntl(<StationPinSection staff={base()} isSelf={false} />, 'en');
    const u = await open(/^Set PIN$/);
    await u.click(screen.getByLabelText('Enter a PIN manually'));
    await u.type(screen.getByLabelText('PIN (6 digits)'), '123456');
    await u.click(screen.getByRole('button', { name: 'Confirm' }));
    expect((await screen.findByRole('alert')).textContent).toContain('This PIN was rejected');
    expect(screen.getByLabelText('PIN (6 digits)')).toBeTruthy();
  });

  it('an uncertain outcome (5xx) is never retried automatically and asks to verify first', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(503, 'x', {}));
    renderIntl(<StationPinSection staff={base()} isSelf={false} />, 'en');
    const u = await open(/^Set PIN$/);
    await u.click(screen.getByRole('button', { name: 'Confirm' }));
    expect((await screen.findByRole('alert')).textContent).toContain("couldn't confirm the result");
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('locks a double submit', async () => {
    let finish: (value: unknown) => void = () => {};
    apiMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    renderIntl(<StationPinSection staff={base()} isSelf={false} />, 'en');
    const u = await open(/^Set PIN$/);
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    await u.click(confirm);
    await u.click(screen.getByRole('button', { name: 'Saving…' }));
    expect(apiMock).toHaveBeenCalledTimes(1);
    finish(view(true, { generated_pin: '739204' }));
    expect((await screen.findByTestId('generated-pin')).textContent).toBe('739204');
  });

  it('removes the PIN after an explicit confirmation (DELETE)', async () => {
    apiMock.mockResolvedValueOnce(view(false));
    renderIntl(<StationPinSection staff={base({ station_pin: { has_pin: true, set_at: '2026-11-07T10:00:00+00:00' } })} isSelf={false} />, 'en');
    expect(screen.getByRole('button', { name: 'Change PIN' })).toBeTruthy();
    const u = await open(/^Remove PIN$/);
    const dialog = screen.getByRole('dialog');
    expect(apiMock).not.toHaveBeenCalled(); // لا حذف قبل التأكيد
    await u.click(within(dialog).getByRole('button', { name: 'Remove PIN' }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(`/fuel-stations/staff/${ID}/pin`, expect.objectContaining({ method: 'DELETE' })));
    await waitFor(() => expect(screen.getByText('Not set')).toBeTruthy());
  });

  it('is read-only for yourself, an inactive employee, or one without an employee record', () => {
    const { rerender } = renderIntl(<StationPinSection staff={base()} isSelf />, 'en');
    expect((screen.getByRole('button', { name: 'Set PIN' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<StationPinSection staff={base({ user: { id: ID, name: 'x', email: null, is_active: true, employee_no: null } })} isSelf={false} />);
    expect((screen.getByRole('button', { name: 'Set PIN' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Not linked to an employee record')).toBeTruthy();
    rerender(<StationPinSection staff={base({ user: { id: ID, name: 'x', email: null, is_active: false, employee_no: 'EMP-1' } })} isSelf={false} />);
    expect((screen.getByRole('button', { name: 'Set PIN' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('is not rendered at all inside a PIN session (the server refuses it anyway) or for an older server', () => {
    const realLocation = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { pathname: '/fuel-stations/ops/manage/staff', href: 'http://localhost/fuel-stations/ops/manage/staff', assign: vi.fn() } });
    localStorage.setItem('station_token', 'tok');
    localStorage.setItem('station_user', JSON.stringify({ id: 'u', name: 'n', email: 'e', role: 'staff', tenant_id: 't', station_session: true }));
    const { container, rerender } = renderIntl(<StationPinSection staff={base()} isSelf={false} />, 'en');
    expect(container.firstChild).toBeNull();
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
    localStorage.clear();
    rerender(<StationPinSection staff={base({ station_pin: undefined })} isSelf={false} />);
    expect(container.firstChild).toBeNull();
  });

  it.each(['ar', 'en'] as const)('has no axe violations with the dialog open (%s)', async (locale) => {
    renderIntl(<StationPinSection staff={base()} isSelf={false} />, locale);
    await userEvent.setup().click(screen.getAllByRole('button')[0]);
    expect((await axe(document.body, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })).violations).toEqual([]);
  });
});
