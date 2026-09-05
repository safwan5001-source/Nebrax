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
    expect(confirm.textContent ?? '').toContain('checkout_submitting');
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
    expect(confirm.textContent ?? '').toContain('checkout_recovering');
    expect(screen.getByTestId('pos-checkout-recovering')).toBeTruthy();
    fireEvent.click(confirm);
    fireEvent.keyDown(confirm, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'back_to_cart' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('يزيل صناديق الأيقونات الملوّنة ويستخدم دلالة مالية للمدفوع والمتبقي والباقي', () => {
    const { rerender } = render(
      <PosPayment
        allowDeferredPayment={false}
        customerName="Walk-in"
        defaultPaymentMethodId="cash"
        error={null}
        items={[]}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
        paying={false}
        paymentMethods={paymentMethods}
        paymentMethodsLoadError={null}
        paymentMethodsLoading={false}
        totalMinor={10000}
      />,
    );

    expect(document.querySelector('.grid.h-8.w-8')).toBeNull();
    expect(document.querySelector('.grid.h-5.w-5')).toBeNull();
    expect(screen.getByTestId('pos-payment-paid').querySelector('.num')?.className).toMatch(/text-text/);
    expect(screen.getByTestId('pos-payment-remaining').querySelector('.num')?.className).toMatch(/text-negative/);
    expect(screen.getByTestId('pos-payment-change').querySelector('.num')?.className).toMatch(/text-text/);
    expect(screen.getByTestId('pos-confirm-payment').className).toMatch(/min-h-14/);
    expect(screen.getByTestId('pos-confirm-payment').className).toMatch(/bg-primary/);

    fireEvent.click(screen.getByRole('button', { name: 'exact_amount' }));
    expect(screen.getByTestId('pos-payment-paid').querySelector('.num')?.className).toMatch(/text-positive/);
    expect(screen.getByTestId('pos-payment-remaining').querySelector('.num')?.className).toMatch(/text-text/);
    expect(screen.getByTestId('pos-payment-remaining').querySelector('.num')?.className).not.toMatch(/text-negative/);

    const amount = screen.getByRole('textbox', { name: 'Cash' });
    fireEvent.change(amount, { target: { value: '150.00' } });
    expect(screen.getByTestId('pos-payment-change').querySelector('.num')?.className).toMatch(/text-positive/);

    rerender(
      <PosPayment
        allowDeferredPayment={false}
        checkoutPhase="idle"
        customerName="Walk-in"
        defaultPaymentMethodId="cash"
        error="card declined"
        items={[]}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
        paying={false}
        paymentMethods={paymentMethods}
        paymentMethodsLoadError={null}
        paymentMethodsLoading={false}
        totalMinor={10000}
      />,
    );
    expect(screen.getByRole('alert').className).toMatch(/text-negative/);
  });

  it('PR-5: بنكي زائد عن المتبقي يُعطّل التأكيد ويعرض رسالة تحقّق دون إرسال', () => {
    const onConfirm = vi.fn();
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
        onConfirm={onConfirm}
        paying={false}
        paymentMethods={methods}
        paymentMethodsLoadError={null}
        paymentMethodsLoading={false}
        totalMinor={10000}
      />,
    );

    const bankAmount = screen.getByRole('textbox', { name: 'Bank' });
    fireEvent.change(bankAmount, { target: { value: '120.00' } });

    expect(screen.getByTestId('pos-payment-method-invalid').textContent).toContain('payment_bank_amount_exceeds_remaining');
    const confirm = screen.getByTestId('pos-confirm-payment') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('PR-5: تقسيم نقد + بنكي يطابق الإجمالي بلا متبقٍ ولا فكة، ويُرسَل غير النقدي أولاً', () => {
    const onConfirm = vi.fn();
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
        onConfirm={onConfirm}
        paying={false}
        paymentMethods={methods}
        paymentMethodsLoadError={null}
        paymentMethodsLoading={false}
        totalMinor={10000}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Cash' }), { target: { value: '40.00' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Bank' }), { target: { value: '60.00' } });

    expect(screen.getByTestId('pos-payment-paid').querySelector('.num')?.textContent).toContain('100.00');
    expect(screen.getByTestId('pos-payment-remaining').querySelector('.num')?.textContent).toContain('0.00');
    expect(screen.getByTestId('pos-payment-change').querySelector('.num')?.textContent).toContain('0.00');

    fireEvent.click(screen.getByTestId('pos-confirm-payment'));
    expect(onConfirm).toHaveBeenCalledWith([
      { payment_method_id: 'bank', amount: 6000 },
      { payment_method_id: 'cash', amount: 4000 },
    ]);
  });

  it('PR-5: نقد يغطي الإجمالي كاملاً — الفكة تُحسب من صافي النقد فقط لا من مجموع كل ما كُتب', () => {
    const onConfirm = vi.fn();
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
        onConfirm={onConfirm}
        paying={false}
        paymentMethods={methods}
        paymentMethodsLoadError={null}
        paymentMethodsLoading={false}
        totalMinor={10000}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Bank' }), { target: { value: '50.00' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Cash' }), { target: { value: '120.00' } });

    // غير النقدي يُطبَّق أولاً (50 من أصل 100 متبقية)، فيبقى 50 يُطبَّق عليها
    // النقد، والفائض (120-50=70) فكةٌ لا سداد.
    expect(screen.getByTestId('pos-payment-change').querySelector('.num')?.textContent).toContain('70.00');
    expect(screen.getByTestId('pos-payment-remaining').querySelector('.num')?.textContent).toContain('0.00');

    fireEvent.click(screen.getByTestId('pos-confirm-payment'));
    expect(onConfirm).toHaveBeenCalledWith([
      { payment_method_id: 'bank', amount: 5000 },
      { payment_method_id: 'cash', amount: 12000 },
    ]);
  });

  it('PR-5: الدفع الآجل المسموح مع متبقٍ يعرض ملاحظة الذمة المتبقية', () => {
    render(
      <PosPayment
        allowDeferredPayment
        customerName="Walk-in"
        defaultPaymentMethodId="cash"
        error={null}
        items={[]}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
        paying={false}
        paymentMethods={paymentMethods}
        paymentMethodsLoadError={null}
        paymentMethodsLoading={false}
        totalMinor={10000}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Cash' }), { target: { value: '40.00' } });
    expect(screen.getByTestId('pos-deferred-remaining-note')).toBeTruthy();
    expect((screen.getByTestId('pos-confirm-payment') as HTMLButtonElement).disabled).toBe(false);
  });

  it('PR-5: الدفع الآجل الممنوع مع متبقٍ يُبقي التأكيد معطّلاً', () => {
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
        paymentMethods={paymentMethods}
        paymentMethodsLoadError={null}
        paymentMethodsLoading={false}
        totalMinor={10000}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Cash' }), { target: { value: '40.00' } });
    expect((screen.getByTestId('pos-confirm-payment') as HTMLButtonElement).disabled).toBe(true);
  });

  it('PR-5: «المبلغ بالضبط» يملأ ما تبقّى فعلاً بعد وسيلة أخرى مُدخَلة، لا الإجمالي كاملاً', () => {
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

    fireEvent.change(screen.getByRole('textbox', { name: 'Bank' }), { target: { value: '40.00' } });
    fireEvent.click(screen.getByText('Cash'));
    fireEvent.click(screen.getByRole('button', { name: 'exact_amount' }));
    expect((screen.getByRole('textbox', { name: 'Cash' }) as HTMLInputElement).value).toBe('60.00');
  });

  it('PR-5: لوحة الأرقام على الشاشة تُستخدم لمبلغ الدفع عند تفعيل الإعداد فقط', () => {
    const labels = {
      apply: 'apply', backspace: 'backspace', cancel: 'cancel', clear: 'clear',
      decimal: 'decimal', digit: (d: string) => `digit_${d}`, value: 'value',
    };
    const { rerender } = render(
      <PosPayment
        allowDeferredPayment={false}
        customerName="Walk-in"
        defaultPaymentMethodId="cash"
        error={null}
        items={[]}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
        paying={false}
        paymentMethods={paymentMethods}
        paymentMethodsLoadError={null}
        paymentMethodsLoading={false}
        totalMinor={10000}
        showOnscreenNumericKeypad={false}
        numericEditorLabels={labels}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Cash' })).toBeTruthy();

    rerender(
      <PosPayment
        allowDeferredPayment={false}
        customerName="Walk-in"
        defaultPaymentMethodId="cash"
        error={null}
        items={[]}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
        paying={false}
        paymentMethods={paymentMethods}
        paymentMethodsLoadError={null}
        paymentMethodsLoading={false}
        totalMinor={10000}
        showOnscreenNumericKeypad
        numericEditorLabels={labels}
      />,
    );
    expect(screen.queryByRole('textbox', { name: 'Cash' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cash' })).toBeTruthy();
  });
});
