// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AiProductImportReviewPage from './page';

const { api, toast } = vi.hoisted(() => ({ api: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/api', () => ({
  api,
  ApiError: class ApiError extends Error {
    status = 0;
    body: unknown = null;
  },
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));

const field = (value: string | null) => ({ value, origin: value === null ? 'missing' : 'extracted', confidence: value === null ? null : 100 });
const reviewRow = (id: string, source: number, sku: string, decision: string) => ({
  row_id: id, source_row: source, decision, violations: [], media: null,
  fields: { name: field(`منتج ${sku}`), sku: field(sku), sale_price: field('10'), type: field('good'), purchase_price: field(null) },
});

function mockServer(preview: unknown, costHidden = false) {
  const posts: { path: string; body: unknown }[] = [];
  api.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
    if (options?.method === 'POST') posts.push({ path, body: options.body });
    if (path === '/ai-actions' && options?.method === 'POST') return { data: { id: 'action-1', version: 1 } };
    if (path.endsWith('/files')) return { data: {} };
    if (path.endsWith('/review')) return { data: { action: { id: 'action-1', version: 1, status: 'created', cost_hidden: costHidden }, proposal: { rows: [reviewRow('r1', 2, 'A-1', 'needs_review'), reviewRow('r2', 3, 'A-2', 'create')] } } };
    if (path.endsWith('/review/versions')) return { data: { version: 2, status: 'editing', latest_version: { proposal: { rows: [reviewRow('r1', 2, 'A-1', 'update'), reviewRow('r2', 3, 'A-2', 'create')] } } } };
    if (path.includes('/previews')) return { data: preview };
    throw new Error(`unexpected ${options?.method ?? 'GET'} ${path}`);
  });
  return posts;
}

const preview = {
  id: 'preview-1', action_id: 'action-1', action_version: 2, status: 'active', invalidation_reason: null, preview_hash: 'cd'.repeat(32), approvable: true,
  generated_at: null, expires_at: '2026-10-20T10:30:00Z',
  totals: { rows: 2, create: 1, update: 1, skip: 0, blocked: 0, errors: 0, warnings: 0, has_cost_values: false },
  issues: [], rows: [], pagination: { page: 1, per_page: 50, total: 0, last_page: 1, operation: null }, approval: null,
  permissions: { can_view_cost: true, cost_hidden: false, can_approve: true },
};

async function uploadFile(container: HTMLElement) {
  const user = userEvent.setup();
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, new File(['sku,name\nA-1,x'], 'products.csv', { type: 'text/csv' }));
  await screen.findByText('١ · مراجعة البيانات');
  return user;
}

beforeEach(() => {
  api.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  vi.stubGlobal('crypto', { randomUUID: () => '11111111-1111-4111-8111-111111111111' });
});
afterEach(() => cleanup());

describe('استيراد المنتجات عبر مساعد أَوْج — المراجعة ثم المعاينة والموافقة', () => {
  it('يحفظ القرار المختار كإصدار جديد قبل إنشاء المعاينة النهائية', async () => {
    const posts = mockServer(preview);
    const { container } = render(<AiProductImportReviewPage />);
    const user = await uploadFile(container);

    await user.selectOptions(screen.getByLabelText('القرار-2'), 'update');
    expect(screen.getByText('تعديلات غير محفوظة')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /المتابعة إلى المعاينة النهائية/ }));

    expect(await screen.findByText('المعاينة النهائية قبل الاستيراد')).toBeTruthy();
    const save = posts.find((post) => post.path.endsWith('/review/versions'));
    expect(save?.body).toEqual({ expected_version: 1, edits: [{ row_id: 'r1', decision: 'update' }] });
    const previewCall = posts.find((post) => post.path.includes('/previews'));
    expect(previewCall?.body).toEqual({ expected_version: 2 });
    expect(posts.findIndex((post) => post === save)).toBeLessThan(posts.findIndex((post) => post === previewCall));
  });

  it('لا يرسل شيئاً إن لم تُعدَّل بيانات، وينتقل إلى المعاينة مباشرة', async () => {
    const posts = mockServer(preview);
    const { container } = render(<AiProductImportReviewPage />);
    const user = await uploadFile(container);

    await user.click(screen.getByRole('button', { name: /المتابعة إلى المعاينة النهائية/ }));
    await screen.findByText('المعاينة النهائية قبل الاستيراد');
    expect(posts.some((post) => post.path.endsWith('/review/versions'))).toBe(false);
    expect(posts.find((post) => post.path.includes('/previews'))?.body).toEqual({ expected_version: 1 });
  });

  it('يطبّق القرار الجماعي على الصفوف الظاهرة فقط', async () => {
    const posts = mockServer(preview);
    const { container } = render(<AiProductImportReviewPage />);
    const user = await uploadFile(container);

    await user.type(screen.getByLabelText('بحث'), 'A-2');
    await user.selectOptions(screen.getByLabelText('القرار الجماعي'), 'skip');
    await user.click(screen.getByRole('button', { name: 'طبّق القرار على الظاهر' }));
    await user.click(screen.getByRole('button', { name: 'حفظ إصدار المراجعة' }));

    await waitFor(() => expect(posts.some((post) => post.path.endsWith('/review/versions'))).toBe(true));
    expect(posts.find((post) => post.path.endsWith('/review/versions'))?.body).toEqual({ expected_version: 1, edits: [{ row_id: 'r2', decision: 'skip' }] });
  });

  it('يخفي حقل سعر الشراء وخيار تعديله الجماعي لمن لا يملك صلاحية التكلفة', async () => {
    mockServer(preview, true);
    const { container } = render(<AiProductImportReviewPage />);
    await uploadFile(container);

    expect(screen.getByText(/سعر الشراء محجوب عنك/)).toBeTruthy();
    expect(screen.queryByLabelText('سعر الشراء-2')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'سعر الشراء' })).toBeNull();
    expect(Array.from(screen.getByLabelText('حقل التعديل الجماعي').querySelectorAll('option')).map((option) => option.textContent)).not.toContain('سعر الشراء');
  });

  it('يعرض حقل سعر الشراء لمن يملك صلاحية التكلفة', async () => {
    mockServer(preview, false);
    const { container } = render(<AiProductImportReviewPage />);
    await uploadFile(container);

    expect(screen.queryByText(/سعر الشراء محجوب عنك/)).toBeNull();
    expect(screen.getByLabelText('سعر الشراء-2')).toBeTruthy();
  });

  it('يعرض الحالة الجاهزة بلا موافقة تلقائية وبلا أي تنفيذ', async () => {
    mockServer(preview);
    const { container } = render(<AiProductImportReviewPage />);
    const user = await uploadFile(container);
    await user.click(screen.getByRole('button', { name: /المتابعة إلى المعاينة النهائية/ }));

    const box = await screen.findByTestId('approval-box');
    expect((within(box).getByRole('button', { name: /الموافقة على المعاينة/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.mock.calls.some(([path]) => String(path).endsWith('/approvals'))).toBe(false);
    expect(screen.getByRole('link', { name: 'العودة' }).getAttribute('href')).toBe('/products');
  });
});
