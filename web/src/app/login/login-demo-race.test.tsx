// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import arMessages from '@/messages/ar.json';
import { getToken } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { DEMO_USER, isDemo } from '@/lib/demo';
import LoginPage from './page';

// تسابق «دخول حقيقي معلّق» مع «دخول تجريبي» — الواجهة الفعلية (الصفحة + الزر الحقيقي)، و`login()`/`api()` حقيقيان؛
// وحده `fetch` مزيَّف بوعدٍ نتحكم في لحظة اكتماله. (مسار الاكتمال المتأخر بعد بدء المعاينة: login-demo-late-completion.test.tsx)

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('@/components/auth/auth-shell', () => ({
  AuthShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

const REAL_TOKEN = '77|real-sanctum-token';
const REAL_USER = { id: 'u-real', name: 'مستخدم حقيقي', email: 'owner@acme.sa', role: 'owner', permissions: ['*'], tenant_id: 'tenant-real' };

let finishLogin: (response: unknown) => void;
const fetchSpy = vi.fn();

const okLogin = () => ({ ok: true, status: 200, json: async () => ({ token: REAL_TOKEN, user: REAL_USER }) });

function renderLogin() {
  return render(
    <NextIntlClientProvider locale="ar" messages={{ login: arMessages.login } as never}>
      <LoginPage />
    </NextIntlClientProvider>,
  );
}

async function submitRealLogin(container: HTMLElement) {
  await userEvent.type(container.querySelector('#login-email') as HTMLElement, 'owner@acme.sa');
  await userEvent.type(container.querySelector('#login-password') as HTMLElement, 'secret-password');
  await userEvent.click(screen.getByRole('button', { name: arMessages.login.submit }));
  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1)); // الطلب معلّق الآن
}

const demoButton = () => screen.getByRole('button', { name: arMessages.login.demo }) as HTMLButtonElement;

beforeEach(() => {
  localStorage.clear();
  replace.mockReset();
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(() => new Promise((resolve) => { finishLogin = resolve; }));
  vi.stubGlobal('fetch', fetchSpy);
  vi.stubEnv('NEXT_PUBLIC_DEMO_PREVIEW', 'true');
});

afterEach(() => {
  cleanup();
  localStorage.clear(); // jsdom مشترك بين الملفات: لا يُترك مستخدم/توكن لاختبارات أخرى
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('دخول حقيقي معلّق + دخول تجريبي متزامن', () => {
  it('الزر معطَّل أثناء الطلب المعلّق، والضغط عليه لا يبدأ معاينة', async () => {
    const { container } = renderLogin();
    expect(demoButton().disabled).toBe(false);

    await submitRealLogin(container);

    expect(demoButton().disabled).toBe(true);
    fireEvent.click(demoButton()); // الضغط على زر معطَّل
    expect(isDemo()).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    expect(localStorage.getItem('demo')).toBeNull();
  });

  it('عند اكتمال الدخول الحقيقي بعد محاولة المعاينة تبقى الجلسة الحقيقية وحدها، دون معاينة', async () => {
    const { container } = renderLogin();
    await submitRealLogin(container);
    fireEvent.click(demoButton()); // محاولة متزامنة تُتجاهل

    finishLogin(okLogin());

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith('/dashboard');
    expect(isDemo()).toBe(false);
    expect(getToken()).toBe(REAL_TOKEN);
    expect(currentUser()?.id).toBe(REAL_USER.id);
  });

  it('يعود الزر للتفعيل إذا فشل الدخول الحقيقي', async () => {
    const { container } = renderLogin();
    await submitRealLogin(container);
    expect(demoButton().disabled).toBe(true);

    finishLogin({ ok: false, status: 422, json: async () => ({ message: 'بيانات غير صحيحة' }) });

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('بيانات غير صحيحة'));
    expect(demoButton().disabled).toBe(false);
    expect(isDemo()).toBe(false);
  });

  it('بعد بدء المعاينة يُقفل نموذج الدخول الحقيقي ولا يُرسل طلب', async () => {
    const { container } = renderLogin();

    await userEvent.click(demoButton());

    expect(isDemo()).toBe(true);
    expect(replace).toHaveBeenCalledWith('/dashboard');
    expect((screen.getByRole('button', { name: arMessages.login.submit }) as HTMLButtonElement).disabled).toBe(true);
    expect(demoButton().disabled).toBe(true);

    await userEvent.type(container.querySelector('#login-email') as HTMLElement, 'owner@acme.sa');
    await userEvent.type(container.querySelector('#login-password') as HTMLElement, 'secret-password');
    fireEvent.submit(container.querySelector('form') as HTMLFormElement); // Enter يتجاوز تعطيل الزر

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getToken()).toBeNull();
    expect(JSON.parse(localStorage.getItem('user') as string)).toEqual(DEMO_USER);
  });
});
