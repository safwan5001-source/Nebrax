/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeliveryHubWorkspace } from './delivery-hub-workspace';
import type { DeliveryHubOrderView } from '@/lib/delivery-hub';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'ar',
}));

afterEach(cleanup);

const order: DeliveryHubOrderView = {
  id: 'order-1',
  state: 'received',
  branch_id: 'branch-a',
  branch_name: 'الفرع الأول',
  delivery_platform_profile_id: 'profile-1',
  platform_key: 'jahez',
  platform_name: 'جاهز',
  platform_name_en: 'Jahez',
  provider_order_id: 'P-1',
  external_order_reference: 'REF-1',
  idempotency_key: null,
  provider_status: 'provider-said-ready',
  created_at: '2026-10-03T10:00:00Z',
  updated_at: '2026-10-03T10:05:00Z',
};

function renderWorkspace(overrides: Partial<React.ComponentProps<typeof DeliveryHubWorkspace>> = {}) {
  const onAction = vi.fn();
  render(
    <div dir="rtl">
      <DeliveryHubWorkspace
        orders={[order]}
        branches={[{ id: 'branch-a', name: 'الفرع الأول' }, { id: 'branch-b', name: 'الفرع الثاني' }]}
        platforms={[{ id: 'profile-1', platform_key: 'jahez', name: 'جاهز', name_en: 'Jahez' }]}
        state="received"
        platformId=""
        branchId=""
        canOperate
        canSeeUnrouted
        selectedId="order-1"
        busy={false}
        loading={false}
        error={null}
        page={1}
        lastPage={2}
        onState={vi.fn()}
        onPlatform={vi.fn()}
        onBranch={vi.fn()}
        onSelect={vi.fn()}
        onPage={vi.fn()}
        onAction={onAction}
        {...overrides}
      />
    </div>
  );
  return { onAction };
}

describe('DeliveryHubWorkspace', () => {
  it('shows the platform name with the operational state and no financial control', () => {
    renderWorkspace();
    expect(screen.getAllByText('جاهز').length).toBeGreaterThan(0);
    expect(screen.getAllByText('state_received').length).toBeGreaterThan(0);
    expect(screen.getByText('noFinancial')).toBeTruthy();
    expect(screen.queryByText('handedOffHint')).toBeNull();
    expect(screen.queryByText('posted')).toBeNull();
    expect(screen.queryByRole('button', { name: 'pay' })).toBeNull();
    expect(document.querySelector('[data-testid="delivery-platform-mark"] img')).toBeNull();
    expect(document.querySelector('time')?.getAttribute('dateTime')).toBe(order.created_at);
    expect(document.querySelector('[dir="rtl"] [data-testid="delivery-hub-desktop-table"] .text-start')).toBeTruthy();
    expect(screen.getByTestId('delivery-hub-mobile-list')).toBeTruthy();
    expect(screen.getByTestId('delivery-hub-desktop-table')).toBeTruthy();
  });

  it('hides the unrouted queue and mutations for a restricted reader', () => {
    renderWorkspace({ canOperate: false, canSeeUnrouted: false, state: 'all' });
    expect(screen.queryByRole('tab', { name: 'state_unrouted' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'accept' })).toBeNull();
    expect(screen.getByText('viewOnly')).toBeTruthy();
  });

  it('offers accept and reroute, then reports the chosen action', async () => {
    const user = userEvent.setup();
    const { onAction } = renderWorkspace();
    expect(screen.getByRole('button', { name: 'accept' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'reroute' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'accept' }));
    expect(onAction).toHaveBeenCalledWith(order, 'accept', null);
  });

  it('shows a transition error without extra order data', () => {
    renderWorkspace({ error: 'تعذر تنفيذ الانتقال', selectedId: null });
    expect(screen.getByRole('alert').textContent).toBe('تعذر تنفيذ الانتقال');
    expect(screen.queryByTestId('delivery-hub-detail')).toBeNull();
  });

  it('keeps later pages reachable and clears a stale destination', async () => {
    const user = userEvent.setup();
    const onPage = vi.fn();
    const view = render(
      <DeliveryHubWorkspace
        orders={[order]}
        branches={[{ id: 'branch-a', name: 'الفرع الأول' }, { id: 'branch-b', name: 'الفرع الثاني' }]}
        platforms={[]}
        state="received"
        platformId=""
        branchId=""
        canOperate
        canSeeUnrouted
        selectedId="order-1"
        busy={false}
        loading={false}
        error={null}
        page={1}
        lastPage={3}
        onState={vi.fn()}
        onPlatform={vi.fn()}
        onBranch={vi.fn()}
        onSelect={vi.fn()}
        onPage={onPage}
        onAction={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'next' }));
    expect(onPage).toHaveBeenCalledWith(2);
    await user.selectOptions(screen.getByLabelText('destination'), 'branch-b');
    view.rerender(
      <DeliveryHubWorkspace
        orders={[{ ...order, id: 'order-2', branch_id: 'branch-b', branch_name: 'الفرع الثاني' }]}
        branches={[{ id: 'branch-a', name: 'الفرع الأول' }, { id: 'branch-b', name: 'الفرع الثاني' }]}
        platforms={[]}
        state="received"
        platformId=""
        branchId=""
        canOperate
        canSeeUnrouted
        selectedId="order-2"
        busy={false}
        loading={false}
        error={null}
        page={1}
        lastPage={3}
        onState={vi.fn()}
        onPlatform={vi.fn()}
        onBranch={vi.fn()}
        onSelect={vi.fn()}
        onPage={onPage}
        onAction={vi.fn()}
      />
    );
    expect((screen.getByLabelText('destination') as HTMLSelectElement).value).toBe('');
  });

  it('closes the detail with Escape and hides the pager on a single page', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWorkspace({ onSelect, lastPage: 1 });
    expect(screen.queryByRole('button', { name: 'next' })).toBeNull();
    await user.keyboard('{Escape}');
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('labels operational hand-off without a payment or posting control', () => {
    renderWorkspace({
      orders: [{ ...order, state: 'handed_off' }],
      state: 'handed_off',
    });
    expect(screen.getByText('handedOffHint')).toBeTruthy();
    expect(screen.getByText('noFinancial')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'pay' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'posted' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'handoff' })).toBeNull();
  });
});
