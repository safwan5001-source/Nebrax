// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import arMessages from '@/messages/ar.json';
import enMessages from '@/messages/en.json';
import { getToken } from '@/lib/api';
import LoginPage from './page';

// AUTH-REMEMBER-1: /login مع توكن محفوظ يتحقق عبر /me قبل أي تحويل، ولا يمسح الاعتماد عند فشل مؤقت.

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('@/components/auth/auth-shell', () => ({
  AuthShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

const fetchSpy = vi.fn();
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const user = (role: string) => ({ id: 'u1', name: 'م', email: 'a@b.sa', role, permissions: ['*'], tenant_id: 't1' });

function renderLogin(locale: 'ar' | 'en' = 'ar') {
  const messages = locale === 'ar' ? arMessages : enMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={{ login: messages.login } as never}>
      <LoginPage />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  replace.mockReset();
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('session restoration on /login', () => {
  it('verifies the token via /me and sends admins to /dashboard', async () => {
    localStorage.setItem('token', 'tok');
    fetchSpy.mockResolvedValue(json(200, { user: user('owner') }));
    renderLogin();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/me$/);
    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('sends self-service users to /me, by the role /me returns (not the cached one)', async () => {
    localStorage.setItem('token', 'tok');
    localStorage.setItem('user', JSON.stringify(user('owner')));
    fetchSpy.mockResolvedValue(json(200, { user: user('self_service') }));
    renderLogin();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/me'));
  });

  it('401 clears the token and shows the form without redirecting', async () => {
    localStorage.setItem('token', 'dead');
    fetchSpy.mockResolvedValue(json(401, { message: 'Unauthenticated.' }));
    const { container } = renderLogin();
    await waitFor(() => expect(container.querySelector('#login-email')).not.toBeNull());
    expect(getToken()).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([
    ['network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['server 503', () => Promise.resolve(json(503, {}))],
    ['tenant-context 403', () => Promise.resolve(json(403, {}))],
  ])('%s keeps the valid token and shows the form', async (_n, impl) => {
    localStorage.setItem('token', 'good');
    fetchSpy.mockImplementation(impl);
    const { container } = renderLogin();
    await waitFor(() => expect(container.querySelector('#login-email')).not.toBeNull());
    expect(getToken()).toBe('good');
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not call /me at all without a saved token, and in demo mode', async () => {
    renderLogin();
    expect(fetchSpy).not.toHaveBeenCalled();
    cleanup();
    localStorage.setItem('token', 'tok');
    localStorage.setItem('demo', 'true');
    renderLogin();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('a late 401 for an old token does not wipe a token from a newer login', async () => {
    localStorage.setItem('token', 'old');
    let finishMe: (r: unknown) => void = () => {};
    fetchSpy.mockImplementationOnce(() => new Promise((resolve) => { finishMe = resolve; }));
    const { container } = renderLogin();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    localStorage.setItem('token', 'new'); // دخول جديد تمّ أثناء الطلب المعلّق
    finishMe(json(401, {}));
    await waitFor(() => expect(container.querySelector('#login-email')).not.toBeNull());
    expect(getToken()).toBe('new');
  });
});

describe('Remember me', () => {
  it.each([
    ['ar', arMessages.login.remember, 'تذكرني لمدة 30 يومًا'],
    ['en', enMessages.login.remember, 'Remember me for 30 days'],
  ] as const)('is localized (%s)', (locale, text, expected) => {
    expect(text).toBe(expected);
    renderLogin(locale);
    expect(screen.getByLabelText(expected)).toBeTruthy();
  });

  async function submit(check: boolean) {
    fetchSpy.mockResolvedValue(json(200, { token: 'T', user: user('owner') }));
    const { container } = renderLogin();
    await userEvent.type(container.querySelector('#login-email') as HTMLElement, 'a@b.sa');
    await userEvent.type(container.querySelector('#login-password') as HTMLElement, 'pw');
    if (check) await userEvent.click(screen.getByLabelText(arMessages.login.remember));
    await userEvent.click(screen.getByRole('button', { name: arMessages.login.submit }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    return JSON.parse(fetchSpy.mock.calls[0][1].body);
  }

  it('sends remember:true only when checked, and never stores the password', async () => {
    expect(await submit(true)).toEqual({ email: 'a@b.sa', password: 'pw', remember: true });
    expect(JSON.stringify({ ...localStorage })).not.toContain('pw"');
  });

  it('omits remember when unchecked (7-day default preserved)', async () => {
    expect(await submit(false)).toEqual({ email: 'a@b.sa', password: 'pw' });
  });
});
