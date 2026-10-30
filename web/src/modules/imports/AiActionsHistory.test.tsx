// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { AiActionsHistory } from './AiActionsHistory';

const { api, translate } = vi.hoisted(() => ({
  api: vi.fn(),
  translate: Object.assign(
    (key: string, values: Record<string, unknown> = {}) => (Object.keys(values).length ? `${key}:${Object.values(values).join(',')}` : key),
    { raw: () => ({}), rich: (key: string) => key }
  ),
}));

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'ar' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/api', async () => ({ ...(await vi.importActual<typeof import('@/lib/api')>('@/lib/api')), api }));

const item = (patch: Record<string, unknown> = {}) => ({
  id: 'a1', type: 'product_import.v1', status: 'executed', version: 1, created_by: 'u1', created_by_name: 'سارة',
  summary: { row_count: 12, error_count: 0, needs_review_count: 1 },
  execution: { id: 'e1', status: 'completed', retry_count: 0, started_at: '2026-10-30T10:00:00Z', finished_at: '2026-10-30T10:01:00Z', rows: { success: 11, failed: 1 } },
  created_at: '2026-10-30T09:00:00Z', updated_at: '2026-10-30T10:01:00Z', ...patch,
});
const page = (data: unknown[], meta = { current_page: 1, last_page: 1, per_page: 10, total: data.length }) => ({ data, meta });
const lastPath = () => String(api.mock.calls.at(-1)?.[0]);

// الأقواس لازمة: `beforeEach` يعيد دالة تنظيف في vitest، فإعادة الـmock نفسه تُنفَّذ كتنظيف بعد الاختبار.
beforeEach(() => {
  api.mockReset();
});
afterEach(cleanup);

describe('AiActionsHistory (IMP-H8-S4b)', () => {
  it('renders summary rows with the execution result and a link only for a known type', async () => {
    api.mockResolvedValue(page([item(), item({ id: 'a2', type: 'future.v1', status: 'created', execution: null, created_by_name: null })]));
    render(<AiActionsHistory />);
    await screen.findByText('سارة');

    const first = screen.getByText('سارة').closest('tr') as HTMLElement;
    expect(within(first).getByText('success: 11 · failed: 1')).toBeTruthy();
    expect(within(first).getByText('ai_status_executed')).toBeTruthy();
    expect((within(first).getByRole('link', { name: 'ai_open' }) as HTMLAnchorElement).getAttribute('href')).toBe('/products/ai-import?action=a1');
    const second = screen.getByText('future.v1').closest('tr') as HTMLElement;
    expect(within(second).queryByRole('link')).toBeNull();
    expect(lastPath()).toBe('/ai-actions?page=1&per_page=10');
  });

  it('sends the filters to the server and returns to page 1 when one changes', async () => {
    api.mockResolvedValue(page([item()], { current_page: 1, last_page: 3, per_page: 10, total: 25 }));
    const user = userEvent.setup();
    render(<AiActionsHistory />);
    await screen.findByText('سارة');

    await user.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(lastPath()).toContain('page=2'));
    await user.selectOptions(screen.getByLabelText('filter_status'), 'failed');
    await waitFor(() => expect(lastPath()).toBe('/ai-actions?page=1&per_page=10&status=failed'));
    await user.click(screen.getByLabelText('ai_history_mine'));
    await waitFor(() => expect(lastPath()).toBe('/ai-actions?page=1&per_page=10&status=failed&mine=1'));
  });

  it('shows "unavailable" without filters or a retry when the server answers 403', async () => {
    api.mockRejectedValue(new ApiError(403, 'no', null));
    render(<AiActionsHistory />);
    await screen.findByText('ai_history_unavailable');
    expect(screen.queryByLabelText('filter_status')).toBeNull();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('shows the empty states and a retryable error otherwise', async () => {
    api.mockResolvedValueOnce(page([]));
    const user = userEvent.setup();
    render(<AiActionsHistory />);
    await screen.findByText('ai_history_empty');
    expect(screen.getByText('ai_history_empty_hint')).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('filter_status'), 'failed');
    api.mockResolvedValueOnce(page([]));
    await screen.findByText('history_empty_filtered');

    cleanup();
    api.mockReset();
    api.mockRejectedValueOnce(new ApiError(500, 'boom', null)).mockResolvedValueOnce(page([item()]));
    render(<AiActionsHistory />);
    await screen.findByText('boom');
    await user.click(screen.getByRole('button', { name: /retry|ai_retry|try/i }));
    await screen.findByText('سارة');
  });

  it('is read-only: no write request is ever sent', async () => {
    api.mockResolvedValue(page([item()]));
    render(<AiActionsHistory />);
    await screen.findByText('سارة');
    for (const call of api.mock.calls) expect((call[1] as { method?: string } | undefined)?.method ?? 'GET').toBe('GET');
  });

  it('ignores a slow retry that was started before the filters changed (latest request wins)', async () => {
    const user = userEvent.setup();
    let resolveRetry: (value: unknown) => void = () => {};
    api.mockRejectedValueOnce(new ApiError(500, 'boom', null));
    render(<AiActionsHistory />);
    await screen.findByText('boom');

    // إعادة المحاولة معلّقة…
    api.mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }));
    await user.click(screen.getByRole('button', { name: /retry|ai_retry|try/i }));
    // …ثم يتغيّر المرشّح وتصل نتيجته أولاً.
    api.mockResolvedValueOnce(page([item({ id: 'f1', created_by_name: 'مفلتر' })]));
    await user.selectOptions(screen.getByLabelText('filter_status'), 'failed');
    await screen.findByText('مفلتر');

    // الرد المتأخر للمحاولة القديمة (بلا مرشّح) لا يكتب فوق النتيجة المفلترة.
    resolveRetry(page([item({ id: 'old', created_by_name: 'قديم' })]));
    await waitFor(() => expect(screen.queryByText('قديم')).toBeNull());
    expect(screen.getByText('مفلتر')).toBeTruthy();
  });
});
