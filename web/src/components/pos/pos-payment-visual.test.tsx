// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPaymentMethodLogoCache } from '@/modules/payments/methods/PaymentMethodVisual';
import { PosPayment, type PosPaymentMethod } from './pos-payment';

const { fetchImageUrl } = vi.hoisted(() => ({ fetchImageUrl: vi.fn() }));
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), fetchImageUrl }));

const methods: PosPaymentMethod[] = [
  { id: 'cash', name: 'Cash', name_en: 'Cash', settlement_type: 'cash', is_active: true, is_default: true },
  { id: 'wallet', name: 'Wallet', name_en: 'Wallet', settlement_type: 'bank', is_active: true, is_default: false, visual_mode: 'icon', icon_key: 'wallet', icon_color: '#12AB34' },
  { id: 'logo', name: 'Logo', name_en: 'Logo', settlement_type: 'bank', is_active: true, is_default: false, visual_mode: 'image', has_logo: true, updated_at: 'v1' },
];

function renderPos() {
  return render(
    <PosPayment
      allowDeferredPayment={false} customerName="Walk-in" defaultPaymentMethodId="cash" error={null} items={[]}
      onBack={vi.fn()} onConfirm={vi.fn()} paying={false} paymentMethods={methods} paymentMethodsLoadError={null}
      paymentMethodsLoading={false} subMinor={10000} discMinor={0} taxMinor={1500} totalMinor={11500}
    />,
  );
}

describe('PosPayment — تخصيص بصري لأزرار الدفع', () => {
  afterEach(() => { cleanup(); fetchImageUrl.mockReset(); clearPaymentMethodLogoCache(); });

  it('الطريقة بلا تخصيص تبقى بأيقونتها الافتراضية، والمخصَّصة تعرض أيقونتها أو شعارها', async () => {
    fetchImageUrl.mockResolvedValue('blob:pos-logo');
    renderPos();
    expect(screen.getByRole('button', { name: /Cash/ }).querySelector('[data-testid="payment-method-visual-default"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Wallet/ }).querySelector('[data-testid="payment-method-visual-icon"]')?.getAttribute('style')).toContain('color');
    await waitFor(() => expect(screen.getByRole('button', { name: /Logo/ }).querySelector('img')?.getAttribute('src')).toBe('blob:pos-logo'));
  });

  it('تعذّر الشعار لا يكسر الزر ويسقط للأيقونة الافتراضية', async () => {
    fetchImageUrl.mockResolvedValue(null);
    renderPos();
    await waitFor(() => expect(screen.getByRole('button', { name: /Logo/ }).querySelector('[data-testid="payment-method-visual-default"]')).toBeTruthy());
  });
});
