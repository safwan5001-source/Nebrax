// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InventoryOpeningDetailPage from './page';

const { api, translate, toastSuccess, push } = vi.hoisted(() => ({
  api: vi.fn(),
  toastSuccess: vi.fn(),
  push: vi.fn(),
  translate: Object.assign(
    (key: string, values: Record<string, unknown> = {}) =>
      Object.keys(values).length ? `${key}:${Object.values(values).join(',')}` : key,
    { raw: () => ({}), rich: (key: string) => key }
  ),
}));

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'ar' }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'doc-1' }),
  useRouter: () => ({ push }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/lib/api', () => ({
  api,
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn(), success: toastSuccess, error: vi.fn() }),
}));
vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) =>
      typeof name === 'symbol' || name === 'then' || name === '__esModule'
        ? Reflect.get(target, name)
        : iconStub,
    has: () => true,
  });
});

const draft = {
  id: 'doc-1',
  number: 'OPN-2026-00001',
  opening_date: '2026-01-01',
  status: 'draft' as const,
  notes: null,
  source_filename: 'openings.csv',
  allow_zero_cost: false,
  total_quantity: 120,
  total_value: '2220.00',
  journal_entry_id: null,
  posted_at: null,
  lines: [
    {
      id: 'line-1', position: 1, product_id: 'p-1', product_name: 'قهوة عربية', product_sku: 'SKU-1001',
      warehouse_id: 'w-1', warehouse_name: 'المخزن الرئيسي', branch_id: null,
      quantity: 120, unit_cost: '18.50', total_cost: '2220.00', notes: null,
    },
  ],
};

const posted = { ...draft, status: 'posted' as const, journal_entry_id: 'entry-1', posted_at: '2026-01-01T00:00:00Z' };

beforeEach(() => {
  api.mockReset();
  toastSuccess.mockReset();
  push.mockReset();
  api.mockImplementation((path: string) => {
    if (path === '/inventory-openings/doc-1') return Promise.resolve({ data: draft });
    return Promise.resolve({ data: posted });
  });
});

afterEach(cleanup);

describe('صفحة الرصيد الافتتاحي', () => {
  it('تعرض ملخّص المسودة وسطورها بالريال', async () => {
    render(<InventoryOpeningDetailPage />);

    await waitFor(() => expect(screen.getByText('OPN-2026-00001')).toBeTruthy());
    expect(screen.getByText('draft')).toBeTruthy();
    // الجدول العريض وسجلّ الجوال يُعرضان معاً في jsdom (الإخفاء بـCSS فقط).
    expect(screen.getAllByText('قهوة عربية').length).toBeGreaterThan(0);
    // القيمة تُعرض بالريال — لا هللات، ولا «ريال» ولا SAR ولا الرمز القديم.
    expect(screen.getAllByText(/2,220\.00/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/SAR|ريال|﷼/)).toBeNull();
  });

  /** الموافقة قرارٌ محفوظ على المستند، فتُعرض للمراجعة لا تُخمَّن. */
  it('تعرض موافقة «تكلفة صفر» المحفوظة على المستند بحالتيها', async () => {
    render(<InventoryOpeningDetailPage />);

    await waitFor(() => expect(screen.getByText('allow_zero_cost')).toBeTruthy());
    expect(screen.getByText('zero_cost_off')).toBeTruthy();
    expect(screen.queryByText('zero_cost_on')).toBeNull();

    cleanup();
    api.mockImplementation(() => Promise.resolve({ data: { ...draft, allow_zero_cost: true } }));
    render(<InventoryOpeningDetailPage />);

    await waitFor(() => expect(screen.getByText('zero_cost_on')).toBeTruthy());
    expect(screen.queryByText('zero_cost_off')).toBeNull();
  });

  it('ترحّل المستند وتعرض حالته غير القابلة للتعديل بعدها', async () => {
    const user = userEvent.setup();
    render(<InventoryOpeningDetailPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'post_action' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'post_action' }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('posted_success:OPN-2026-00001')
    );
    expect(api).toHaveBeenCalledWith('/inventory-openings/doc-1/post', { method: 'POST' });

    // بعد الترحيل: لا زرّ ترحيل ولا حذف، والحالة معلنة صراحةً.
    expect(screen.queryByRole('button', { name: 'post_action' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'delete_draft' })).toBeNull();
    expect(screen.getByText('posted_immutable')).toBeTruthy();
  });

  /** النقر المزدوج على «ترحيل» كان سيرسل طلبين لمستندٍ واحد. */
  it('لا ترسل إلا طلب ترحيل واحد مهما تكرّر النقر', async () => {
    // وعدٌ معلَّق يمثّل طلباً لم يعد بعد — وهو بالضبط الفاصل الذي كان يُطلق
    // فيه النقر الثاني طلباً ثانياً.
    let resolvePost: (value: unknown) => void = () => {};
    api.mockImplementation((path: string) => {
      if (path === '/inventory-openings/doc-1') return Promise.resolve({ data: draft });
      return new Promise((resolve) => {
        resolvePost = resolve;
      });
    });

    const user = userEvent.setup();
    render(<InventoryOpeningDetailPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'post_action' })).toBeTruthy());
    const button = screen.getByRole('button', { name: 'post_action' });

    await user.click(button);
    await user.click(button);
    await user.click(button);

    const postCalls = api.mock.calls.filter(([path]) => path === '/inventory-openings/doc-1/post');
    expect(postCalls).toHaveLength(1);

    resolvePost({ data: posted });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it('تعرض خطأ الخادم كما هو بدل ابتلاعه', async () => {
    const { ApiError } = await import('@/lib/api');
    api.mockImplementation((path: string) => {
      if (path === '/inventory-openings/doc-1') return Promise.resolve({ data: draft });
      return Promise.reject(new ApiError(422, 'هذه الأصناف لديها حركة مخزون سابقة', {}));
    });

    const user = userEvent.setup();
    render(<InventoryOpeningDetailPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'post_action' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'post_action' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('حركة مخزون سابقة');
    expect(toastSuccess).not.toHaveBeenCalled();
    // والزرّ عاد قابلاً للضغط بعد الفشل.
    expect(screen.getByRole('button', { name: 'post_action' }).hasAttribute('disabled')).toBe(false);
  });

  it('تعرض المستند المرحَّل بلا أزرار تعديل منذ التحميل', async () => {
    api.mockImplementation(() => Promise.resolve({ data: posted }));

    render(<InventoryOpeningDetailPage />);

    await waitFor(() => expect(screen.getByText('posted')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'post_action' })).toBeNull();
    expect(screen.getByText('view_entry')).toBeTruthy();
  });

  it('لا تعرض نصاً عربياً مكتوباً في الشيفرة داخل واجهة مترجَمة', async () => {
    const { container } = render(<InventoryOpeningDetailPage />);
    await waitFor(() => expect(screen.getByText('OPN-2026-00001')).toBeTruthy());

    // بيانات العيّنة عربية عمداً، فالفحص على التسميات والأزرار وحدها.
    const chrome = [...container.querySelectorAll('button, th, dt, h1')].map((node) => node.textContent ?? '');
    expect(chrome.some((text) => /[؀-ۿ]/.test(text))).toBe(false);
  });
});
