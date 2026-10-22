// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import arMessages from '@/messages/ar.json';
import { isDemo } from '@/lib/demo';
import LoginPage from './page';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
// القشرة (شعار/لغة/ثيم) لا علاقة لها بالبوابة؛ تُمرَّر أبناءَها كما هي.
vi.mock('@/components/auth/auth-shell', () => ({
  AuthShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

const fetchSpy = vi.fn();

function renderLogin() {
  return render(
    <NextIntlClientProvider locale="ar" messages={{ login: arMessages.login } as never}>
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
  localStorage.clear(); // jsdom مشترك بين الملفات: لا يُترك مستخدم/توكن لاختبارات أخرى
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('شاشة الدخول — زر «دخول تجريبي»', () => {
  it('غائب تماماً عند غياب NEXT_PUBLIC_DEMO_PREVIEW، ونموذج الدخول الحقيقي سليم', () => {
    delete process.env.NEXT_PUBLIC_DEMO_PREVIEW;
    renderLogin();

    expect(screen.queryByText(arMessages.login.demo)).toBeNull();
    expect(screen.queryByText(arMessages.login.demo_hint)).toBeNull();
    expect(screen.getByRole('button', { name: arMessages.login.submit })).toBeTruthy();
    expect(screen.getByLabelText(new RegExp(arMessages.login.email))).toBeTruthy();
  });

  it('غائب عند NEXT_PUBLIC_DEMO_PREVIEW=false', () => {
    vi.stubEnv('NEXT_PUBLIC_DEMO_PREVIEW', 'false');
    renderLogin();
    expect(screen.queryByText(arMessages.login.demo)).toBeNull();
  });

  it('ظاهر عند التفعيل إلى جانب النموذج الحقيقي، ويدخل /dashboard دون طلب شبكة', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEMO_PREVIEW', 'true');
    renderLogin();

    expect(screen.getByRole('button', { name: arMessages.login.submit })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: arMessages.login.demo }));

    expect(isDemo()).toBe(true);
    expect(replace).toHaveBeenCalledWith('/dashboard');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('الزر لا يرسل النموذج: لا تحقق ولا خطأ دخول حقيقي', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEMO_PREVIEW', 'true');
    renderLogin();

    await userEvent.click(screen.getByRole('button', { name: arMessages.login.demo }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
  });
});
