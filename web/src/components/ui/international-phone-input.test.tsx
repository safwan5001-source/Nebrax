// @vitest-environment jsdom
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import arMessages from '@/messages/ar.json';
import enMessages from '@/messages/en.json';
import { InternationalPhoneInput } from './international-phone-input';

afterEach(() => cleanup());

/** يحاكي نموذجاً: يحمل E.164 ويعرضه، ويسجّل كل ما صدر. */
function Harness({ initial = '', onValue }: { initial?: string; onValue?: (v: string) => void }) {
  const [value, setValue] = React.useState(initial);
  return (
    <>
      <label htmlFor="ph">Phone</label>
      <InternationalPhoneInput
        id="ph"
        value={value}
        onChange={(v) => {
          setValue(v);
          onValue?.(v);
        }}
      />
      <output data-testid="e164">{value}</output>
    </>
  );
}

function mount(locale: 'ar' | 'en' = 'ar', props: React.ComponentProps<typeof Harness> = {}) {
  const messages = locale === 'ar' ? arMessages : enMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages as never}>
      <Harness {...props} />
    </NextIntlClientProvider>,
  );
}

const input = () => screen.getByLabelText('Phone', { selector: 'input' }) as HTMLInputElement;
const trigger = () => screen.getByTestId('phone-country-trigger');
const dial = () => screen.getByTestId('phone-dial-code').textContent;
const e164 = () => screen.getByTestId('e164').textContent;
const flagOf = () => trigger().querySelector('img')?.getAttribute('data-flag');

async function pick(user: ReturnType<typeof userEvent.setup>, search: string, code: string) {
  await user.click(trigger());
  await user.type(screen.getByRole('combobox'), search);
  await user.click(document.querySelector(`[data-country="${code}"]`)!);
}

