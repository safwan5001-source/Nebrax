// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InventoryPage from './page';

const { api, translate, exportDialog } = vi.hoisted(() => ({
  api: vi.fn(),
  exportDialog: vi.fn(),
  translate: (key: string) => key,
}));

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'ar' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) =>
      typeof name === 'symbol' || name === 'then' || name === '__esModule'
        ? Reflect.get(target, name)
        : iconStub,
    has: () => true,
  });
});
vi.mock('@/components/inventory/movements-dialog', () => ({ MovementsDialog: () => null }));
vi.mock('@/components/inventory/inventory-export-dialog', () => ({
  InventoryExportDialog: (props: { open: boolean; filteredCount: number; totalCount: number }) => {
    exportDialog(props);
    return props.open ? (
      <div role="dialog" aria-label="export">
        filtered={props.filteredCount} total={props.totalCount}
      </div>
    ) : null;
  },
}));
// أدوات استكشاف البيانات ثقيلة؛ نكتفي منها بغلاف يمرّر المحتوى.
vi.mock('@/components/data-explorer/data-explorer-toolbar', () => ({ DataExplorerToolbar: () => <div /> }));
vi.mock('@/components/data-explorer/advanced-filter-dialog', () => ({ AdvancedFilterDialog: () => null }));
vi.mock('@/components/data-table', () => ({ DataTable: () => <table /> }));

const items = [
  { id: 'p1', sku: 'SKU-1', name: 'إسمنت', unit: 'كيس', quantity_on_hand: 100, avg_cost: '10.00', stock_value: '1000.00' },
  { id: 'p2', sku: 'SKU-2', name: 'حديد', unit: 'طن', quantity_on_hand: 5, avg_cost: '30.00', stock_value: '150.00' },
];

beforeEach(() => {
  api.mockReset();
  exportDialog.mockReset();
  api.mockResolvedValue({ data: items, total_value: '1150.00' });
});

afterEach(cleanup);

describe('شاشة أرصدة المخزون', () => {
  it('تعرض زر «تصدير» في شريط الرأس', async () => {
    render(<InventoryPage />);
    await waitFor(() => expect(api).toHaveBeenCalledWith('/inventory'));
    expect(screen.getByRole('button', { name: 'export' })).toBeTruthy();
  });

  it('يفتح الزرّ الحوار ويمرّر عدّادات النتائج الكلية', async () => {
    const user = userEvent.setup();
    render(<InventoryPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'export' })).toBeTruthy());

    // الحوار مغلق ابتداءً.
    expect(screen.queryByRole('dialog', { name: 'export' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'export' }));

    const dialog = await screen.findByRole('dialog', { name: 'export' });
    expect(dialog.textContent).toContain('filtered=2');
    expect(dialog.textContent).toContain('total=2');
  });
});
