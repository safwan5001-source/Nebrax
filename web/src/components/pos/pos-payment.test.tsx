// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PosPayment } from './pos-payment';

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}));

const paymentMethods = [
  { id: 'cash', name: 'Cash', name_en: 'Cash', settlement_type: 'cash' as const, is_active: true, is_default: true },
];

describe('PosPayment', () => {
  it('يبقي إدخال مبلغ الدفع العشري مستقلاً عن لوحة أرقام تحرير السلة', () => {
    const onConfirm = vi.fn();
    render(
      <PosPayment
        allowDeferredPayment={false}
        customerName="Walk-in"
        defaultPaymentMethodId="cash"
        error={null}
        items={[]}
        onBack={vi.fn()}
        onConfirm={onConfirm}
        paying={false}
        paymentMethods={paymentMethods}
        paymentMethodsLoadError={null}
        paymentMethodsLoading={false}
        totalMinor={10000}
      />,
    );

    const amount = screen.getByRole('textbox', { name: 'Cash' }) as HTMLInputElement;
    expect(amount.inputMode).toBe('decimal');
    fireEvent.change(amount, { target: { value: '100.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'confirm_payment' }));

    expect(onConfirm).toHaveBeenCalledWith([{ payment_method_id: 'cash', amount: 10000 }]);
  });
});
