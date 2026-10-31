// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import arMessages from '@/messages/ar.json';
import enMessages from '@/messages/en.json';
import { ApiError } from '@/lib/api';
import { AuthShell } from './auth-shell';

// AUTH-EXPERIENCE-V2: the redesign is presentation only. These tests render the real pages inside the real
// shell and pin the behaviour the redesign must not touch: payloads, redirects, error and success states.

const { replace, loginMock, registerMock, apiMock } = vi.hoisted(() => ({
  replace: vi.fn(),
  loginMock: vi.fn(),
  registerMock: vi.fn(),
  apiMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams('token=t-123'),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/image', () => ({
  default: ({ alt, className, src }: { alt: string; className?: string; src: string }) => <img alt={alt} className={className} src={src} />,
}));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  login: loginMock,
  register: registerMock,
  checkStoredSession: vi.fn().mockResolvedValue({ status: 'invalid' }),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));

import LoginPage from '@/app/login/page';
import RegisterPage from '@/app/register/page';
import ForgotPasswordPage from '@/app/forgot-password/page';

/** The field's own input, by its visible label (the reveal-password button shares the word «كلمة المرور»). */
const field = (label: string) => screen.getByLabelText(new RegExp(`^${label}`), { selector: 'input' });

function withIntl(node: React.ReactNode, locale: 'ar' | 'en' = 'ar') {
  const messages = locale === 'ar' ? arMessages : enMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages as never}>
      {node}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  replace.mockReset();
  loginMock.mockReset();
  registerMock.mockReset();
  apiMock.mockReset();
});
afterEach(() => cleanup());

