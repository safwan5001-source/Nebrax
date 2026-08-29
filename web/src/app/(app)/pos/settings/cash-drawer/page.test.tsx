// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PosCashDrawerSettingsPage from './page';

const { api, success, error, fetchMock, search } = vi.hoisted(() => ({
  api: vi.fn(), success: vi.fn(), error: vi.fn(), fetchMock: vi.fn(), search: new URLSearchParams('device=device-2'),
}));
const strings: Record<string, string> = {
  back_to_settings: 'Back to POS settings', cash_drawer_title: 'Cash Drawer', cash_drawer_subtitle: 'Manage in one place.',
  cash_drawer_operation: 'Operation', cash_drawer_operation_hint: 'Safe by default.', cash_drawer_driver: 'Driver',
  cash_drawer_driver_unavailable: 'Unavailable', cash_drawer_driver_local_bridge: 'Local Bridge', cash_drawer_enable: 'Enable drawer',
  cash_drawer_auto_open_after_cash: 'Auto-open after cash', cash_drawer_devices: 'POS devices', cash_drawer_devices_hint: 'Choose a device.',
  cash_drawer_local_bridge: 'Local bridge and testing', cash_drawer_local_bridge_hint: 'Local only.', cash_drawer_status: 'Status and testing',
  drawer_enable_requires_pairing: 'Pairing is required.', drawer_no_devices: 'No POS devices.', drawer_select_device: 'Select a device.',
  drawer_pairing_title: 'Pair local bridge', drawer_pairing_hint: 'Enter pairing code.', drawer_pairing_success: 'Paired successfully.',
  drawer_pairing_failed: 'Pairing failed.', drawer_printer: 'Linked printer', drawer_channel: 'Drawer channel', drawer_pulse_on: 'Pulse on', drawer_pulse_off: 'Pulse off',
  drawer_last_test: 'Last test', drawer_last_success: 'Last success', drawer_test: 'Test drawer open', drawer_testing: 'Testing drawer open…',
  drawer_test_requires_pairing: 'Pairing required for test.', drawer_session_required: 'Open POS session required.', drawer_test_failed: 'Drawer test failed.',
  drawer_status_not_configured: 'Not configured', drawer_status_connected: 'Connected', drawer_status_bridge_unavailable: 'Bridge unavailable',
  drawer_status_printer_unavailable: 'Printer unavailable', drawer_status_failed: 'Failed', drawer_status_opened: 'Open command sent',
  save: 'Save', updated: 'Updated', saveFailed: 'Save failed.', load_failed: 'Load failed.', active: 'Active', inactive: 'Inactive',
  bridge_url: 'Local bridge URL', pairing_code: 'Pairing code', pairing: 'Pair', cash_drawer_opened: 'Cash-drawer open command sent successfully.',
};
const translate = (key: string) => strings[key] ?? key;

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'ar' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => search }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success, error }) }));
vi.mock('@/lib/api', () => ({
  api,
  ApiError: class ApiError extends Error { constructor(message: string, public status?: number, public body?: unknown) { super(message); } },
}));
vi.mock('@/lib/cash-drawer-bridge', () => ({
  executeCashDrawerAction: vi.fn(async (action: unknown, complete: (id: string, result: unknown) => Promise<unknown>) => complete('action-1', { status: 'opened', error_code: null, receipt: 'signed', request_id: 'bridge-1' })),
}));

const settings = { cash_drawer_driver: 'local_bridge', cash_drawer_enabled: true, cash_drawer_auto_open_after_cash: false };
const devices = [
  { id: 'device-1', name: 'Counter one', code: 'C-01', is_active: true, warehouse: { id: 'w1', name: 'Main warehouse', code: 'MAIN' }, cash_drawer: { configured: true, bridge_url: 'http://127.0.0.1:17463', printer_identifier: 'Thermal 80', drawer_channel: 0, pulse_on_ms: 120, pulse_off_ms: 240, last_result: { status: 'opened', at: '2026-08-27T00:00:00Z' }, last_success_at: '2026-08-27T00:00:00Z' } },
  { id: 'device-2', name: 'Counter two', code: 'C-02', is_active: true, warehouse: { id: 'w2', name: 'West warehouse', code: 'WEST' }, cash_drawer: { configured: false, bridge_url: null, printer_identifier: null, drawer_channel: null, pulse_on_ms: null, pulse_off_ms: null, last_result: null, last_success_at: null } },
];

function mockLoad(currentDevices = devices) {
  api.mockResolvedValueOnce({ data: settings });
  api.mockResolvedValueOnce({ data: currentDevices });
}

describe('صفحة إعدادات درج النقدية', () => {
  afterEach(() => { cleanup(); api.mockReset(); success.mockReset(); error.mockReset(); fetchMock.mockReset(); search.set('device', 'device-2'); vi.unstubAllGlobals(); });

  it('تحمل الإعدادات والأجهزة وتختار الجهاز الوارد في query param وتعرض الحالة غير المهيأة', async () => {
    mockLoad();
    render(<PosCashDrawerSettingsPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: /Counter two/i }).getAttribute('aria-pressed')).toBe('true'));
    expect(api).toHaveBeenCalledWith('/sales-config/pos');
    expect(api).toHaveBeenCalledWith('/pos-devices');
    expect(screen.getAllByText('Not configured')).toHaveLength(2);
    expect((screen.getByLabelText('Enable drawer') as HTMLInputElement).disabled).toBe(false);
  });

  it('يربط الجهاز المختار من الصفحة الموحدة ثم يحفظ بيانات الاقتران في العقد الحالي', async () => {
    mockLoad();
    mockLoad();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'paired', pairing_secret: 's'.repeat(48), printer_identifier: 'Thermal 80', drawer_channel: 0, pulse_on_ms: 120, pulse_off_ms: 240 }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<PosCashDrawerSettingsPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: /Counter two/i }).getAttribute('aria-pressed')).toBe('true'));
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'PAIR-CODE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pair' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:17463/v1/pair', expect.objectContaining({ method: 'POST' })));
    expect(api).toHaveBeenCalledWith('/pos-devices/device-2/cash-drawer/pair', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ printer_identifier: 'Thermal 80', drawer_channel: 0 }) }));
    await waitFor(() => expect(success).toHaveBeenCalledWith('Paired successfully.'));
  });

  it('يبدأ اختبار الدرج من الجهاز المقترن ويؤكد نتيجة الجسر عبر عقد الإكمال الحالي', async () => {
    search.set('device', 'device-1');
    mockLoad();
    api.mockResolvedValueOnce({ data: { status: 'pending', action_id: 'action-1', bridge: { url: 'http://127.0.0.1:17463/v1/cash-drawer/open', request: {} } } });
    api.mockResolvedValueOnce({ data: { status: 'opened', error_code: null } });
    mockLoad();
    render(<PosCashDrawerSettingsPage />);

    await screen.findByRole('button', { name: /Test drawer open/i });
    fireEvent.click(screen.getByRole('button', { name: /Test drawer open/i }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/pos-devices/device-1/cash-drawer/test', { method: 'POST' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/pos-devices/device-1/cash-drawer/test/complete', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(success).toHaveBeenCalledWith('Cash-drawer open command sent successfully.'));
  });

  it('يعرض حالة فارغة مفهومة عندما لا توجد أجهزة POS', async () => {
    mockLoad([]);
    render(<PosCashDrawerSettingsPage />);

    expect(await screen.findByText('No POS devices.')).not.toBeNull();
    expect(screen.getByText('Select a device.')).not.toBeNull();
  });
});
