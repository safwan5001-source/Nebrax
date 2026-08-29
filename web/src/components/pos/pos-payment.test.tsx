// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PosPayment } from './pos-payment';

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}));

const paymentMethods = [
  { id: 'cash', name: 'Cash', name_en: 'Cash', settlement_type: 'cash' as const, is_active: true, is_default: true },
];

describe('PosPayment', () => {
  afterEach(() => cleanup());
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

  it('يختار طريقة الدفع باللمس على البطاقة', () => {
    const methods = [
      ...paymentMethods,
      { id: 'bank', name: 'Bank', name_en: 'Bank', settlement_type: 'bank' as const, is_active: true, is_default: false },
    ];
    render(
      <PosPayment
        allowDeferredPayment={false}
        customerName="Walk-in"
        defaultPaymentMethodId="cash"
        error={null}
        items={[]}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
        paying={false}
        paymentMethods={methods}
        paymentMethodsLoadError={null}
        paymentMethodsLoading={false}
        totalMinor={10000}
      />,
    );

    fireEvent.click(screen.getByText('Bank'));
    const exact = screen.getByRole('button', { name: 'exact_amount' });
    fireEvent.click(exact);
    expect((screen.getByRole('textbox', { name: 'Bank' }) as HTMLInputElement).value).toBe('100.00');
  });

  it('لا يرسل التأكيد المكرر أثناء paying ويبقى الزر المعطّل خاملاً', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <PosPayment
        allowDeferredPayment
        checkoutPhase="submitting"
        customerName="Walk-in"
        defaultPaymentMethodId="cash"
        error={null}
        items={[]}
        onBack={vi.fn()}
        onConfirm={onConfirm}
        paying
        paymentMethods={paymentMethods}
        paymentMethodsLoadError={null}
        paymentMethodsLoading={false}
        totalMinor={10000}
      />,
    );

    const confirm = screen.getByTestId('pos-confirm-payment') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(confirm).toHaveTextContent('checkout_submitting');
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    rerender(
      <PosPayment
        allowDeferredPayment={false}
        checkoutPhase="idle"
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
    const disabledConfirm = screen.getByTestId('pos-confirm-payment') as HTMLButtonElement;
    expect(disabledConfirm.disabled).toBe(true);
    fireEvent.click(disabledConfirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('يمنع اللمس ولوحة المفاتيح من تجاوز قفل الإرسال ويعرض حالة الاسترداد', () => {
    const onConfirm = vi.fn();
    const onBack = vi.fn();
    render(
      <PosPayment
        allowDeferredPayment
        checkoutPhase="recovering"
        customerName="Walk-in"
        defaultPaymentMethodId="cash"
        error={null}
        items={[]}
        onBack={onBack}
        onConfirm={onConfirm}
        paying
        paymentMethods={paymentMethods}
        paymentMethodsLoadError={null}
        paymentMethodsLoading={false}
        totalMinor={10000}
      />,
    );

    const confirm = screen.getByTestId('pos-confirm-payment') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(confirm).toHaveTextContent('checkout_recovering');
    expect(screen.getByTestId('pos-checkout-recovering')).toBeTruthy();
    fireEvent.click(confirm);
    fireEvent.keyDown(confirm, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'back_to_cart' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });
});
