// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import arMessages from '@/messages/ar.json';
import { getToken } from '@/lib/api';
import { DEMO_USER, isDemo } from '@/lib/demo';
import { startDemoSession } from '@/lib/demo-session';
import LoginPage from './page';

// شبكة الأمان: لو بدأت المعاينة أثناء طلب دخول حقيقي معلّق (الواجهة الحقيقية تمنعه بتعطيل الزر، لكن التسابق ممكن
// في الفجوة بين الضغطتين)، فاكتمال الطلب لاحقاً — وقد كتب `login()` توكن الحساب الحقيقي — يجب ألّا يترك الجلسة
// على المستأجر الحقيقي. هنا الزر مُستبدَل بنسخة لا تحترم `disabled` لإعادة إنتاج الفجوة نفسها.

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('@/components/auth/auth-shell', () => ({
  AuthShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/auth/demo-login-button', () => ({
  DemoLoginButton: ({ onStart }: { onStart?: () => void }) => (
    <button type="button" onClick={() => { onStart?.(); startDemoSession(); }}>ENTER-DEMO</button>
  ),
}));

const REAL_TOKEN = '88|late-real-token';
const REAL_USER = { id: 'u-real', name: 'مستخدم حقيقي', email: 'owner@acme.sa', role: 'owner', permissions: ['*'], tenant_id: 'tenant-real' };

let finishLogin: (response: unknown) => void;
const fetchSpy = vi.fn();

function renderLogin() {
  return render(
    <NextIntlClientProvider locale="ar" messages={{ login: arMessages.login } as never}>
      <LoginPage />
    </NextIntlClientProvider>,
  );
}

async function startPendingRealLoginThenDemo(container: HTMLElement) {
  await userEvent.type(container.querySelector('#login-email') as HTMLElement, 'owner@acme.sa');
  await userEvent.type(container.querySelector('#login-password') as HTMLElement, 'secret-password');
  await userEvent.click(screen.getByRole('button', { name: arMessages.login.submit }));
  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  await userEvent.click(screen.getByText('ENTER-DEMO'));
  expect(isDemo()).toBe(true); // المعاينة قائمة والطلب الحقيقي ما زال معلّقاً
}

beforeEach(() => {
  localStorage.clear();
  replace.mockReset();
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(() => new Promise((resolve) => { finishLogin = resolve; }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  cleanup();
  localStorage.clear(); // jsdom مشترك بين الملفات: لا يُترك مستخدم/توكن لاختبارات أخرى
  vi.unstubAllGlobals();
});

describe('اكتمال دخول حقيقي بعد بدء المعاينة', () => {
  it('نجاح الطلب المتأخر: يُمسح التوكن الحقيقي وتبقى المعاينة، بلا انتقال للوجهة الحقيقية', async () => {
    const { container } = renderLogin();
    await startPendingRealLoginThenDemo(container);

    finishLogin({ ok: true, status: 200, json: async () => ({ token: REAL_TOKEN, user: REAL_USER }) });

    // يُفرغ استمرار `await login()`: كتب login() التوكن الحقيقي ثم قرّر المعالج المتأخر مسحه.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(getToken()).toBeNull();
    expect(isDemo()).toBe(true);
    expect(JSON.parse(localStorage.getItem('user') as string)).toEqual(DEMO_USER);
    expect(JSON.stringify(localStorage)).not.toContain(REAL_TOKEN);
    expect(JSON.stringify(localStorage)).not.toContain(REAL_USER.email);
    expect(replace).not.toHaveBeenCalled(); // لا /dashboard ولا /me من مسار الدخول الحقيقي
  });

  it('فشل الطلب المتأخر: لا رسالة خطأ فوق المعاينة وتبقى سليمة', async () => {
    const { container } = renderLogin();
    await startPendingRealLoginThenDemo(container);

    finishLogin({ ok: false, status: 422, json: async () => ({ message: 'بيانات غير صحيحة' }) });

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(isDemo()).toBe(true);
    expect(getToken()).toBeNull();
  });
});
