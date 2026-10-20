// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductExecutionPanel } from './product-execution-panel';
import type { Execution, ExecutionRow } from './product-execution';
import { isExecutionLocked, progressPercent } from './product-execution';

const { api, ApiErrorMock, toast } = vi.hoisted(() => {
  class ApiErrorMock extends Error {
    status: number;
    body: unknown;
    constructor(status: number, message: string, body: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }
  return { api: vi.fn(), ApiErrorMock, toast: { success: vi.fn(), error: vi.fn() } };
});

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/api', () => ({ api, ApiError: ApiErrorMock, fetchImageUrl: vi.fn(async () => null) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));

const row = (over: Partial<ExecutionRow> & Pick<ExecutionRow, 'row_id' | 'status'>): ExecutionRow => ({
  source_row: 2, operation: 'create', product_id: null, error_code: null, error_message: null, retryable: false, attempts: 1,
  changed_fields: [], deferred: [], display: { name: 'منتج', sku: 'SKU-1', barcode: null }, images: [], ...over,
});

function execution(over: Partial<Execution> = {}): Execution {
  return {
    id: 'exec-1', action_id: 'action-1', status: 'completed', started_at: null, finished_at: null, retry_count: 0,
    progress: { total: 3, pending: 0, success: 2, failed: 0, skipped: 1 },
    images: { total: 0, pending: 0, success: 0, failed: 0, skipped: 0, waiting_for_product: 0 },
    deferred: { unit_template: 'deferred' },
    rows: [
      row({ row_id: 'a', status: 'success', product_id: 'p-1', changed_fields: ['name', 'sale_price'], deferred: ['images'] }),
      row({ row_id: 'b', status: 'success', operation: 'update', product_id: 'p-2', source_row: 3 }),
      row({ row_id: 'c', status: 'skipped', operation: 'skip', source_row: 4 }),
    ],
    pagination: { page: 1, per_page: 50, total: 3, last_page: 1, status: null },
    permissions: { can_continue: false, can_retry: false, retryable_rows: 0, retryable_images: 0 },
    ...over,
  };
}

function setup(handler: (path: string, options?: { method?: string; body?: unknown }) => unknown) {
  api.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
    const result = handler(path, options);
    if (result instanceof Error) throw result;
    if (result === undefined) throw new ApiErrorMock(404, 'x', { error: { code: 'execution_not_found', message: 'none' } });
    return result;
  });
  const onStatus = vi.fn();
  render(<ProductExecutionPanel actionId="action-1" version={2} totals={{ create: 2, update: 1, skip: 1 }} onStatus={onStatus} />);
  return { onStatus };
}

const posts = () => api.mock.calls.filter(([, options]) => options?.method === 'POST');

