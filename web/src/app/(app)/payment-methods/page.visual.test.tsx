// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PaymentMethodsPage from './page';

const { api, fetchImageUrl } = vi.hoisted(() => ({ api: vi.fn(), fetchImageUrl: vi.fn() }));

const translate = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key);
vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => async () => true }));
vi.mock('@/lib/api', () => ({ api, fetchImageUrl, ApiError: class ApiError extends Error { status = 422; body: unknown = null; } }));

const base = {
  id: 'm1', name: 'Wallet', name_en: null, settlement_type: 'cash', cash_bank_account_id: 'cash-1', cash_bank_account_name: 'Main cash', instructions: null,
  available_online: false, is_active: true, is_default: false, payments_count: 0, pos_clearing_gateway_id: null, pos_terminal_required: false,
};
const banks = [{ id: 'cash-1', name: 'Main cash', type: 'cash', is_active: true }];

function mock(method: Record<string, unknown>) {
  api.mockImplementation(async (path: string) => {
    if (path === '/payment-methods') return { data: [method] };
    if (path === '/cash-bank-accounts') return { data: banks };
    if (path === '/payment-gateways') return { data: [] };
    return { data: { ...method, id: 'm1' } };
  });
}
const call = (match: (path: string, options?: { method?: string }) => boolean) => api.mock.calls.find(([path, options]) => match(path, options));
const openEdit = async () => fireEvent.click((await screen.findAllByRole('button', { name: 'edit' }))[0]);

