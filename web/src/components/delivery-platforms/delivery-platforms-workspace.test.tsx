/* @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeliveryPlatformsWorkspace } from './delivery-platforms-workspace';
import { platformManagementRows, readPlatformProfiles } from '@/lib/delivery-platform-management';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'ar',
}));

afterEach(cleanup);

const profiles = readPlatformProfiles([
  {
    id: 'profile-jahez',
    platform_key: 'jahez',
    is_active: true,
    sales_channel: { slug: 'delivery-jahez' },
    current_version: {
      version_number: 3,
      collection_mode: 'platform_collected',
      external_reference_policy: 'optional',
      display_name: 'جاهز',
      branch_overrides: [{ branch_id: 'branch-a', collection_mode: 'merchant_collected', external_reference_policy: 'optional' }],
    },
  },
]);

function renderWorkspace(canManage = true) {
  const onSave = vi.fn();
  render(
    <div dir="rtl">
      <DeliveryPlatformsWorkspace
        rows={platformManagementRows(profiles)}
        branches={[{ id: 'branch-a', name: 'الفرع الأول', is_active: true }, { id: 'branch-b', name: 'الفرع الثاني', is_active: false }]}
        canManage={canManage}
        selectedKey="jahez"
        busy={false}
        loading={false}
        error={null}
        onSelect={vi.fn()}
        onSave={onSave}
      />
    </div>
  );
  return { onSave };
}

describe('DeliveryPlatformsWorkspace', () => {
  it('shows every canonical platform by name and official logo, with no connector state', () => {
    renderWorkspace();
    for (const name of ['هنقرستيشن', 'جاهز', 'مرسول', 'كيتا', 'نينجا', 'ذا شيفز']) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('status_active').length).toBeGreaterThan(0);
    expect(screen.getByText('notAnIntegration')).toBeTruthy();
    expect(screen.getByText('configuredIsNotConnected')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bConnected\b|\bSynced\b|\bLive\b|API Active|متصل/);
    expect(document.querySelector('[data-testid="delivery-platform-mark"] img')?.getAttribute('src')).toMatch(/^\/delivery-platforms\/.+\.png$/);
    expect(document.querySelector('[data-testid="delivery-platforms-desktop-table"] img')).toBeTruthy();
    expect(document.querySelector('[data-testid="delivery-platforms-mobile-list"] img')).toBeTruthy();
    expect(document.querySelector('[dir="rtl"] [data-testid="delivery-platforms-desktop-table"] .text-start')).toBeTruthy();
    expect(screen.getByTestId('delivery-platforms-mobile-list')).toBeTruthy();
    expect(screen.getByText('الفرع الأول')).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'الفرع الثاني' })).toBeNull();
    expect(document.querySelector('[class*="#"]')).toBeNull();
  });

  it('keeps a viewer from saving and lets a manager send configuration only', async () => {
    const user = userEvent.setup();
    const readOnly = renderWorkspace(false);
    expect(screen.queryByRole('button', { name: 'save' })).toBeNull();
    expect(screen.getByText('viewOnly')).toBeTruthy();
    cleanup();
    const { onSave } = renderWorkspace(true);
    await user.click(screen.getByRole('button', { name: 'save' }));
    expect(screen.getByTestId('financial-role-config')).toBeTruthy();
    expect(screen.getByTestId('financial-gate-decision').textContent).toBe('gateBlocked');
    expect(document.body.textContent).not.toMatch(/Ready for financial posting|جاهز للترحيل/);
    expect(onSave).toHaveBeenCalledWith('profile-jahez', expect.objectContaining({
      selling_role: 'unknown',
      invoice_responsibility: 'unknown',
      collection_role: 'unknown',
      merchant_vat_status_at_supply: 'unknown',
    }));
    expect(onSave).toHaveBeenCalledWith('profile-jahez', expect.not.objectContaining({
      logo_asset_key: expect.anything(),
      connected: expect.anything(),
      posting_authorized: expect.anything(),
      financial_verified_at: expect.anything(),
    }));
    expect(readOnly.onSave).not.toHaveBeenCalled();
  });
});
