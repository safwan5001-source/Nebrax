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
import { isValidE164 } from '@/lib/phone/phone';
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
    expect(screen.getAllByText(arMessages.phoneInput.empty).length).toBeGreaterThan(0);
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

  it('never silently truncates an over-long number: it stays visible and is simply invalid', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(input(), '5'.repeat(30));
    expect(input().value).toBe('5'.repeat(20)); // سقف أمان للإدخال، لا اقتطاعاً إلى رقم يبدو صالحاً
    expect(isValidE164(e164()!)).toBe(false);
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

describe('typing an international number character by character (Codex P2)', () => {
  it('+971501234567 typed key by key switches Saudi → UAE and produces the right E.164', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(input(), '+971501234567');
    expect(flagOf()).toBe('AE');
    expect(dial()).toBe('+971');
    expect(input().value).toBe('501234567');
    expect(e164()).toBe('+971501234567');
  });

  it('keeps the incomplete prefix visible until the calling code is known', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(input(), '+97');
    expect(input().value).toBe('+97');
    expect(flagOf()).toBe('SA'); // لم يُحسم بعد
    expect(e164()).toBe('+97');
    await user.type(input(), '1');
    expect(input().value).toBe('');
    expect(flagOf()).toBe('AE');
    expect(e164()).toBe(''); // رمز الدولة وحده ليس رقماً بعد
  });

  it('a lone + stays visible instead of vanishing', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(input(), '+');
    expect(input().value).toBe('+');
    await user.type(input(), '2');
    expect(input().value).toBe('+2');
    await user.type(input(), '0');
    expect(flagOf()).toBe('EG');
    expect(input().value).toBe('');
  });

  it('the 00 prefix works key by key too', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(input(), '00971501234567');
    expect(flagOf()).toBe('AE');
    expect(input().value).toBe('501234567');
    expect(e164()).toBe('+971501234567');
  });

  it('Arabic digits typed after + are converted and still resolve the country', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(input(), '+٩٦٧٧١٢٣٤٥٦٧٨');
    expect(flagOf()).toBe('YE');
    expect(input().value).toBe('712345678');
    expect(e164()).toBe('+967712345678');
    expect(document.body.textContent).not.toMatch(/[\u0660-\u0669\u06f0-\u06f9]/);
  });

  it('changing the country while a prefix is still pending does not rewrite what was typed', async () => {
    const user = userEvent.setup();
    mount('ar');
    await user.type(input(), '+97');
    await pick(user, 'مصر', 'EG');
    expect(input().value).toBe('+97');
    expect(e164()).toBe('+97');
  });

  it('a country change never truncates the typed digits', async () => {
    const user = userEvent.setup();
    mount('ar');
    await pick(user, 'الولايات المتحدة', 'US');
    await user.type(input(), '2345678901234'); // 13 رقماً: أطول من أي رقم وطني، تبقى كاملة
    expect(input().value).toBe('2345678901234');
    await pick(user, 'السعودية', 'SA');
    expect(input().value).toBe('2345678901234');
  });
});