describe('AuthShell', () => {
  it('renders exactly the previous shell when no experience is chosen (the platform console login)', () => {
    const { container } = withIntl(
      <AuthShell>
        <p>form</p>
      </AuthShell>,
    );
    expect(container.querySelector('.ax')).toBeNull();
    expect(container.querySelector('main.relative.min-h-screen')).not.toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it.each(['login', 'register', 'recovery'] as const)('renders the %s brand panel with its real points', (experience) => {
    const { container } = withIntl(
      <AuthShell experience={experience}>
        <p>form</p>
      </AuthShell>,
      'en',
    );
    const ax = arMessages.authExperience as Record<string, string>;
    const en = enMessages.authExperience as Record<string, string>;
    expect(container.querySelector('.ax')?.getAttribute('data-experience')).toBe(experience);
    const panel = screen.getByRole('complementary', { name: en.panel_aria });
    expect(panel.querySelector('h2')?.textContent).toBe(en[`${experience}_title`]);
    const points = Object.keys(ax).filter((key) => key.startsWith(`${experience}_point_`));
    expect(panel.querySelectorAll('.ax-points li')).toHaveLength(points.length);
    // The decorative product glimpse never reaches assistive technology.
    expect(panel.querySelector('figure')?.getAttribute('aria-hidden')).toBe('true');
    // Logo link and the language/theme tools stay available.
    expect(container.querySelector('a[href="/"]')).not.toBeNull();
  });
});

describe('login page inside the experience', () => {
  it('signs in with the same payload and redirects as before', async () => {
    loginMock.mockResolvedValue({ role: 'owner' });
    withIntl(<LoginPage />);
    const user = userEvent.setup();
    await user.type(field(arMessages.login.email), 'owner@awj.sa');
    await user.type(field(arMessages.login.password), 'secret-pass');
    await user.click(screen.getByLabelText(arMessages.login.remember));
    await user.click(screen.getByRole('button', { name: arMessages.login.submit }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(loginMock).toHaveBeenCalledWith('owner@awj.sa', 'secret-pass', true);
  });

  it('shows field errors and the server error as alerts', async () => {
    loginMock.mockRejectedValue(new ApiError(422, 'بيانات الدخول غير صحيحة', null));
    withIntl(<LoginPage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: arMessages.login.submit }));
    expect(await screen.findByText(arMessages.login.email_invalid)).toBeTruthy();
    expect(loginMock).not.toHaveBeenCalled();
    await user.type(field(arMessages.login.email), 'owner@awj.sa');
    await user.type(field(arMessages.login.password), 'x');
    await user.click(screen.getByRole('button', { name: arMessages.login.submit }));
    const alert = await screen.findByText('بيانات الدخول غير صحيحة');
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps the recovery and sign-up links', () => {
    withIntl(<LoginPage />);
    expect(screen.getByRole('link', { name: arMessages.login.forgot_link }).getAttribute('href')).toBe('/forgot-password');
    expect(screen.getByRole('link', { name: arMessages.login.register_link }).getAttribute('href')).toBe('/register');
  });
});

describe('register page inside the experience', () => {
  it('keeps every required field, grouped in two labelled sections', () => {
    withIntl(<RegisterPage />);
    const r = arMessages.register;
    expect(screen.getByRole('group', { name: r.section_company })).toBeTruthy();
    expect(screen.getByRole('group', { name: r.section_account })).toBeTruthy();
    for (const label of [r.company_name, r.slug, r.email, r.phone, r.password]) {
      expect(field(label), label).toBeTruthy();
    }
  });

  it('validates before calling the API and submits the same payload as before', async () => {
    registerMock.mockResolvedValue({ tenant: { slug: 'acme' }, handoffCode: null });
    withIntl(<RegisterPage />);
    const user = userEvent.setup();
    const r = arMessages.register;
    await user.click(screen.getByRole('button', { name: r.submit }));
    expect(await screen.findByText(r.phone_invalid)).toBeTruthy();
    expect(registerMock).not.toHaveBeenCalled();

    await user.type(field(r.company_name), 'Acme');
    await user.type(field(r.slug), 'Acme');
    await user.type(field(r.email), 'owner@acme.sa');
    await user.type(field(r.phone), '512345678');
    await user.type(field(r.password), 'Str0ng!pass');
    await user.click(screen.getByRole('button', { name: r.submit }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(registerMock).toHaveBeenCalledWith({
      company_name: 'Acme',
      slug: 'acme',
      email: 'owner@acme.sa',
      password: 'Str0ng!pass',
      phone: '+966512345678',
    });
  });

  async function fillRegisterAndSubmit(user: ReturnType<typeof userEvent.setup>, phone: string) {
    const r = arMessages.register;
    await user.type(field(r.company_name), 'Acme');
    await user.type(field(r.slug), 'acme');
    await user.type(field(r.email), 'owner@acme.sa');
    await user.type(field(r.phone), phone);
    await user.type(field(r.password), 'Str0ng!pass');
    await user.click(screen.getByRole('button', { name: r.submit }));
  }

  it('INTL-PHONE: sends an international number typed key by key as E.164 (the country follows the typed code)', async () => {
    registerMock.mockResolvedValue({ tenant: { slug: 'acme' }, handoffCode: null });
    withIntl(<RegisterPage />);
    const user = userEvent.setup();
    await fillRegisterAndSubmit(user, '+971501234567');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(registerMock).toHaveBeenCalledWith(expect.objectContaining({ phone: '+971501234567' }));
  });

  it('INTL-PHONE: Arabic digits typed in the phone field are sent as English E.164 digits', async () => {
    registerMock.mockResolvedValue({ tenant: { slug: 'acme' }, handoffCode: null });
    withIntl(<RegisterPage />);
    const user = userEvent.setup();
    await fillRegisterAndSubmit(user, '٠٥١٢٣٤٥٦٧٨');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(registerMock).toHaveBeenCalledWith(expect.objectContaining({ phone: '+966512345678' }));
    expect((field(arMessages.register.phone) as HTMLInputElement).value).not.toMatch(/[\u0660-\u0669\u06f0-\u06f9]/);
  });

  it('INTL-PHONE: a number invalid for the chosen country (or a landline) blocks the submit with the phone error', async () => {
    withIntl(<RegisterPage />);
    const user = userEvent.setup();
    await fillRegisterAndSubmit(user, '112345678'); // خط ثابت سعودي
    expect(await screen.findByText(arMessages.register.phone_invalid)).toBeTruthy();
    expect(registerMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText(new RegExp(`^${arMessages.register.phone}`), { selector: 'input' }).getAttribute('aria-invalid')).toBe('true');
  });

  it('asserts no consent to terms or a privacy policy that are not published yet', () => {
    for (const locale of ['ar', 'en'] as const) {
      cleanup();
      withIntl(<RegisterPage />, locale);
      expect(document.body.textContent ?? '').not.toMatch(/الشروط والأحكام|سياسة الخصوصية|Terms|Privacy Policy/i);
    }
    expect(arMessages.register).not.toHaveProperty('terms');
    expect(enMessages.register).not.toHaveProperty('terms');
  });
});

describe('forgot password inside the experience', () => {
  it('announces success as a status after the request', async () => {
    apiMock.mockResolvedValue({});
    withIntl(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText(arMessages.login.email), { target: { value: 'owner@awj.sa' } });
    fireEvent.submit(screen.getByRole('button', { name: arMessages.login.forgot_submit }).closest('form')!);
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain(arMessages.login.forgot_success);
    expect(apiMock).toHaveBeenCalledWith('/forgot-password', { method: 'POST', body: { email: 'owner@awj.sa' } });
  });
});

describe('auth experience copy', () => {
  const ar = arMessages.authExperience as Record<string, string>;
  const en = enMessages.authExperience as Record<string, string>;

  it('Arabic and English carry the same non-empty keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
    for (const catalog of [ar, en]) for (const [key, value] of Object.entries(catalog)) expect(value.trim(), key).not.toBe('');
    for (const key of ['section_company', 'section_account']) {
      expect((arMessages.register as Record<string, string>)[key]).toBeTruthy();
      expect((enMessages.register as Record<string, string>)[key]).toBeTruthy();
    }
  });

  it('every key the shell composes exists', () => {
    for (const experience of ['login', 'register', 'recovery']) {
      for (const suffix of ['title', 'lead', 'lead_short']) expect(ar, `${experience}_${suffix}`).toHaveProperty(`${experience}_${suffix}`);
    }
  });

  it('promises no specific time on the auth surfaces (login, register, panel)', () => {
    const copy = [arMessages.login, enMessages.login, arMessages.register, enMessages.register, ar, en]
      .flatMap((catalog) => Object.values(catalog as Record<string, unknown>))
      .filter((value): value is string => typeof value === 'string')
      .join('\n');
    expect(copy).not.toMatch(/دقائق|دقيقة|ثوانٍ|ثوان|فوراً|فورًا|مباشرةً|in minutes|minutes?\b|seconds?\b|instantly|right away|immediately/i);
  });

  it('makes no claim the product cannot back', () => {
    const all = [...Object.values(ar), ...Object.values(en)].join('\n');
    expect(all).not.toMatch(/free trial|تجربة مجانية|مجاناً|مجاني|per month|شهرياً|no credit card/i);
    expect(all).not.toMatch(/trusted by|testimonial|customers|يثق بنا|عملاؤنا|\b\d{2,}\+|٪|%/i);
    expect(all).not.toMatch(/compliant|متوافق|certified|معتمد من|ISO|SOC ?2|uptime|100/i);
    expect(all).not.toMatch(/HungerStation|Jahez|Keeta|Mrsool|App Store|Google Play/i);
  });
});

describe('auth experience stylesheet', () => {
  const css = readFileSync(resolve(__dirname, 'auth-experience.css'), 'utf8');
  const landingCss = readFileSync(resolve(__dirname, '../../app/landing.css'), 'utf8');
  const palette = (source: string) =>
    [...source.matchAll(/\/\* palette:start \*\/([\s\S]*?)\/\* palette:end \*\//g)]
      .map((match) => match[1])
      .join('\n')
      .match(/--mk-[a-z0-9-]+:\s*#[0-9a-f]{3,8}/gi)!
      .map((pair) => pair.replace(/\s+/g, ' ').toLowerCase());

  it('keeps colour literals inside the palette block only', () => {
    const body = css.replace(/\/\* palette:start \*\/[\s\S]*?\/\* palette:end \*\//g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(body).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklch|oklab)\(/);
  });

  it('uses the same palette values as Landing V2 for every token both declare', () => {
    const landing = new Set(palette(landingCss));
    const auth = palette(css);
    expect(auth.length).toBeGreaterThan(20);
    for (const pair of auth) expect(landing, pair).toContain(pair);
  });

  it('scopes every selector to .ax so no other screen can inherit it', () => {
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
      .match(/(^|\})\s*([^{}@]+)\{/g)!
      .map((rule) => rule.replace(/^\}?\s*/, '').replace(/\{$/, '').trim());
    expect(selectors.length).toBeGreaterThan(40);
    for (const selector of selectors) {
      for (const part of selector.split(',').map((piece) => piece.trim())) {
        expect(part, part).toMatch(/\.ax\b|\.ax-/);
      }
    }
  });

  it('stops all motion under prefers-reduced-motion and keeps inputs at 16px for iOS', () => {
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/animation: none !important/);
    expect(reduced).toMatch(/transition: none !important/);
    expect(css).toMatch(/\.ax \.ax-input \{[^}]*font-size: 1rem/);
  });
});
