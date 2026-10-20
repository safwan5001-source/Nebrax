// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductPreviewPanel } from './product-preview-panel';
import type { ProductPreview } from './product-preview';

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

vi.mock('@/lib/api', () => ({ api, ApiError: ApiErrorMock }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));

const HASH = 'ab'.repeat(32);

function previewFixture(overrides: Partial<ProductPreview> = {}): ProductPreview {
  return {
    id: 'preview-1',
    action_id: 'action-1',
    action_version: 2,
    status: 'active',
    invalidation_reason: null,
    preview_hash: HASH,
    approvable: true,
    generated_at: '2026-10-20T10:00:00Z',
    expires_at: '2026-10-20T10:30:00Z',
    totals: { rows: 3, create: 1, update: 1, skip: 1, blocked: 0, errors: 0, warnings: 1, has_cost_values: true },
    issues: [],
    rows: [
      {
        row_id: 'r1', source_row: 2, decision: 'create', display: { name: 'قهوة جديدة', sku: 'NEW-1', barcode: null },
        operation: 'create', skip_reason: null,
        match: { kind: 'none', value: null, target_product_id: null, target_version: null, target_name: null, target_sku: null },
        changes: [{ field: 'name', before: null, after: 'قهوة جديدة' }, { field: 'sale_price', before: null, after: 1050 }],
        prices: { sale_price: { before: null, after: 1050 }, purchase_price: { before: null, after: 500 }, tax_rate: { before: null, after: 15 } },
        images: { primary: 'https://img.example/a.jpg', additional: [], count: 1, will_apply: false, status: 'deferred', fetched: false },
        issues: [{ code: 'reference_unmanaged', field: 'category', severity: 'warning', message: '«التصنيف» بالقيمة «قهوة» غير موجود ولن يُنشأ تلقائياً.' }],
      },
      {
        row_id: 'r2', source_row: 3, decision: 'update', display: { name: 'قهوة قائمة', sku: 'EX-1', barcode: null },
        operation: 'update', skip_reason: null,
        match: { kind: 'sku', value: 'EX-1', target_product_id: 'p-1', target_version: 'v', target_name: 'قهوة قائمة', target_sku: 'EX-1' },
        changes: [{ field: 'sale_price', before: 1000, after: 1200 }, { field: 'description', before: null, after: 'وصف جديد' }],
        prices: { sale_price: { before: 1000, after: 1200 } },
        images: null, issues: [],
      },
      {
        row_id: 'r3', source_row: 4, decision: 'skip', display: { name: 'متخطّى', sku: null, barcode: null },
        operation: 'skip', skip_reason: 'user_skip',
        match: { kind: 'none', value: null, target_product_id: null, target_version: null, target_name: null, target_sku: null },
        changes: [], prices: null, images: null, issues: [],
      },
    ],
    pagination: { page: 1, per_page: 50, total: 3, last_page: 1, operation: null },
    approval: null,
    permissions: { can_view_cost: true, cost_hidden: false, can_approve: true },
    ...overrides,
  };
}

function mountApi(first: ProductPreview, extra?: (path: string, options?: { method?: string; body?: unknown }) => unknown) {
  api.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
    const custom = extra?.(path, options);
    if (custom !== undefined) return custom;
    if (path.includes('/previews?') && options?.method === 'POST') return { data: first };
    if (path.includes('/previews/')) return { data: first };
    throw new Error(`unexpected ${options?.method ?? 'GET'} ${path}`);
  });
}

function renderPanel(props: Partial<React.ComponentProps<typeof ProductPreviewPanel>> = {}) {
  const onEdit = vi.fn();
  const onStatus = vi.fn();
  render(<ProductPreviewPanel actionId="action-1" version={2} dirty={false} onEdit={onEdit} onStatus={onStatus} {...props} />);
  return { onEdit, onStatus };
}

beforeEach(() => {
  api.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000000' });
});
afterEach(() => cleanup());