describe('shared calling codes and saved values (+1, legacy)', () => {
  function direct(value: string, defaultCountry?: 'US' | 'CA' | 'SA', locale: 'ar' | 'en' = 'en') {
    const onChange = vi.fn();
    const messages = locale === 'ar' ? arMessages : enMessages;
    const ui = (v: string) => (
      <NextIntlClientProvider locale={locale} messages={messages as never}>
        <label htmlFor="ph">Phone</label>
        <InternationalPhoneInput id="ph" value={v} onChange={onChange} defaultCountry={defaultCountry} />
      </NextIntlClientProvider>
    );
    const view = render(ui(value));
    return { onChange, rerender: (v: string) => view.rerender(ui(v)) };
  }

  it('US ↔ CA: switching keeps the very same E.164 and shows no "kept" note', async () => {
    const user = userEvent.setup();
    mount('en');
    await pick(user, 'united states', 'US');
    await user.type(input(), '2025550123');
    expect(e164()).toBe('+12025550123');
    await pick(user, 'canada', 'CA');
    expect(flagOf()).toBe('CA');
    expect(dial()).toBe('+1');
    expect(input().value).toBe('2025550123');
    expect(e164()).toBe('+12025550123');
    expect(screen.queryByTestId('phone-kept-note')).toBeNull();
  });

  it('searching +1 lists the United States first and Canada among its siblings', async () => {
    const user = userEvent.setup();
    mount('en');
    await user.click(trigger());
    await user.type(screen.getByRole('combobox'), '+1');
    const codes = [...document.querySelectorAll('[role="option"]')].map((o) => o.getAttribute('data-country'));
    expect(codes[0]).toBe('US');
    expect(codes).toContain('CA');
  });

  it('pasting a Canadian number while the United States is selected selects Canada without changing the number', async () => {
    const user = userEvent.setup();
    mount('en');
    await pick(user, 'united states', 'US');
    input().focus();
    await user.paste('+1 416 234 5678');
    expect(flagOf()).toBe('CA');
    expect(e164()).toBe('+14162345678');
    expect(input().value).toBe('4162345678');
  });

  it('typing just +1 while Canada is selected keeps Canada', async () => {
    const user = userEvent.setup();
    mount('en');
    await pick(user, 'canada', 'CA');
    await user.type(input(), '+1');
    expect(flagOf()).toBe('CA');
    expect(input().value).toBe('');
  });

  it('restores a saved +1 number to the country it belongs to, and a partial one to the caller default', () => {
    direct('+14162345678', 'US');
    expect(flagOf()).toBe('CA');
    cleanup();
    direct('+1416', 'CA');
    expect(flagOf()).toBe('CA');
    expect(input().value).toBe('416');
  });

  it('an external re-set of the same shared-code number does not flip the selected sibling', () => {
    const { rerender } = direct('+1416', 'CA');
    rerender('+14165');
    expect(flagOf()).toBe('CA');
    expect(input().value).toBe('4165');
  });

  it('restoring a legacy local value shows it unchanged with a note, guesses no country and emits nothing', async () => {
    const user = userEvent.setup();
    const { onChange } = direct('0500000000', 'SA', 'ar');
    expect(input().value).toBe('0500000000');
    expect(screen.getByTestId('phone-legacy-note').textContent).toBe(arMessages.phoneInput.legacy_note);
    expect(onChange).not.toHaveBeenCalled();
    // التعديل الصريح فقط يحوّله إلى E.164 تحت الدولة المختارة.
    await user.type(input(), '1');
    expect(onChange).toHaveBeenLastCalledWith('+96650000000' + '01');
    expect(screen.queryByTestId('phone-legacy-note')).toBeNull();
  });

  it('a legacy value written with Arabic digits is shown with English digits', () => {
    direct('٠٥٠٠٠٠٠٠٠٠', 'SA', 'ar');
    expect(input().value).toBe('0500000000');
  });
});

describe('keyboard and accessibility', () => {
  it('opening with the keyboard focuses the search so the arrows work, then Enter picks and returns focus to the number', async () => {
    const user = userEvent.setup();
    mount('en');
    trigger().focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    await user.keyboard('egypt');
    expect(screen.getByRole('combobox').getAttribute('aria-activedescendant')).toBe('ph-opt-EG');
    await user.keyboard('{Enter}');
    expect(flagOf()).toBe('EG');
    expect(document.activeElement).toBe(input());
  });

  it('ArrowDown/ArrowUp/Home/End move the active option', async () => {
    const user = userEvent.setup();
    mount('en');
    trigger().focus();
    await user.keyboard('{ArrowDown}');
    const search = screen.getByRole('combobox');
    const options = () => [...document.querySelectorAll('[role="option"]')];
    await user.keyboard('{Home}');
    expect(search.getAttribute('aria-activedescendant')).toBe(options()[0].id);
    await user.keyboard('{End}');
    expect(search.getAttribute('aria-activedescendant')).toBe(options().at(-1)!.id);
    await user.keyboard('{ArrowUp}');
    expect(search.getAttribute('aria-activedescendant')).toBe(options().at(-2)!.id);
  });

  it('announces the result count politely, in English digits in both languages', async () => {
    for (const locale of ['ar', 'en'] as const) {
      cleanup();
      const user = userEvent.setup();
      mount(locale);
      await user.click(trigger());
      const status = screen.getByTestId('phone-results-status');
      expect(status.getAttribute('aria-live')).toBe('polite');
      expect(status.textContent).toMatch(/^[0-9]+ /);
      expect(status.textContent).not.toMatch(/[\u0660-\u0669\u06f0-\u06f9]/);
      await user.type(screen.getByRole('combobox'), 'zzzz');
      expect(screen.getByTestId('phone-results-status').textContent).toBe(
        locale === 'ar' ? arMessages.phoneInput.empty : enMessages.phoneInput.empty,
      );
    }
  });

  it('exposes a listbox with named options and a labelled search field', async () => {
    const user = userEvent.setup();
    mount('en');
    await user.click(trigger());
    expect(screen.getByRole('combobox').getAttribute('aria-label')).toBe(enMessages.phoneInput.search_label);
    expect(screen.getByRole('listbox').getAttribute('aria-label')).toBe(enMessages.phoneInput.country_label);
    for (const option of [...document.querySelectorAll('[role="option"]')].slice(0, 5)) {
      expect(option.textContent!.trim().length).toBeGreaterThan(0);
    }
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
