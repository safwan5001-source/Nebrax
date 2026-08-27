// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PosDevicesPage from './page';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
const strings: Record<string, string> = {
  title: 'POS devices', subtitle: 'Manage devices.', back_to_settings: 'Back', add: 'Add device', no_warehouse: 'No warehouse.',
  cash_drawer: 'Cash drawer', cash_drawer_not_configured: 'Not configured', cash_drawer_configured: 'Configured', cash_drawer_bridge_unavailable: 'Bridge unavailable', cash_drawer_printer_unavailable: 'Printer unavailable', cash_drawer_failed: 'Failed', cash_drawer_settings: 'Cash Drawer Settings',
  status: 'Status', active: 'Active', inactive: 'Inactive', name: 'Name', warehouse: 'Warehouse', code: 'Code', code_hint: 'Code hint.', notes: 'Notes', select_warehouse: 'Select warehouse', edit: 'Edit {name}', delete: 'Delete {name}', delete_confirm: 'Delete {name}?', edit_title: 'Edit device', add_title: 'Add device', search: 'Search devices', empty: 'No devices.',
  save: 'Save', cancel: 'Cancel', loadFailed: 'Load failed.', saveFailed: 'Save failed.', created: 'Created', updated: 'Updated', deleted: 'Deleted',
};
const translate = (key: string, values?: Record<string, string>) => (strings[key] ?? key).replace('{name}', values?.name ?? '');

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/components/data-table', () => ({
  DataTable: ({ columns, data }: { columns: Array<{ id?: string; cell?: ({ row }: { row: { original: unknown } }) => ReactNode }>; data: unknown[] }) => <div>{data.map((device, index) => <div key={index}>{columns.find((column) => column.id === 'actions')?.cell?.({ row: { original: device } })}</div>)}</div>,
}));

const device = { id: 'device-1', name: 'Counter one', code: 'C-01', notes: null, warehouse_id: 'w1', warehouse: { id: 'w1', name: 'Main warehouse', code: 'MAIN' }, is_active: true, cash_drawer: { configured: true, bridge_url: 'http://127.0.0.1:17463', printer_identifier: 'Thermal 80', drawer_channel: 0, pulse_on_ms: 120, pulse_off_ms: 240, paired_at: null, last_result: null, last_success_at: null } };

describe('صفحة أجهزة POS بعد نقل إعدادات درج النقدية', () => {
  afterEach(() => { cleanup(); api.mockReset(); });

  it('تبقي إدارة الجهاز وتوفر رابط إعداد درج النقدية مع الجهاز المحدد', async () => {
    api.mockResolvedValueOnce({ data: [device] });
    api.mockResolvedValueOnce({ data: [{ id: 'w1', name: 'Main warehouse', code: 'MAIN', is_active: true }] });
    render(<PosDevicesPage />);

    const link = await screen.findByRole('link', { name: 'Cash Drawer Settings' });
    expect(link.getAttribute('href')).toBe('/pos/settings/cash-drawer?device=device-1');
    expect(screen.getByRole('button', { name: 'Add device' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Pair bridge|Test drawer/i })).toBeNull();
  });
});
