// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PaymentMethodsPage from './page';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));

const translate = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key);
vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => async () => true }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error { status = 422; body: unknown = null; } }));

const baseMethod = {
  id: 'm1', name: 'Card', name_en: null, settlement_type: 'bank', cash_bank_account_id: 'bank-1', cash_bank_account_name: 'Main bank', instructions: null,
  available_online: false, is_active: true, is_default: false, payments_count: 0, pos_clearing_gateway_id: null, pos_terminal_required: false,
};
const banks = [{ id: 'bank-1', name: 'Main bank', type: 'bank', is_active: true }, { id: 'cash-1', name: 'Main cash', type: 'cash', is_active: true }];

function mock(method: Record<string, unknown>, gateways: unknown[] | 'fail') {
  api.mockImplementation(async (path: string) => {
    if (path === '/payment-methods') return { data: [method] };
    if (path === '/cash-bank-accounts') return { data: banks };
    if (path === '/payment-gateways') { if (gateways === 'fail') throw new Error('403'); return { data: gateways }; }
    return { data: method };
  });
}
const putBody = () => api.mock.calls.find(([, options]) => options?.method === 'PUT')?.[1].body;

async function openEdit() {
  const edit = await screen.findAllByRole('button', { name: 'edit' });
  fireEvent.click(edit[0]);
}

describe('طرق الدفع — إعدادات بطاقة POS (H6-01/H6-02)', () => {
  beforeEach(() => { api.mockReset(); });
  afterEach(() => cleanup());

  it('الطريقة البنكية تعرض المقاصة والاشتراط (مطفآن افتراضياً) وتحفظهما', async () => {
    mock(baseMethod, [{ id: 'g1', name: 'Gateway A', is_usable: true }, { id: 'g2', name: 'Gateway B', is_usable: false }]);
    render(<PaymentMethodsPage />);
    await openEdit();

    expect(screen.getByTestId('payment-method-pos-card')).toBeTruthy();
    const required = screen.getByLabelText('form.terminalRequired') as HTMLInputElement;
    expect(required.checked).toBe(false);
    const clearing = screen.getByLabelText('form.clearingGateway') as HTMLSelectElement;
    expect(clearing.value).toBe('');
    expect(Array.from(clearing.options).map((option) => option.textContent)).toEqual(['form.clearingNone', 'Gateway A']); // غير القابلة للاستعمال مخفية

    fireEvent.click(required);
    fireEvent.change(clearing, { target: { value: 'g1' } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(putBody()).toBeTruthy());
    expect(putBody()).toMatchObject({ settlement_type: 'bank', pos_terminal_required: true, pos_clearing_gateway_id: 'g1' });
  });

  it('تحويل الطريقة إلى نقدية يخفي القسم ويصفّر المقاصة والاشتراط في الحمولة', async () => {
    mock({ ...baseMethod, pos_terminal_required: true, pos_clearing_gateway_id: 'g1' }, [{ id: 'g1', name: 'Gateway A', is_usable: true }]);
    render(<PaymentMethodsPage />);
    await openEdit();
    fireEvent.change(screen.getByLabelText('form.settlementType'), { target: { value: 'cash' } });
    expect(screen.queryByTestId('payment-method-pos-card')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(putBody()).toBeTruthy());
    expect(putBody()).toMatchObject({ settlement_type: 'cash', pos_terminal_required: false, pos_clearing_gateway_id: null });
  });

  it('تعذّر قراءة البوابات (صلاحية) يخفي حقل المقاصة فقط ولا يمسح الربط القائم عند الحفظ', async () => {
    mock({ ...baseMethod, pos_clearing_gateway_id: 'g-existing' }, 'fail');
    render(<PaymentMethodsPage />);
    await openEdit();
    expect(screen.queryByLabelText('form.clearingGateway')).toBeNull();
    expect(screen.getByLabelText('form.terminalRequired')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(putBody()).toBeTruthy());
    expect(putBody()).toMatchObject({ pos_clearing_gateway_id: 'g-existing' });
  });
});
