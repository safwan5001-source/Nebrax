// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: nav.replace, push: vi.fn() }), usePathname: () => '/fuel-stations/ops/login' }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn() }));

import { ApiError, api } from '@/lib/api';
import { StationLoginScreen } from './login-screen';

const apiMock = vi.mocked(api);
const user = { id: 'u1', name: 'Seller One', email: 's@x.test', role: 'staff', permissions: ['fuel_stations.view'], tenant_id: 'T1', station_session: true };

const realLocation = window.location;
beforeEach(() => {
  // الشاشة تعمل داخل مسارات التطبيق: يحدّد ذلك مجموعة الاعتماد الفعّالة (محطات لا أَوْج).
  Object.defineProperty(window, 'location', { configurable: true, value: { pathname: '/fuel-stations/ops/login', href: 'http://localhost/fuel-stations/ops/login', assign: vi.fn() } });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  localStorage.clear(); sessionStorage.clear(); apiMock.mockReset(); nav.replace.mockReset();
});
afterEach(() => { cleanup(); Object.defineProperty(window, 'location', { configurable: true, value: realLocation }); });

const type = async (employee: string, pin: string) => {
  const u = userEvent.setup();
  if (employee) await u.type(screen.getByLabelText(/employee number|رقم الموظف/i), employee);
  if (pin) await u.type(screen.getByLabelText(/^PIN$|رمز PIN/), pin);
  return u;
};
const submit = () => screen.getByRole('button', { name: /^Sign in$|^دخول$/ });