describe('طرق الدفع — تخصيص الأيقونة والصورة', () => {
  beforeEach(() => { api.mockReset(); fetchImageUrl.mockReset(); fetchImageUrl.mockResolvedValue('blob:preview'); (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:file'; (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {}; });
  afterEach(() => cleanup());

  it('طريقة قديمة: وضع افتراضي، والحفظ لا يغيّر شيئاً بصرياً', async () => {
    mock(base);
    render(<PaymentMethodsPage />);
    await openEdit();
    expect(screen.getByRole('radio', { name: 'modeDefault' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(call((_, o) => o?.method === 'PUT')).toBeTruthy());
    expect(call((_, o) => o?.method === 'PUT')?.[1].body).toMatchObject({ visual_mode: 'default' });
    expect(call((p) => p.endsWith('/logo'))).toBeUndefined();
  });

  it('اختيار أيقونة ولون مستقل ثم الحفظ يرسل الأيقونة واللون', async () => {
    mock(base);
    render(<PaymentMethodsPage />);
    await openEdit();
    fireEvent.click(screen.getByRole('radio', { name: 'modeIcon' }));
    fireEvent.click(screen.getByRole('button', { name: 'icons.wallet' }));
    fireEvent.change(screen.getByLabelText('color'), { target: { value: '#12ab34' } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(call((_, o) => o?.method === 'PUT')).toBeTruthy());
    expect(call((_, o) => o?.method === 'PUT')?.[1].body).toMatchObject({ visual_mode: 'icon', icon_key: 'wallet', icon_color: '#12AB34' });
  });

  it('إعادة اللون للافتراضي ترسل null وتبقي الأيقونة', async () => {
    mock({ ...base, visual_mode: 'icon', icon_key: 'coins', icon_color: '#112233' });
    render(<PaymentMethodsPage />);
    await openEdit();
    expect((screen.getByLabelText('color') as HTMLInputElement).value).toBe('#112233');
    fireEvent.click(screen.getByRole('button', { name: 'resetColor' }));
    expect((screen.getByLabelText('color') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(call((_, o) => o?.method === 'PUT')).toBeTruthy());
    expect(call((_, o) => o?.method === 'PUT')?.[1].body).toMatchObject({ visual_mode: 'icon', icon_key: 'coins', icon_color: null });
  });

  it('لون غير صالح يمنع الحفظ برسالة ولا يستدعي الخادم', async () => {
    mock(base);
    render(<PaymentMethodsPage />);
    await openEdit();
    fireEvent.click(screen.getByRole('radio', { name: 'modeIcon' }));
    fireEvent.click(screen.getByRole('button', { name: 'icons.wallet' }));
    fireEvent.change(screen.getByLabelText('color'), { target: { value: '#12' } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    expect(await screen.findAllByText('visual.errorColor')).not.toHaveLength(0);
    expect(call((_, o) => o?.method === 'PUT')).toBeUndefined();
  });

  it('أيقونة بلا اختيار تُرفض قبل الإرسال', async () => {
    mock(base);
    render(<PaymentMethodsPage />);
    await openEdit();
    fireEvent.click(screen.getByRole('radio', { name: 'modeIcon' }));
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    expect(await screen.findByText('visual.errorIconRequired')).toBeTruthy();
    expect(call((_, o) => o?.method === 'PUT')).toBeUndefined();
  });

  it('رفع صورة: يُحفظ النموذج بلا حقول بصرية ثم يُرفع الملف بـFormData', async () => {
    mock(base);
    render(<PaymentMethodsPage />);
    await openEdit();
    fireEvent.click(screen.getByRole('radio', { name: 'modeImage' }));
    const file = new File([new Uint8Array(10)], 'logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('uploadInput'), { target: { files: [file] } });
    expect(screen.getByTestId('payment-method-logo-preview').querySelector('img')?.getAttribute('src')).toBe('blob:file');
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(call((p) => p.endsWith('/logo'))).toBeTruthy());
    const put = call((_, o) => o?.method === 'PUT')?.[1].body;
    expect(put).not.toHaveProperty('visual_mode');
    const upload = call((p) => p.endsWith('/logo'))?.[1];
    expect(upload.method).toBe('POST');
    expect(upload.body).toBeInstanceOf(FormData);
    expect((upload.body as FormData).get('logo')).toBe(file);
  });

  it('ملف غير مدعوم (SVG) أو كبير يُرفض في الواجهة ولا يُنتقى', async () => {
    mock(base);
    render(<PaymentMethodsPage />);
    await openEdit();
    fireEvent.click(screen.getByRole('radio', { name: 'modeImage' }));
    const input = screen.getByLabelText('uploadInput');
    fireEvent.change(input, { target: { files: [new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })] } });
    expect((await screen.findByRole('alert')).textContent).toBe('errorType');
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(1024 * 1024 + 1)], 'big.png', { type: 'image/png' })] } });
    expect((await screen.findByRole('alert')).textContent).toBe('errorSize');
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    expect(await screen.findByText('visual.errorImageRequired')).toBeTruthy();
  });

  it('طريقة بشعار محفوظ: تُعرض المعاينة، والإزالة ترجعها للافتراضي', async () => {
    mock({ ...base, visual_mode: 'image', has_logo: true, updated_at: 'v9' });
    render(<PaymentMethodsPage />);
    await openEdit();
    await waitFor(() => expect(screen.getByTestId('payment-method-logo-preview').querySelector('img')?.getAttribute('src')).toBe('blob:preview'));
    fireEvent.click(screen.getByRole('button', { name: 'remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(call((_, o) => o?.method === 'PUT')).toBeTruthy());
    expect(call((_, o) => o?.method === 'PUT')?.[1].body).toMatchObject({ visual_mode: 'default' });
  });

  it('التفعيل/التعطيل من القائمة لا يرسل أي حقل بصري (لا يمسح الاختيار)', async () => {
    mock({ ...base, visual_mode: 'icon', icon_key: 'coins', icon_color: '#112233' });
    render(<PaymentMethodsPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'deactivate' }))[0]);
    await waitFor(() => expect(call((_, o) => o?.method === 'PUT')).toBeTruthy());
    const body = call((_, o) => o?.method === 'PUT')?.[1].body;
    for (const key of ['visual_mode', 'icon_key', 'icon_color']) expect(body).not.toHaveProperty(key);
  });
});
