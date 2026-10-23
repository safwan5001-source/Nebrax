// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiActionsDisabledNotice, AiActionsEnablementCard } from './enablement-card';
import type { Enablement } from './enablement';

const { api, toast, ApiErrorMock } = vi.hoisted(() => {
  class ApiErrorMock extends Error {
    status: number;
    body: unknown;
    constructor(status: number, message: string, body: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }
  return { api: vi.fn(), toast: { success: vi.fn(), error: vi.fn() }, ApiErrorMock };
});

vi.mock('@/lib/api', () => ({ api, ApiError: ApiErrorMock }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));

const state = (over: Partial<Enablement> = {}): Enablement => ({
  platform_enabled: true, tenant_enabled: false, effective: false, reason: 'tenant_not_enabled', ...over,
});

beforeEach(() => {
  api.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  document.documentElement.lang = 'en';
});
afterEach(cleanup);

describe('AiActionsEnablementCard', () => {
  it('shows the server state and saves the new value from the server response', async () => {
    api.mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
      if (options?.method === 'PUT') return Promise.resolve({ data: state({ tenant_enabled: true, effective: true, reason: 'enabled' }) });
      return Promise.resolve({ data: state() });
    });
    const user = userEvent.setup();
    render(<AiActionsEnablementCard canManage />);

    const toggle = await screen.findByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await user.click(toggle);

    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true'));
    expect(api).toHaveBeenCalledWith('/ai-actions-settings', { method: 'PUT', body: { enabled: true } });
    expect(toast.success).toHaveBeenCalled();
  });

  it('cannot turn it on while the platform is off, but can turn it off', async () => {
    api.mockResolvedValue({ data: state({ platform_enabled: false, reason: 'platform_disabled' }) });
    render(<AiActionsEnablementCard canManage />);
    expect((await screen.findByRole('switch') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('platform');
    cleanup();

    api.mockResolvedValue({ data: state({ platform_enabled: false, tenant_enabled: true, reason: 'platform_disabled' }) });
    render(<AiActionsEnablementCard canManage />);
    expect((await screen.findByRole('switch') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows no switch without the manage permission', async () => {
    api.mockResolvedValue({ data: state() });
    render(<AiActionsEnablementCard canManage={false} />);
    await screen.findByText('Not enabled');
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('re-reads the server state after a refused save and reports the server message', async () => {
    let puts = 0;
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (options?.method === 'PUT') {
        puts += 1;
        return Promise.reject(new ApiErrorMock(409, 'x', { error: { code: 'platform_disabled', message: 'refused by server' } }));
      }
      return Promise.resolve({ data: state() });
    });
    const user = userEvent.setup();
    render(<AiActionsEnablementCard canManage />);
    await user.click(await screen.findByRole('switch'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('refused by server'));
    expect(puts).toBe(1);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  });
});

describe('AiActionsDisabledNotice', () => {
  it('explains why it is off and links managers to the settings; non-managers are told to ask the owner', async () => {
    api.mockResolvedValue({ data: state() });
    render(<AiActionsDisabledNotice canManage />);
    expect((await screen.findByTestId('ai-actions-disabled-notice')).textContent).toContain('not enabled for this organization');
    expect(screen.getByRole('link').getAttribute('href')).toBe('/intelligence/settings');
    cleanup();

    render(<AiActionsDisabledNotice canManage={false} />);
    expect((await screen.findByTestId('ai-actions-disabled-notice')).textContent).toContain('Ask your organization owner');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders nothing when effective or when the status cannot be read', async () => {
    api.mockResolvedValue({ data: state({ tenant_enabled: true, effective: true, reason: 'enabled' }) });
    const { container } = render(<AiActionsDisabledNotice canManage />);
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    cleanup();

    api.mockRejectedValue(new Error('403'));
    const second = render(<AiActionsDisabledNotice canManage />);
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(second.container.textContent).toBe('');
  });
});

describe('AiActionsEnablementCard — owner approval of execution (IMP-X-01c)', () => {
  const enabled = (over: Partial<Enablement> = {}): Enablement => state({ tenant_enabled: true, effective: true, reason: 'enabled', execution_approved: false, controls_enforced: false, access: null, ...over });

  it('the owner sees the approval switch and saves what the server returns', async () => {
    api.mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
      if (options?.method === 'PUT') return Promise.resolve({ data: enabled({ execution_approved: true }) });
      return Promise.resolve({ data: enabled() });
    });
    const user = userEvent.setup();
    render(<AiActionsEnablementCard canManage isOwner />);

    const toggle = await screen.findByRole('switch', { name: /approve AI Actions execution/i });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await user.click(toggle);

    await waitFor(() => expect(screen.getByRole('switch', { name: /approve AI Actions execution/i }).getAttribute('aria-checked')).toBe('true'));
    expect(api).toHaveBeenCalledWith('/ai-actions-settings/execution-approval', { method: 'PUT', body: { approved: true } });
  });

  it('a non-owner sees the state but no switch to change it', async () => {
    api.mockResolvedValue({ data: enabled({ execution_approved: true }) });
    render(<AiActionsEnablementCard canManage />);

    expect(await screen.findByTestId('ai-actions-execution-approval')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: /approve AI Actions execution/i })).toBeNull();
    expect(screen.getByTestId('ai-actions-execution-approval').textContent).toContain('Only the organization owner');
  });

  it('the approval section stays hidden until the organization itself has accepted AI Actions', async () => {
    api.mockResolvedValue({ data: state() });
    render(<AiActionsEnablementCard canManage isOwner />);
    await screen.findByRole('switch');
    expect(screen.queryByTestId('ai-actions-execution-approval')).toBeNull();
  });

  it('explains why execution is unavailable only when the operator gate is open, with tenant-safe wording', async () => {
    const access = { 'product_import.v1': { preview: { allowed: true, reason: 'allowed' }, review: { allowed: true, reason: 'allowed' }, execution: { allowed: false, reason: 'platform_unavailable' } } };
    api.mockResolvedValue({ data: enabled({ controls_enforced: true, access }) });
    render(<AiActionsEnablementCard canManage isOwner />);

    expect((await screen.findByTestId('ai-actions-execution-reason')).textContent).toContain('not available from the platform administration');
    cleanup();
    api.mockResolvedValue({ data: enabled({ controls_enforced: false, access: null }) });
    render(<AiActionsEnablementCard canManage isOwner />);
    await screen.findByTestId('ai-actions-execution-approval');
    expect(screen.queryByTestId('ai-actions-execution-reason')).toBeNull();
  });

  it('a failed approval shows the server message and reloads the real state', async () => {
    let first = true;
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (options?.method === 'PUT') return Promise.reject(new ApiErrorMock(403, 'x', { error: { code: 'owner_required', message: 'موافقة التنفيذ لمالك المؤسسة وحده.' } }));
      first = false;
      return Promise.resolve({ data: enabled() });
    });
    const user = userEvent.setup();
    render(<AiActionsEnablementCard canManage isOwner />);
    await user.click(await screen.findByRole('switch', { name: /approve AI Actions execution/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(first).toBe(false);
    expect(screen.getByRole('switch', { name: /approve AI Actions execution/i }).getAttribute('aria-checked')).toBe('false');
  });
});