describe('station login screen', () => {
  it('opens the operations app straight after a successful sign-in, sending only normalized values', async () => {
    apiMock.mockResolvedValueOnce({ token: 'tok', user });
    renderIntl(<StationLoginScreen />, 'en');
    const u = await type('  EMP-00042 ', '482915');
    await u.click(submit());

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/fuel-stations/ops'));
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/station/login', { method: 'POST', body: { employee_no: 'EMP-00042', pin: '482915' } });
    expect(localStorage.getItem('station_token')).toBe('tok');
    expect(JSON.parse(localStorage.getItem('station_user') as string).station_session).toBe(true);
    expect(localStorage.getItem('token')).toBeNull(); // جلسة أَوْج لا تُكتب
  });

  it('accepts Arabic-Indic digits and sends Latin 0-9', async () => {
    apiMock.mockResolvedValueOnce({ token: 'tok', user });
    renderIntl(<StationLoginScreen />, 'ar');
    const u = await type('١٠٠٤٢', '٤٨٢٩١٥');
    await u.click(submit());
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(apiMock.mock.calls[0][1]).toMatchObject({ body: { employee_no: '10042', pin: '482915' } });
  });

  it('validates before sending: empty fields and a short PIN never reach the network', async () => {
    renderIntl(<StationLoginScreen />, 'en');
    const u = userEvent.setup();
    await u.click(submit());
    expect(screen.getByText('Enter your employee number.')).toBeTruthy();
    expect(screen.getByText('Enter your PIN.')).toBeTruthy();

    await u.type(screen.getByLabelText(/employee number/i), 'EMP-1');
    await u.type(screen.getByLabelText(/^PIN$/), '123');
    await u.click(submit());
    expect(screen.getByText('The PIN is 6 digits.')).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('keeps only digits in the PIN field and never more than six', async () => {
    renderIntl(<StationLoginScreen />, 'en');
    const pin = screen.getByLabelText(/^PIN$/) as HTMLInputElement;
    fireEvent.change(pin, { target: { value: 'ab4-8 2915999' } });
    expect(pin.value).toBe('482915');
    expect(pin.getAttribute('inputmode')).toBe('numeric');
    expect(pin.getAttribute('dir')).toBe('ltr');
  });

  it('shows one generic message for a refusal, clears the PIN, keeps the employee number, and does not store anything', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(422, 'x', { reason: 'invalid_credentials' }));
    renderIntl(<StationLoginScreen />, 'en');
    const u = await type('EMP-1', '111111');
    await u.click(submit());

    expect((await screen.findByRole('alert')).textContent).toContain('Employee number or PIN is incorrect.');
    expect((screen.getByLabelText(/^PIN$/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/employee number/i) as HTMLInputElement).value).toBe('EMP-1');
    expect(nav.replace).not.toHaveBeenCalled();
    expect(localStorage.getItem('station_token')).toBeNull();
    expect(JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })).not.toMatch(/111111|EMP-1/);
  });

  it('explains throttling as a short wait, not a locked account', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(429, 'Too Many Attempts.', {}));
    renderIntl(<StationLoginScreen />, 'en');
    const u = await type('EMP-1', '111111');
    await u.click(submit());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Wait a few minutes and try again/);
    expect(alert.textContent).toMatch(/not locked/);
    expect(alert.getAttribute('data-login-failure')).toBe('throttled');
  });

  it('tells the user to open the company link when no company can be resolved from the host', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(422, 'x', { reason: 'tenant_required' }));
    renderIntl(<StationLoginScreen />, 'ar');
    const u = await type('EMP-1', '482915');
    await u.click(submit());
    expect((await screen.findByRole('alert')).textContent).toContain('افتح التطبيق من رابط مؤسستك');
  });

  it('sends nothing while offline and says so', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    renderIntl(<StationLoginScreen />, 'en');
    const u = await type('EMP-1', '482915');
    await u.click(submit());
    expect((await screen.findByRole('alert')).getAttribute('data-login-failure')).toBe('offline');
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('locks a double submit while the request is in flight', async () => {
    let finish: (value: unknown) => void = () => {};
    apiMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    renderIntl(<StationLoginScreen />, 'en');
    const u = await type('EMP-1', '482915');
    await u.click(submit());
    await u.click(screen.getByRole('button', { name: /Signing in/ }));
    fireEvent.submit(screen.getByRole('button', { name: /Signing in/ }).closest('form') as HTMLFormElement);
    expect(apiMock).toHaveBeenCalledTimes(1);
    finish({ token: 't', user });
    await waitFor(() => expect(nav.replace).toHaveBeenCalledTimes(1));
  });

  it('resumes a valid stored station session without showing the form', async () => {
    localStorage.setItem('station_token', 'tok');
    apiMock.mockResolvedValueOnce({ user, company: null });
    renderIntl(<StationLoginScreen />, 'en');
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/fuel-stations/ops'));
    expect(apiMock).toHaveBeenCalledWith('/me');
    expect(screen.queryByLabelText(/employee number/i)).toBeNull();
  });

  it('shows the form when the stored station session is no longer valid', async () => {
    localStorage.setItem('station_token', 'tok');
    apiMock.mockRejectedValueOnce(new ApiError(401, 'x', {}));
    renderIntl(<StationLoginScreen />, 'en');
    expect(await screen.findByLabelText(/employee number/i)).toBeTruthy();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('never restores from an AWJ (email) session; it offers an explicit, separate “continue” choice instead', async () => {
    localStorage.setItem('token', 'erp-token');
    localStorage.setItem('user', JSON.stringify({ id: 'o', name: 'ERP Owner', email: 'o@x.test', role: 'owner', tenant_id: 'T1' }));
    renderIntl(<StationLoginScreen />, 'en');
    expect(await screen.findByLabelText(/employee number/i)).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled(); // لا /me بتوكن أَوْج
    expect(nav.replace).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('button', { name: /Continue with the current AWJ account \(ERP Owner\)/ }));
    expect(localStorage.getItem('station_use_erp')).toBe('o'); // مربوطة بمعرّف مستخدم أَوْج الذي وافق
    expect(nav.replace).toHaveBeenCalledWith('/fuel-stations/ops');
    expect(localStorage.getItem('token')).toBe('erp-token'); // لم تُنسخ ولم تُغيَّر
    expect(localStorage.getItem('station_token')).toBeNull();
  });

  it('toggles PIN visibility with an accessible control', async () => {
    renderIntl(<StationLoginScreen />, 'en');
    const pin = screen.getByLabelText(/^PIN$/) as HTMLInputElement;
    expect(pin.type).toBe('password');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show PIN' }));
    expect(pin.type).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide PIN' }).getAttribute('aria-pressed')).toBe('true');
  });

  it.each(['ar', 'en'] as const)('has no axe violations (%s)', async (locale) => {
    const { container } = renderIntl(<StationLoginScreen />, locale);
    expect((await axe(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })).violations).toEqual([]);
  });

  it('uses logical properties only (RTL-safe) and large touch targets', () => {
    const { container } = renderIntl(<StationLoginScreen />, 'ar');
    const html = container.innerHTML;
    expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\d/);
    expect(screen.getByRole('button', { name: /^دخول$/ }).className).toMatch(/min-h-14/);
  });
});