describe('InternationalPhoneInput', () => {
  it('defaults to Saudi Arabia with its real flag and +966', () => {
    mount();
    expect(dial()).toBe('+966');
    expect(flagOf()).toBe('SA');
    expect(trigger().querySelector('img')!.getAttribute('src')).toBe('/flags/SA.svg');
    expect(input().getAttribute('dir')).toBe('ltr');
    expect(input().getAttribute('inputmode')).toBe('tel');
  });

  it.each([
    ['Saudi Arabia', 'SA', 'السعودية', '+966', '512345678', '+966512345678'],
    ['UAE', 'AE', 'الإمارات', '+971', '501234567', '+971501234567'],
    ['Yemen', 'YE', 'اليمن', '+967', '712345678', '+967712345678'],
    ['Egypt', 'EG', 'مصر', '+20', '1012345678', '+201012345678'],
    ['India', 'IN', 'الهند', '+91', '9876543210', '+919876543210'],
    ['United States', 'US', 'الولايات المتحدة', '+1', '2025550123', '+12025550123'],
  ])('selects %s: right flag, dial code changes, E.164 emitted', async (_n, code, arabicName, dialCode, national, expected) => {
    const user = userEvent.setup();
    mount('ar');
    await pick(user, arabicName, code);
    expect(flagOf()).toBe(code);
    expect(dial()).toBe(dialCode);
    await user.type(input(), national);
    expect(e164()).toBe(expected);
  });

  it('shows every row with flag, name and dial code in English digits', async () => {
    const user = userEvent.setup();
    mount('en');
    await user.click(trigger());
    const row = document.querySelector('[data-country="EG"]')!;
    expect(row.textContent).toContain('Egypt');
    expect(row.textContent).toContain('+20');
    expect(row.querySelector('img')!.getAttribute('src')).toBe('/flags/EG.svg');
    expect(document.querySelectorAll('[role="option"]').length).toBeGreaterThan(220);
    // لا رقم عربي/فارسي في اللوحة كلها.
    expect(screen.getByTestId('phone-country-panel').textContent).not.toMatch(/[٠-٩۰-۹]/);
  });

  it('searches by Arabic name, English name and dial code (also typed with Arabic digits)', async () => {
    const user = userEvent.setup();
    mount('ar');
    await user.click(trigger());
    const search = screen.getByRole('combobox');
    const first = () => document.querySelector('[role="option"]')?.getAttribute('data-country');

    await user.type(search, 'اليمن');
    expect(first()).toBe('YE');
    await user.clear(search);
    await user.type(search, 'india');
    expect(first()).toBe('IN');
    await user.clear(search);
    await user.type(search, '+٩٦٧');
    expect(first()).toBe('YE');
    expect((search as HTMLInputElement).value).toBe('+٩٦٧'); // ما كتبه المستخدم؛ التطبيع للمطابقة فقط
    await user.clear(search);
    await user.type(search, 'zzzz');
    expect(screen.getByText(arMessages.phoneInput.empty)).toBeTruthy();
  });

  it('converts Arabic and Persian digits typed into the field to English', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(input(), '٥١٢٣٤٥٦٧٨');
    expect(input().value).toBe('512345678');
    expect(e164()).toBe('+966512345678');
    fireEvent.change(input(), { target: { value: '۵۱۲۳۴۵۶۷۹' } });
    expect(input().value).toBe('512345679');
    expect(e164()).toBe('+966512345679');
    expect(input().value).not.toMatch(/[٠-٩۰-۹]/);
  });

  it('strips a leading national zero', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(input(), '0512345678');
    expect(e164()).toBe('+966512345678');
  });

  it('a pasted international number selects its country and never duplicates the dial code', async () => {
    const user = userEvent.setup();
    mount();
    input().focus();
    await user.paste('+971 50 123 4567');
    expect(flagOf()).toBe('AE');
    expect(dial()).toBe('+971');
    expect(input().value).toBe('501234567');
    expect(e164()).toBe('+971501234567');

    await user.clear(input());
    await user.paste('+٩٦٧ ٧١٢ ٣٤٥ ٦٧٨');
    expect(flagOf()).toBe('YE');
    expect(input().value).toBe('712345678');
    expect(e164()).toBe('+967712345678');

    await user.clear(input());
    await user.paste('00201012345678');
    expect(flagOf()).toBe('EG');
    expect(e164()).toBe('+201012345678');
  });

  it('a national paste that already starts with the country code is not doubled', async () => {
    const user = userEvent.setup();
    mount();
    input().focus();
    await user.paste('966512345678');
    expect(e164()).toBe('+966512345678');
    expect(input().value).toBe('512345678');
  });

  it('keeps the typed number when the country changes and says so', async () => {
    const user = userEvent.setup();
    mount('ar');
    await user.type(input(), '512345678');
    expect(screen.queryByTestId('phone-kept-note')).toBeNull();
    await pick(user, 'مصر', 'EG');
    expect(input().value).toBe('512345678');
    expect(e164()).toBe('+20512345678');
    expect(screen.getByTestId('phone-kept-note').textContent).toBe(arMessages.phoneInput.kept_note);
    await user.type(input(), '9');
    expect(screen.queryByTestId('phone-kept-note')).toBeNull();
  });

  it('does not nag when the field is empty at country change', async () => {
    const user = userEvent.setup();
    mount();
    await pick(user, 'india', 'IN');
    expect(screen.queryByTestId('phone-kept-note')).toBeNull();
  });

  it('works from the keyboard: arrows, Enter and Escape', async () => {
    const user = userEvent.setup();
    mount('en');
    trigger().focus();
    await user.keyboard('{ArrowDown}');
    const search = screen.getByRole('combobox');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    await user.type(search, 'yemen');
    await user.keyboard('{Enter}');
    expect(flagOf()).toBe('YE');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(input());

    await user.click(trigger());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('exposes the selected option and an accessible label for the trigger', async () => {
    const user = userEvent.setup();
    mount('en');
    expect(trigger().getAttribute('aria-label')).toContain('Saudi Arabia');
    expect(trigger().getAttribute('aria-label')).toContain('+966');
    await user.click(trigger());
    const list = screen.getByRole('listbox');
    const selected = within(list).getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute('data-country')).toBe('SA');
  });

  it('closes when clicking outside', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(trigger());
    expect(screen.getByRole('listbox')).toBeTruthy();
    await user.click(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('restores state from an existing E.164 value and follows external resets', () => {
    const { rerender } = mount('ar', { initial: '+919876543210' });
    expect(flagOf()).toBe('IN');
    expect(input().value).toBe('9876543210');
    expect(rerender).toBeTypeOf('function');
  });

  it('caps the length at the E.164 maximum', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(input(), '5'.repeat(30));
    expect(e164()!.replace('+', '').length).toBeLessThanOrEqual(15);
  });

  it('is LTR in both RTL and LTR UIs, and uses English digits in both', () => {
    for (const locale of ['ar', 'en'] as const) {
      cleanup();
      mount(locale);
      expect(input().closest('[dir]')!.getAttribute('dir')).toBe('ltr');
      expect(screen.getByTestId('phone-dial-code').textContent).toMatch(/^\+[0-9]+$/);
      expect(input().placeholder).toMatch(/^[0-9 ()\-]*$/);
    }
  });

  it('falls back to a globe when a flag file fails to load', () => {
    mount();
    fireEvent.error(trigger().querySelector('img')!);
    expect(trigger().querySelector('img')).toBeNull();
    expect(dial()).toBe('+966');
  });
});

describe('flag assets', () => {
  it('ship a real SVG for every selectable country with its original 3:2 box', async () => {
    const { allCountries } = await import('@/lib/phone/phone');
    for (const code of allCountries()) {
      const svg = readFileSync(resolve(__dirname, `../../../public/flags/${code}.svg`), 'utf8');
      expect(svg.startsWith('<svg'), code).toBe(true);
      const vb = /viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
      expect(vb, code).not.toBeNull();
      expect(Number(vb![1]) / Number(vb![2]), code).toBeCloseTo(1.5, 1);
    }
    vi.resetModules();
  });
});
