import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiActionControlsCard } from './ai-action-controls-card';

const { platformApi, translate } = vi.hoisted(() => {
  const translate = Object.assign(
    (key: string, values?: Record<string, unknown>) => (values ? `${key}|${Object.values(values).join('|')}` : key),
    { has: () => true },
  );
  return { platformApi: vi.fn(), translate };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('@/lib/platform-api', () => ({ platformApi }));

const state = (enabled: boolean) => ({ enabled, version: enabled ? 1 : 0 });
const platformPayload = (overrides: Record<string, unknown> = {}) => ({
  data: {
    env_floor: { use: true, execution: false },
    master: { use: state(true), execution: state(false) },
    types: [{ action_type: 'product_import.v1', state: { use: state(false), execution: state(false) } }],
    events: [{ action_type: '*', capability: 'use', version: 1, previous_enabled: false, new_enabled: true, reason: 'تشغيل تجريبي', platform_administrator_id: 'a', occurred_at: null }],
    ...overrides,
  },
});
const tenantPayload = () => ({
  data: {
    tenant_id: 't-1',
    grants: [{ action_type: 'product_import.v1', capability: 'use', enabled: true, version: 1 }],
    effective: { 'product_import.v1': { preview: { allowed: true, reason: 'allowed' }, review: { allowed: true, reason: 'allowed' }, execution: { allowed: false, reason: 'execution_platform_off' } } },
    events: [],
  },
});

const writes = () => platformApi.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === 'PUT');

describe('AiActionControlsCard', () => {
  beforeEach(() => {
    platformApi.mockReset();
  });
  afterEach(() => cleanup());

  it('platform view shows the read-only environment floor, the master row, each type and the audit trail', async () => {
    platformApi.mockResolvedValue(platformPayload());
    render(<AiActionControlsCard />);

    expect(await screen.findByText('product_import.v1')).toBeTruthy();
    expect(platformApi).toHaveBeenCalledWith('/platform/ai-action-controls');
    expect(screen.getByText(/capability\.execution: floorOff/)).toBeTruthy();
    expect(screen.getByText(/capability\.use: floorOn/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'toggleLabel|master|capability.use' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'toggleLabel|product_import.v1|capability.use' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText(/تشغيل تجريبي/)).toBeTruthy();
    // لا تحرير للأرضية البيئية: لا زر لها.
    expect(screen.queryByRole('button', { name: /envFloor/ })).toBeNull();
  });

  it('a change needs a reason, sends exactly the typed change, then reloads', async () => {
    platformApi.mockResolvedValue(platformPayload());
    render(<AiActionControlsCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'toggleLabel|product_import.v1|capability.use' }));

    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'confirm' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('reason'), { target: { value: 'ab' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('reason'), { target: { value: '  توفير النوع للتجربة  ' } });
    expect(confirm.disabled).toBe(false);
    expect(writes()).toHaveLength(0);

    fireEvent.click(confirm);

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual(['/platform/ai-action-controls', { method: 'PUT', body: { action_type: 'product_import.v1', capability: 'use', enabled: true, reason: 'توفير النوع للتجربة' } }]);
    await waitFor(() => expect(platformApi.mock.calls.filter(([, init]) => !init).length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText('saved')).toBeTruthy();
  });

  it('cancelling the dialog sends nothing', async () => {
    platformApi.mockResolvedValue(platformPayload());
    render(<AiActionControlsCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'toggleLabel|master|capability.execution' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes()).toHaveLength(0);
  });

  it('a failed write shows the server message and does not pretend success', async () => {
    const { ApiError } = await import('@/lib/api');
    platformApi.mockImplementation(async (_path: string, init?: { method?: string }) => {
      if (init?.method === 'PUT') throw new ApiError(422, 'سبب غير صالح', {});
      return platformPayload();
    });
    render(<AiActionControlsCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'toggleLabel|product_import.v1|capability.use' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('reason'), { target: { value: 'سبب كافٍ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'confirm' }));

    expect((await screen.findByRole('alert')).textContent).toContain('سبب غير صالح');
    expect(screen.queryByText('saved')).toBeNull();
  });

  it('tenant view uses the tenant route, shows grants and the effective reason per capability', async () => {
    platformApi.mockResolvedValue(tenantPayload());
    render(<AiActionControlsCard tenantId="t-1" />);

    expect(await screen.findByText('execution_platform_off'.replace('execution_platform_off', 'reasons.execution_platform_off'))).toBeTruthy();
    expect(platformApi).toHaveBeenCalledWith('/platform/tenants/t-1/ai-action-controls');
    expect(screen.getByRole('button', { name: 'toggleLabel|product_import.v1|capability.use' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'toggleLabel|product_import.v1|capability.execution' }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'toggleLabel|product_import.v1|capability.execution' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('reason'), { target: { value: 'منحة تنفيذ للمؤسسة' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'confirm' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual(['/platform/tenants/t-1/ai-action-controls', { method: 'PUT', body: { action_type: 'product_import.v1', capability: 'execution', enabled: true, reason: 'منحة تنفيذ للمؤسسة' } }]);
  });

  it('an unexpected response shape is an explicit load failure with a retry, never a broken screen', async () => {
    platformApi.mockResolvedValueOnce({ data: { nope: true } }).mockResolvedValue(platformPayload());
    render(<AiActionControlsCard />);

    expect((await screen.findByRole('alert')).textContent).toContain('loadFailed');
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(await screen.findByText('product_import.v1')).toBeTruthy();
  });
});
