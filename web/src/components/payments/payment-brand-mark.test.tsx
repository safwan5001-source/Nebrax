// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PaymentBrandMark, PaymentBrandRow } from './payment-brand-mark';
import { paymentBrandPresentation, type PaymentBrandPresentation } from '@/lib/payment-brand-registry';
import { renderIntl, TEST_LOCALES } from '@/test-utils/intl';

afterEach(cleanup);

const NAMES = {
  ar: { moyasar: 'ميسّر', mada: 'مدى', visa: 'فيزا', mastercard: 'ماستركارد' },
  en: { moyasar: 'Moyasar', mada: 'mada', visa: 'Visa', mastercard: 'Mastercard' },
} as const;

describe.each(TEST_LOCALES)('PaymentBrandMark (%s)', (locale) => {
  it('renders each registered logo undistorted next to the visible name (decorative image)', () => {
    for (const key of ['moyasar', 'mada', 'visa', 'mastercard'] as const) {
      const brand = paymentBrandPresentation(key)!;
      const { container, unmount } = renderIntl(<PaymentBrandMark brand={brand} withIcon />, locale);
      const img = container.querySelector('img[data-mark="logo"]') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe(brand.logo.src);
      expect(img.getAttribute('alt')).toBe('');
      expect(img.className).toMatch(/object-contain/);
      expect(img.className).not.toMatch(/\bgrayscale|\binvert|\bhue-rotate|\bsepia|\brotate|\bscale-/);
      expect(container.querySelector('[data-mark="generic"]')).toBeNull();
      expect(screen.getAllByText(NAMES[locale][key]).length).toBeGreaterThan(0);
      unmount();
    }
  });

  it('uses the publisher dark variant for Moyasar and a light surface (no recolor) for Tap', () => {
    const moyasar = renderIntl(<PaymentBrandMark brand={paymentBrandPresentation('moyasar')!} />, locale);
    const light = moyasar.container.querySelector('img[data-mark="logo"]') as HTMLImageElement;
    const dark = moyasar.container.querySelector('img[data-mark="logo-dark"]') as HTMLImageElement;
    expect(light.getAttribute('src')).toBe('/payment-brands/moyasar.svg');
    expect(light.className).toMatch(/dark:hidden/);
    expect(dark.getAttribute('src')).toBe('/payment-brands/moyasar-dark.svg');
    expect(dark.className).toMatch(/hidden/);
    expect(dark.className).toMatch(/dark:block/);
    moyasar.unmount();

    const tap = renderIntl(<PaymentBrandMark brand={paymentBrandPresentation('tap')!} />, locale);
    const img = tap.container.querySelector('img[data-mark="logo"]') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/payment-brands/tap.svg');
    expect(img.className).toMatch(/dark:bg-white/);
    expect(tap.container.querySelector('img[data-mark="logo-dark"]')).toBeNull();
  });

  it('renders an official logo undistorted next to the name and falls back to text if it fails to load', async () => {
    const brand: PaymentBrandPresentation = {
      ...paymentBrandPresentation('visa')!,
      logo: { ...paymentBrandPresentation('visa')!.logo, width: 64, height: 20 },
    };
    const { container } = renderIntl(<PaymentBrandMark brand={brand} />, locale);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/payment-brands/visa.svg');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.className).toMatch(/object-contain/);
    expect(screen.getByText(NAMES[locale].visa)).toBeTruthy();

    fireEvent.error(img);
    await waitFor(() => expect(container.querySelector('img')).toBeNull());
    expect(screen.getByText(NAMES[locale].visa)).toBeTruthy();
  });
});

describe.each(TEST_LOCALES)('PaymentBrandRow (%s)', (locale) => {
  it('renders nothing when no method is enabled or the list is unknown', () => {
    for (const enabled of [null, undefined, [], ['moyasar', 'amex']]) {
      const { container, unmount } = renderIntl(<PaymentBrandRow enabled={enabled} label="x" />, locale);
      expect(container.querySelector('[data-testid="payment-brand-row"]')).toBeNull();
      unmount();
    }
  });

  it('lists only the enabled supported methods, labelled for assistive tech', () => {
    renderIntl(<PaymentBrandRow enabled={['visa', 'mada']} label="Accepted" />, locale);
    const list = screen.getByRole('list', { name: 'Accepted' });
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByText(NAMES[locale].mada)).toBeTruthy();
    expect(screen.getByText(NAMES[locale].visa)).toBeTruthy();
    expect(screen.queryByText(/ماستر|Mastercard|Apple/)).toBeNull();
  });

  it('shows Apple Pay in the row only on a device that can pay with it, using the registered official mark', async () => {
    const w = window as unknown as { ApplePaySession?: unknown };
    const { container, unmount } = renderIntl(<PaymentBrandRow enabled={['visa', 'apple_pay']} label="Accepted" />, locale);
    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(container.querySelector('img[src="/payment-brands/apple-pay.svg"]')).toBeNull();
    unmount();

    w.ApplePaySession = { canMakePayments: () => true };
    try {
      const view = renderIntl(<PaymentBrandRow enabled={['visa', 'apple_pay']} label="Accepted" />, locale);
      await waitFor(() => expect(view.container.querySelectorAll('li')).toHaveLength(2));
      const img = view.container.querySelector('img[src="/payment-brands/apple-pay.svg"]') as HTMLImageElement;
      expect(img.getAttribute('alt')).toBe('');
      expect(img.className).toMatch(/object-contain/);
      expect(img.className).not.toMatch(/rounded|shadow|rotate|scale/);
    } finally {
      delete w.ApplePaySession;
    }
  });
});