describe('المعاينة النهائية والموافقة', () => {
  it('تنشئ المعاينة عند الفتح وتعرض الإنشاء والتحديث والتخطي والأسعار والصور', async () => {
    mountApi(previewFixture());
    const { onStatus } = renderPanel();

    expect(await screen.findByText('المعاينة النهائية قبل الاستيراد')).toBeTruthy();
    const post = api.mock.calls.find(([path]) => String(path).includes('/previews?'));
    expect(post?.[0]).toBe('/ai-actions/action-1/previews?per_page=50');
    expect(post?.[1]).toMatchObject({ method: 'POST', body: { expected_version: 2 } });
    expect(post?.[1].headers['Idempotency-Key']).toMatch(/^ai-preview-/);

    // الأسعار تُعرض بالريال من الهللات، والتحديث يُظهر قيمتي قبل وبعد.
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/10\.50/);
    expect(text).toMatch(/12\.00/);
    expect(text).toMatch(/10\.00/);
    expect(screen.getAllByText('وصف جديد').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/مؤجَّلة — لا تُنزَّل ولا تُرفق/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('تخطٍّ بقرارك').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/غير موجود ولن يُنشأ تلقائياً/).length).toBeGreaterThan(0);
    expect(onStatus).toHaveBeenCalledWith('ready_for_approval');
    expect(screen.getByText(/لا تُنشأ منتجات ولا تُحدَّث/)).toBeTruthy();
  });

  it('تمنع الموافقة قبل التأكيد الصريح ثم ترسل المعاينة والبصمة والإصدار', async () => {
    const approved = previewFixture({
      approval: { id: 'ap-1', preview_id: 'preview-1', action_version: 2, preview_hash: HASH, approved_by: 'u1', approved_at: null, expires_at: '2026-10-20T11:00:00Z', revoked_at: null, revocation_reason: null, status: 'active' },
    });
    let approvals = 0;
    mountApi(previewFixture(), (path, options) => {
      if (path.endsWith('/approvals')) { approvals += 1; return { data: {} }; }
      if (path.includes('/previews/preview-1') && approvals > 0) return { data: approved };
      return undefined;
    });
    const { onStatus } = renderPanel();
    const user = userEvent.setup();

    const button = await screen.findByRole('button', { name: /الموافقة على المعاينة/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('checkbox'));
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await user.click(button);

    await waitFor(() => expect(approvals).toBe(1));
    const call = api.mock.calls.find(([path]) => String(path).endsWith('/approvals'));
    expect(call?.[1]).toMatchObject({ method: 'POST', body: { expected_version: 2, preview_id: 'preview-1', preview_hash: HASH, acknowledged: true } });
    expect(call?.[1].headers['Idempotency-Key']).toMatch(/^ai-approve-/);
    expect(await screen.findByText(/وُوفق على هذه المعاينة بعينها/)).toBeTruthy();
    expect(screen.getByText(/لم يُنشأ أو يُحدَّث أي منتج/)).toBeTruthy();
    expect(onStatus).toHaveBeenLastCalledWith('approved');
    // The approval opens the execution box but never runs it by itself.
    expect(await screen.findByTestId('execution-box')).toBeTruthy();
    expect(api.mock.calls.some(([path, options]) => String(path).includes('/executions') && options?.method === 'POST')).toBe(false);
    expect(screen.getByRole('button', { name: 'تنفيذ الاستيراد' })).toBeTruthy();
  });

  it('لا تسمح بالموافقة عند وجود أخطاء تمنع التنفيذ وتشرح السبب', async () => {
    mountApi(previewFixture({
      approvable: false,
      totals: { rows: 3, create: 0, update: 1, skip: 1, blocked: 1, errors: 1, warnings: 0, has_cost_values: false },
      rows: [{ ...previewFixture().rows[0], operation: 'blocked', issues: [{ code: 'required_missing', field: 'name', severity: 'error', message: '«الاسم» مطلوب لإنشاء منتج جديد.' }] }],
    }));
    renderPanel();

    expect((await screen.findAllByText('«الاسم» مطلوب لإنشاء منتج جديد.')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/حقل مطلوب ناقص/).length).toBeGreaterThan(0);
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /الموافقة على المعاينة/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/أخطاء تمنع التنفيذ؛ صحّحها/)).toBeTruthy();
  });

  it('تشرح نقص السعر والضريبة والوحدة والمعرّف كأخطاء تمنع الموافقة ولا تعرض قيماً افتراضية', async () => {
    const missing = (code: string, field: string | null, message: string) => ({ code, field, severity: 'error' as const, message });
    const blocked = {
      ...previewFixture().rows[0], operation: 'blocked' as const, changes: [{ field: 'name', before: null, after: 'بلا بيانات' }], prices: { sale_price: { before: null, after: 1000 } }, images: null,
      issues: [
        missing('purchase_price_missing', 'purchase_price', '«سعر الشراء» مطلوب لإنشاء منتج جديد؛ لا تُستخدم قيمة افتراضية صامتة.'),
        missing('tax_rate_missing', 'tax_rate', '«نسبة الضريبة» مطلوب لإنشاء منتج جديد؛ لا تُستخدم قيمة افتراضية صامتة.'),
        missing('unit_missing', 'unit', '«الوحدة» مطلوب لإنشاء منتج جديد؛ لا تُستخدم قيمة افتراضية صامتة.'),
        missing('trusted_identifier_missing', null, 'يلزم رمز صنف (SKU) أو باركود لإنشاء منتج جديد؛ لن يُولَّد واحد تلقائياً.'),
      ],
    };
    mountApi(previewFixture({ approvable: false, totals: { rows: 1, create: 0, update: 0, skip: 0, blocked: 1, errors: 4, warnings: 0, has_cost_values: false }, rows: [blocked] }));
    renderPanel();

    for (const title of ['سعر الشراء مطلوب للإنشاء', 'نسبة الضريبة مطلوبة للإنشاء', 'الوحدة مطلوبة للإنشاء', 'يلزم SKU أو باركود']) {
      expect((await screen.findAllByText(new RegExp(title))).length).toBeGreaterThan(0);
    }
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /الموافقة على المعاينة/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).not.toMatch(/15%/);
  });

  it('تمنع الموافقة مع تعديلات غير محفوظة', async () => {
    mountApi(previewFixture());
    renderPanel({ dirty: true });
    const user = userEvent.setup();

    await screen.findByRole('button', { name: /الموافقة على المعاينة/ });
    await user.click(screen.getByRole('checkbox'));
    expect((screen.getByRole('button', { name: /الموافقة على المعاينة/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(/تعديلات غير محفوظة/).length).toBeGreaterThan(0);
  });

  it('تعرض معاينة قديمة عند رفض الخادم وتتيح إنشاء معاينة جديدة', async () => {
    let previews = 0;
    mountApi(previewFixture(), (path, options) => {
      if (path.endsWith('/approvals')) throw new ApiErrorMock(409, 'حدث خطأ', { error: { code: 'preview_stale', message: 'تغيّرت بيانات المنتجات منذ المعاينة؛ أنشئ معاينة جديدة وراجعها.' } });
      if (path.includes('/previews?') && options?.method === 'POST') { previews += 1; return { data: previewFixture() }; }
      return undefined;
    });
    renderPanel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /الموافقة على المعاينة/ }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/تغيّرت بيانات المنتجات منذ المعاينة/)).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith('تغيّرت بيانات المنتجات منذ المعاينة؛ أنشئ معاينة جديدة وراجعها.');
    await user.click(within(alert).getByRole('button', { name: /إنشاء معاينة جديدة/ }));
    await waitFor(() => expect(previews).toBe(2));
  });

  it('تخفي أسعار الشراء المحجوبة وتمنع الموافقة بلا صلاحية', async () => {
    const hidden = previewFixture({ permissions: { can_view_cost: false, cost_hidden: true, can_approve: false } });
    hidden.rows[0].prices = { sale_price: { before: null, after: 1050 }, purchase_price: { before: null, after: null, redacted: true } };
    mountApi(hidden);
    renderPanel();

    expect(await screen.findByText(/أسعار الشراء محجوبة عنك/)).toBeTruthy();
    expect(screen.getAllByText('محجوب').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/5\.00/);
    expect((screen.getByRole('button', { name: /الموافقة على المعاينة/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('تعرض معاينة مُبطلة أو منتهية على أنها غير قابلة للموافقة', async () => {
    mountApi(previewFixture({ status: 'expired' }));
    renderPanel();

    expect(await screen.findAllByText(/منتهية الصلاحية/)).toBeTruthy();
    expect(screen.getByText(/انتهت صلاحية المعاينة؛ أنشئ معاينة جديدة/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /الموافقة على المعاينة/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('تعيد التصفية بنوع العملية قراءة المعاينة نفسها من الخادم', async () => {
    mountApi(previewFixture());
    renderPanel();
    const user = userEvent.setup();

    await screen.findByText('المعاينة النهائية قبل الاستيراد');
    await user.click(screen.getByRole('tab', { name: /موقوف/ }));
    await waitFor(() => expect(api.mock.calls.some(([path]) => String(path).includes('/previews/preview-1?') && String(path).includes('operation=blocked'))).toBe(true));
  });
});