beforeEach(() => {
  api.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  document.documentElement.lang = 'ar';
  vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000000' });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.documentElement.lang = ''; });

describe('pure helpers', () => {
  it('computes progress and lock states', () => {
    expect(progressPercent({ total: 4, pending: 1, success: 3, failed: 0, skipped: 0 })).toBe(75);
    expect(progressPercent({ total: 0, pending: 0, success: 0, failed: 0, skipped: 0 })).toBe(0);
    expect(isExecutionLocked('executing')).toBe(true);
    expect(isExecutionLocked('approved')).toBe(false);
    expect(isExecutionLocked(undefined)).toBe(false);
  });
});

describe('تنفيذ الاستيراد', () => {
  it('لا ينفّذ شيئاً تلقائياً ويعرض ما هو مؤجَّل ثم يبدأ بالضغط والتأكيد فقط', async () => {
    setup((path, options) => (options?.method === 'POST' ? { data: execution() } : undefined));
    const user = userEvent.setup();

    expect(await screen.findByText(/قوالب الوحدات لا تُطبَّق ولن تُعدّ ناجحة/)).toBeTruthy();
    expect(posts()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'تنفيذ الاستيراد' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('سيُنشأ 2 منتجاً ويُحدَّث 1'));
    const call = posts()[0];
    expect(call[0]).toBe('/ai-actions/action-1/executions?per_page=50');
    expect(call[1]).toMatchObject({ method: 'POST', body: { expected_version: 2 } });
    expect(call[1].headers['Idempotency-Key']).toMatch(/^ai-exec-/);
    expect(await screen.findByText(/اكتمل التنفيذ/)).toBeTruthy();
  });

  it('لا يرسل شيئاً إذا أُلغي التأكيد', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    setup(() => undefined);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'تنفيذ الاستيراد' }));
    expect(posts()).toHaveLength(0);
  });

  it('يمنع الضغط المتكرر: نداء واحد فقط ريثما يعمل الأول', async () => {
    let release: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => { release = resolve; });
    api.mockImplementation(async (_path: string, options?: { method?: string }) => {
      if (options?.method === 'POST') return pending;
      throw new ApiErrorMock(404, 'x', {});
    });
    render(<ProductExecutionPanel actionId="action-1" version={2} totals={{ create: 1, update: 0, skip: 0 }} onStatus={vi.fn()} />);
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'تنفيذ الاستيراد' });

    await user.click(button);
    await user.click(button);
    await waitFor(() => expect(posts()).toHaveLength(1));
    release({ data: execution() });
    expect(await screen.findByText(/اكتمل التنفيذ/)).toBeTruthy();
    expect(posts()).toHaveLength(1);
  });

  it('يقود الدفعات حتى الاكتمال ويعرض التقدم ونتيجة كل صف ورابط المنتج والمؤجَّل', async () => {
    const running = execution({ status: 'running', progress: { total: 3, pending: 2, success: 1, failed: 0, skipped: 0 }, rows: [row({ row_id: 'a', status: 'success', product_id: 'p-1', deferred: ['images'] })], permissions: { can_continue: true, can_retry: false, retryable_rows: 0, retryable_images: 0 } });
    const responses = [running, execution()];
    const { onStatus } = setup((_path, options) => (options?.method === 'POST' ? { data: responses.shift() } : undefined));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'تنفيذ الاستيراد' }));
    await screen.findByText(/اكتمل التنفيذ/);

    expect(posts()).toHaveLength(2);
    expect(posts()[0][1].headers['Idempotency-Key']).toMatch(/^ai-exec-/);
    expect(onStatus).toHaveBeenCalledWith('executing');
    expect(onStatus).toHaveBeenLastCalledWith('executed');
    expect(screen.getAllByRole('link', { name: 'فتح المنتج' })[0].getAttribute('href')).toBe('/products/p-1');
    expect(screen.getAllByText(/مؤجَّل: الصور/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/الحقول المطبّقة: الاسم، سعر البيع/).length).toBeGreaterThan(0);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });

  it('يعرض الفشل الجزئي والصفوف القابلة للإصلاح ويعيد محاولة الفاشل فقط', async () => {
    const partial = execution({
      status: 'partially_failed', progress: { total: 3, pending: 0, success: 2, failed: 1, skipped: 0 },
      rows: [row({ row_id: 'a', status: 'success', product_id: 'p-1' }), row({ row_id: 'b', status: 'failed', source_row: 3, error_code: 'internal_error', error_message: 'تعذر تنفيذ الصف بسبب خطأ غير متوقع؛ يمكن إعادة المحاولة.', retryable: true })],
      permissions: { can_continue: false, can_retry: true, retryable_rows: 1, retryable_images: 0 },
    });
    const retried = execution({ status: 'completed', retry_count: 1, progress: { total: 3, pending: 0, success: 3, failed: 0, skipped: 0 } });
    // The panel is opened on an execution that already exists (e.g. after a reload).
    setup((path, options) => {
      if (path.includes('/retry')) return { data: retried };
      if (path.includes('/executions/latest')) return { data: partial };
      return options?.method === 'POST' ? { data: partial } : undefined;
    });
    const user = userEvent.setup();

    expect(await screen.findByText(/نُفِّذ جزء من الصفوف أو الصور وفشل بعضها/)).toBeTruthy();
    expect(screen.getAllByText(/يمكن إعادة المحاولة/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'تنفيذ الاستيراد' })).toBeNull();

    await user.click(screen.getByRole('button', { name: /إعادة محاولة الصفوف الفاشلة/ }));
    await screen.findByText(/اكتمل التنفيذ/);
    expect(posts()).toHaveLength(1);
    expect(posts()[0][0]).toBe('/ai-actions/action-1/executions/exec-1/retry?per_page=50');
    expect(posts()[0][1].headers['Idempotency-Key']).toMatch(/^ai-retry-/);
  });

  it('لا يعرض زر إعادة المحاولة للأخطاء غير القابلة للإصلاح ويشرح السبب', async () => {
    const stuck = execution({
      status: 'partially_failed', progress: { total: 2, pending: 0, success: 1, failed: 1, skipped: 0 },
      rows: [row({ row_id: 'b', status: 'failed', error_code: 'target_changed', error_message: 'تغيّر المنتج منذ المعاينة؛ لم يُحدَّث.', retryable: false })],
      permissions: { can_continue: false, can_retry: false, retryable_rows: 0, retryable_images: 0 },
    });
    setup((path) => (path.includes('/executions/latest') ? { data: stuck } : undefined));

    expect((await screen.findAllByText(/تغيّر المنتج منذ المعاينة/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /إعادة محاولة/ })).toBeNull();
    expect(screen.getByText(/تحتاج إصلاحاً في البيانات/)).toBeTruthy();
  });

  it('يعرض رسالة خطأ الخادم ولا يدّعي نجاحاً', async () => {
    setup((_path, options) => (options?.method === 'POST' ? new ApiErrorMock(409, 'حدث خطأ', { error: { code: 'approval_stale', message: 'تغيّرت بيانات المنتجات منذ الموافقة.' } }) : undefined));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'تنفيذ الاستيراد' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('تغيّرت بيانات المنتجات منذ الموافقة.'));
    expect(screen.queryByText(/اكتمل التنفيذ/)).toBeNull();
    expect(screen.getByRole('button', { name: 'تنفيذ الاستيراد' })).toBeTruthy();
  });

  it('يدعم الإنجليزية عند ضبط لغة الصفحة', async () => {
    document.documentElement.lang = 'en';
    const partial = execution({ status: 'partially_failed', progress: { total: 3, pending: 0, success: 2, failed: 1, skipped: 0 }, rows: [row({ row_id: 'a', status: 'success', product_id: 'p-1', deferred: ['images'] })], permissions: { can_continue: false, can_retry: true, retryable_rows: 1, retryable_images: 0 } });
    setup((path) => (path.includes('/executions/latest') ? { data: partial } : undefined));

    expect(await screen.findByText(/Some rows or images were applied and some failed/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry failed rows/ })).toBeTruthy();
    expect(screen.getAllByText(/Deferred: Images/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Succeeded').length).toBeGreaterThan(0);
  });

  it('يعرض عدّاد الصور ونتيجة كل صورة مستقلة عن المنتج ويشرح إعادة المحاولة للصور وحدها', async () => {
    const failedImage = { key: 'k2', role: 'additional' as const, position: 1, source: { kind: 'archive' as const, label: 'SKU-1__2.jpg' }, image_id: 'img-2', status: 'failed' as const, error_code: 'image_storage_failed', error_message: 'تعذّر حفظ الصورة في التخزين؛ يمكن إعادة المحاولة.', retryable: true, attempts: 1, product_media_id: null };
    const okImage = { ...failedImage, key: 'k1', role: 'primary' as const, position: 0, source: { kind: 'archive' as const, label: 'SKU-1.png' }, image_id: 'img-1', status: 'success' as const, error_code: null, error_message: null, retryable: false, product_media_id: 'm-1' };
    const partial = execution({
      status: 'partially_failed', progress: { total: 1, pending: 0, success: 1, failed: 0, skipped: 0 },
      images: { total: 2, pending: 0, success: 1, failed: 1, skipped: 0, waiting_for_product: 0 },
      rows: [row({ row_id: 'a', status: 'success', product_id: 'p-1', images: [okImage, failedImage] })],
      permissions: { can_continue: false, can_retry: true, retryable_rows: 0, retryable_images: 1 },
    });
    setup((path) => (path.includes('/executions/latest') ? { data: partial } : undefined));

    expect(await screen.findByTestId('image-counts')).toBeTruthy();
    expect(screen.getByTestId('image-counts').textContent).toBe('الصور: أُرفقت 1 · فشلت 1 · لم تُرفق 0');
    // The table (desktop) and the card list (mobile) both render; either one carries the same results.
    const list = screen.getAllByTestId('execution-images')[0];
    expect(within(list).getByText('أُرفقت')).toBeTruthy();
    expect(within(list).getByText('فشلت')).toBeTruthy();
    expect(within(list).getByText(/يمكن إعادة المحاولة/)).toBeTruthy();
    // The product row itself stays a success; only the image failed.
    expect(screen.getAllByText('ناجح').length).toBeGreaterThan(0);
    expect(screen.getByText(/0 صفاً و1 صورة قابلة لإعادة المحاولة/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /إعادة محاولة الصفوف الفاشلة/ })).toBeTruthy();
  });
});
