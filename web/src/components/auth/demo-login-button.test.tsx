// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import arMessages from '@/messages/ar.json';
import enMessages from '@/messages/en.json';
import { DEMO_USER, isDemo, isDemoPreviewEnabled } from '@/lib/demo';
import { isAuthenticated, logout } from '@/lib/auth';
import { DemoLoginButton } from './demo-login-button';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

const fetchSpy = vi.fn();

function renderButton(locale: 'ar' | 'en' = 'ar') {
  const messages = (locale === 'ar' ? arMessages : enMessages).login;
  return render(
    <NextIntlClientProvider locale={locale} messages={{ login: messages } as never}>
      <DemoLoginButton />
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
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('isDemoPreviewEnabled — بوابة البناء', () => {
  it('معطّلة عند غياب المتغيّر', () => {
    vi.stubEnv('NEXT_PUBLIC_DEMO_PREVIEW', '');
    expect(isDemoPreviewEnabled()).toBe(false);
    delete process.env.NEXT_PUBLIC_DEMO_PREVIEW;
    expect(isDemoPreviewEnabled()).toBe(false);
  });

  it.each(['false', '1', 'TRUE', 'True', 'yes', ' true'])('لا تُفعَّل بالقيمة %j', (value) => {
    vi.stubEnv('NEXT_PUBLIC_DEMO_PREVIEW', value);
    expect(isDemoPreviewEnabled()).toBe(false);
  });

  it('تُفعَّل بالقيمة الحرفية true فقط', () => {
    vi.stubEnv('NEXT_PUBLIC_DEMO_PREVIEW', 'true');
    expect(isDemoPreviewEnabled()).toBe(true);
  });
});

describe('DemoLoginButton — الإخفاء', () => {
  it('لا يُرسم شيء عند غياب المتغيّر', () => {
    delete process.env.NEXT_PUBLIC_DEMO_PREVIEW;
    const { container } = renderButton();
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(arMessages.login.demo)).toBeNull();
  });

  it('لا يُرسم عند قيمة غير true', () => {
    vi.stubEnv('NEXT_PUBLIC_DEMO_PREVIEW', 'false');
    const { container } = renderButton();
    expect(container.innerHTML).toBe('');
  });
});

describe('DemoLoginButton — الدخول التجريبي', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_DEMO_PREVIEW', 'true'));

  it('يظهر بالعربية والإنجليزية بنصوص الكتالوج', () => {
    renderButton('ar');
    expect(screen.getByRole('button', { name: arMessages.login.demo })).toBeTruthy();
    cleanup();
    renderButton('en');
    expect(screen.getByRole('button', { name: enMessages.login.demo })).toBeTruthy();
  });

  it('يفعّل المعاينة وينتقل إلى /dashboard بلا أي طلب شبكة ولا توكن', async () => {
    renderButton();
    expect(isDemo()).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: arMessages.login.demo }));

    expect(isDemo()).toBe(true);
    expect(JSON.parse(localStorage.getItem('user') as string)).toEqual(DEMO_USER);
    expect(localStorage.getItem('token')).toBeNull();
    expect(isAuthenticated()).toBe(true); // يعبر حارس (app)/layout
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/dashboard');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('لا يرث فرعاً نشطاً من حساب حقيقي', async () => {
    localStorage.setItem('nibras_active_branch', '0b9b8a4e-0000-4000-8000-000000000001');
    renderButton();

    await userEvent.click(screen.getByRole('button', { name: arMessages.login.demo }));

    expect(localStorage.getItem('nibras_active_branch')).toBeNull();
  });

  it('الخروج يمسح المعاينة والمستخدم ويُسقط الجلسة، بلا طلب شبكة', async () => {
    renderButton();
    await userEvent.click(screen.getByRole('button', { name: arMessages.login.demo }));
    localStorage.setItem('nibras_active_branch', 'br-1'); // فرع المعاينة

    await logout();

    expect(isDemo()).toBe(false);
    expect(localStorage.getItem('demo')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(localStorage.getItem('nibras_active_branch')).toBeNull();
    expect(isAuthenticated()).toBe(false); // (app)/layout يعيد التوجيه إلى /login
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
