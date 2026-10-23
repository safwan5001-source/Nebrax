// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PosTerminalSessionAlert } from './pos-terminal-session-alert';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));

const translate = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key);
vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error { status = 422; body: unknown = null; } }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => async () => true }));

function req(id: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id, pos_session_id: 's1', pos_payment_terminal_id: 't1', payment_method_id: 'm1', amount: '75.00', currency: 'SAR', status,
    approval_code: 'SECRET-CODE', rrn: 'SECRET-RRN', last4: '9999', failure_code: null, void_attempts: 2, last_void_error: 'void_failed',
    consumed_payment_id: null, consumed_invoice_id: null, resolution_note: null, approved_at: null, consumed_at: null, voided_at: null,
    resolved_at: null, created_at: '2026-10-23T00:00:00Z', idempotent_replay: false, ...extra,
  };
}

function mock(requests: unknown[]) {
  api.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (path === '/pos-payment-terminals') return { data: [{ id: 't1', name: 'Terminal A', code: null, provider: 'fake', simulated: true, pos_device_id: null, is_active: true, created_at: null }], meta: { providers: [] } };
    if (path === '/pos-sessions/s1/terminal-requests') return { data: requests };
    if (options?.method === 'POST') return { data: req('x', 'voided') };
    throw new Error(`unexpected ${path}`);
  });
}

describe('تنبيه جلسة POS لعمليات جهاز الدفع', () => {
  beforeEach(() => { api.mockReset(); });
  afterEach(() => cleanup());

  it('لافتة الانتباه تظهر لعمليات التعويض فقط، ولا تزعج بطلب جارٍ طبيعي', async () => {
    mock([req('a', 'sent'), req('b', 'approved')]);
    const { container } = render(<PosTerminalSessionAlert sessionId="s1" mode="attention" />);
    await waitFor(() => expect(api).toHaveBeenCalledWith('/pos-sessions/s1/terminal-requests'));
    expect(container.querySelector('[data-testid="pos-terminal-session-alert"]')).toBeNull();
  });

  it('حوار الإقفال يسرد كل ما يمنع الإقفال مع الإجراءات المسموحة فقط', async () => {
    mock([req('a', 'sent'), req('b', 'approved'), req('c', 'compensation_required'), req('d', 'voided')]);
    render(<PosTerminalSessionAlert sessionId="s1" mode="blocking" />);
    const rows = await screen.findAllByTestId('pos-terminal-alert-row');
    expect(rows).toHaveLength(3); // المُلغى لا يمنع
    expect(screen.getAllByText('cancel_request')).toHaveLength(1);
    expect(screen.getAllByText('void_approval')).toHaveLength(1);
    expect(screen.getAllByText('retry_void')).toHaveLength(1);
    expect(screen.getAllByText('copy_for_manager')).toHaveLength(1);
    // بلا تجاوز يدوي ولا بيانات حساسة.
    expect(screen.queryByText(/resolve|override/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/SECRET-CODE|SECRET-RRN|9999/);
  });

  it('إعادة محاولة الإلغاء تستدعي void ثم تُبلغ الأب ليعيد قراءة الموانع', async () => {
    mock([req('c', 'compensation_required')]);
    const onChanged = vi.fn();
    render(<PosTerminalSessionAlert sessionId="s1" mode="attention" onChanged={onChanged} />);
    fireEvent.click(await screen.findByTestId('pos-terminal-alert-retry-void'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/pos/terminal-requests/c/void', { method: 'POST' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('معطَّل: لا طلبات شبكة', () => {
    mock([]);
    render(<PosTerminalSessionAlert sessionId="s1" mode="blocking" enabled={false} />);
    expect(api).not.toHaveBeenCalled();
  });
});
