// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepairBanner, RepairEntry } from './product-repair-ui';
import { fieldEditable, repairHref, type RepairInfo, type RepairPlan } from './product-repair';

const { api, push, toast, confirmFn, ApiErrorMock } = vi.hoisted(() => {
  class ApiErrorMock extends Error {
    status: number;
    body: unknown;
    constructor(status: number, message: string, body: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }
  return { api: vi.fn(), push: vi.fn(), toast: { success: vi.fn(), error: vi.fn() }, confirmFn: vi.fn(), ApiErrorMock };
});

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/api', () => ({ api, ApiError: ApiErrorMock }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => confirmFn }));

const candidate = (over: Partial<RepairPlan['rows'][number]> = {}): RepairPlan['rows'][number] => ({
  row_id: 'c', source_row: 4, kind: 'row', operation: 'create', display: { name: 'قهوة', sku: 'B-3', barcode: null },
  failure: { code: 'conflict_existing_product', message: 'يوجد الآن منتج بالرمز أو الباركود نفسه؛ لم يُنشأ المنتج.', retryable: false },
  affected_fields: ['sku', 'barcode'], scope: 'fields', ...over,
});
const plan = (over: Partial<RepairPlan> = {}): RepairPlan => ({ rows: [candidate()], retry_pending: 0, open_repair: null, reason: null, ...over });

beforeEach(() => {
  api.mockReset();
  push.mockReset();
  toast.error.mockReset();
  confirmFn.mockReset();
  confirmFn.mockResolvedValue(true);
  document.documentElement.lang = 'ar';
  vi.stubGlobal('crypto', { randomUUID: () => '33333333-3333-4333-8333-333333333333' });
});
afterEach(() => {
  cleanup();
  document.documentElement.lang = '';
  vi.unstubAllGlobals();
});

describe('مدخل الإصلاح', () => {
  it('يقترح الإصلاح للصفوف التي لا تعالجها إعادة المحاولة، وينشئه بعد تأكيد صريح بمفتاح idempotency ثم ينتقل إليه', async () => {
    api.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (options?.method === 'POST') return { data: { action_id: 'repair-1' } };
      return { data: plan() };
    });
    const user = userEvent.setup();
    render(<RepairEntry actionId="a-1" executionId="e-1" refreshKey="0" />);

    expect(await screen.findByText('1 صفاً يحتاج إصلاحاً — لا تعالجه «إعادة المحاولة».')).toBeTruthy();
    expect(api.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false); // nothing is created by looking
    await user.click(screen.getByRole('button', { name: 'إصلاح وإعادة المحاولة' }));

    expect(confirmFn).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('1 صفاً فاشلاً فقط') }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/products/ai-import?action=repair-1'));
    const post = api.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(post?.[0]).toBe('/ai-actions/a-1/executions/e-1/repairs');
    expect(post?.[1].headers['Idempotency-Key']).toBe('ai-repair-33333333-3333-4333-8333-333333333333');
  });

  it('لا ينشئ شيئاً إن رفض المستخدم التأكيد، ويعرض رسالة الخادم عند الفشل', async () => {
    api.mockImplementation(async (_path: string, options?: { method?: string }) => {
      if (options?.method === 'POST') throw new ApiErrorMock(403, 'x', { error: { code: 'cost_permission_required', message: 'لا تملك صلاحية عرض التكلفة.' } });
      return { data: plan() };
    });
    const user = userEvent.setup();
    render(<RepairEntry actionId="a-1" executionId="e-1" refreshKey="0" />);
    const button = await screen.findByRole('button', { name: 'إصلاح وإعادة المحاولة' });

    confirmFn.mockResolvedValueOnce(false);
    await user.click(button);
    expect(api.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);

    await user.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('لا تملك صلاحية عرض التكلفة.'));
    expect(push).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'إصلاح وإعادة المحاولة' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('يمنع الإنشاء المزدوج عند نقرتين متتاليتين', async () => {
    let release: (value: unknown) => void = () => undefined;
    api.mockImplementation((_path: string, options?: { method?: string }) => options?.method === 'POST'
      ? new Promise((resolve) => { release = resolve; })
      : Promise.resolve({ data: plan() }));
    const user = userEvent.setup();
    render(<RepairEntry actionId="a-1" executionId="e-1" refreshKey="0" />);
    const button = await screen.findByRole('button', { name: 'إصلاح وإعادة المحاولة' });

    await user.click(button);
    await user.click(button);

    await waitFor(() => expect(api.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1));
    release({ data: { action_id: 'repair-1' } });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });

  it('يتابع الإصلاح المفتوح بدل إنشاء ثانٍ، ويحيل الفاشل القابل لإعادة المحاولة إلى «إعادة المحاولة»', async () => {
    api.mockResolvedValue({ data: plan({ rows: [], open_repair: { action_id: 'repair-9', status: 'editing' } }) });
    const { unmount } = render(<RepairEntry actionId="a-1" executionId="e-1" refreshKey="0" />);
    const link = await screen.findByRole('link', { name: /متابعة الإصلاح المفتوح/ });
    expect(link.getAttribute('href')).toBe('/products/ai-import?action=repair-9');
    expect(screen.queryByRole('button', { name: 'إصلاح وإعادة المحاولة' })).toBeNull();
    unmount();

    api.mockResolvedValue({ data: plan({ rows: [], retry_pending: 2 }) });
    render(<RepairEntry actionId="a-1" executionId="e-1" refreshKey="0" />);
    expect(await screen.findByTestId('repair-retry-first')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('لا يعرض شيئاً إن لم يوجد ما يُصلَح، ويدعم الإنجليزية', async () => {
    api.mockResolvedValue({ data: plan({ rows: [] }) });
    const { container, unmount } = render(<RepairEntry actionId="a-1" executionId="e-1" refreshKey="0" />);
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    unmount();

    document.documentElement.lang = 'en';
    api.mockResolvedValue({ data: plan() });
    render(<RepairEntry actionId="a-1" executionId="e-1" refreshKey="0" />);
    expect(await screen.findByRole('button', { name: 'Repair and retry' })).toBeTruthy();
  });
});

describe('لافتة الإصلاح', () => {
  const info: RepairInfo = {
    repair_id: 'r-1', action_id: 'repair-1', origin: { action_id: 'a-1', execution_id: 'e-1', status: 'partially_failed' },
    rows: [
      { row_id: 'c', source_row: 4, kind: 'row', origin_operation: 'create', display: { name: 'قهوة', sku: 'B-3', barcode: null }, failure: { code: 'conflict_existing_product', message: 'يوجد الآن منتج بالرمز نفسه.', retryable: false }, affected_fields: ['sku', 'barcode'], scope: 'fields' },
      { row_id: 't', source_row: 5, kind: 'row', origin_operation: 'create', display: { name: 'شاي', sku: 'T-1', barcode: null }, failure: { code: 'internal_error', message: 'خطأ عابر.', retryable: true }, affected_fields: [], scope: 'none' },
    ],
  };

  it('تعرض سبب فشل كل صف والحقول القابلة للتعديل ورابط التنفيذ الأصلي', () => {
    render(<RepairBanner repair={info} />);
    expect(screen.getByText(/يوجد الآن منتج بالرمز نفسه/)).toBeTruthy();
    expect(screen.getByText(/الحقول القابلة للتعديل: رمز الصنف، الباركود/)).toBeTruthy();
    expect(screen.getByText(/لا حقول للتعديل/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'فتح التنفيذ الأصلي' }).getAttribute('href')).toBe('/products/ai-import?action=a-1');
  });

  it('تحدد الحقول القابلة للتعديل بحسب الصف ولا تقيّد خارج الإصلاح', () => {
    expect(fieldEditable(info, 'c', 'sku')).toBe(true);
    expect(fieldEditable(info, 'c', 'name')).toBe(false);
    expect(fieldEditable(info, 't', 'sku')).toBe(false);
    expect(fieldEditable(info, 'missing', 'sku')).toBe(false);
    expect(fieldEditable(null, 'c', 'name')).toBe(true);
    expect(repairHref('a b')).toBe('/products/ai-import?action=a%20b');
  });
});
