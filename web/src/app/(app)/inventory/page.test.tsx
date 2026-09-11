// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InventoryPage from './page';
import { ApiError } from '@/lib/api';

const { api, exportDialog, searchParams, translations } = vi.hoisted(() => ({
  api: vi.fn(),
  exportDialog: vi.fn(),
  searchParams: new URLSearchParams(),
  translations: {
    inventory: (key: string) => `inventory.${key}`,
    warehouses: (key: string) => `warehouses.${key}`,
    products: (key: string) => `products.${key}`,
    common: (key: string) => `common.${key}`,
  },
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    Suspense: ({ children }: { children: React.ReactNode }) => children,
  };
});
vi.mock('next-intl', () => ({
  useTranslations: (namespace = 'inventory') =>
    translations[namespace as keyof typeof translations] ?? translations.inventory,
  useLocale: () => 'ar',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/inventory',
  useSearchParams: () => searchParams,
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api };
});
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
vi.mock('@/components/inventory/movements-dialog', () => ({
  MovementsDialog: ({ product }: { product: { id: string; name: string } | null }) => (
    product ? <div role="dialog" aria-label="movements">{product.id}</div> : null
  ),
}));
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
vi.mock('@/components/data-explorer/data-explorer-toolbar', () => ({ DataExplorerToolbar: () => <div /> }));
vi.mock('@/components/data-explorer/advanced-filter-dialog', () => ({ AdvancedFilterDialog: () => null }));
vi.mock('@/components/nebrax', () => ({
  Pagination: ({ page, lastPage, total }: { page: number; lastPage: number; total: number }) => (
    <div data-testid="pagination">page={page} last={lastPage} total={total}</div>
  ),
}));
vi.mock('@/components/data-table', () => ({
  DataTable: ({
    columns,
    data,
    loading,
    error,
    emptyLabel,
  }: {
    columns: Array<{ accessorKey?: string; header?: React.ReactNode }>;
    data: Array<Record<string, unknown>>;
    loading?: boolean;
    error?: string | null;
    emptyLabel?: string;
  }) => (
    <div>
      {loading ? <div>loading</div> : null}
      {error ? <div>{error}</div> : null}
      {!loading && !error && data.length === 0 ? <div>{emptyLabel}</div> : null}
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={String(column.accessorKey ?? column.header)}>{column.header as React.ReactNode}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={String(row.id)}>
              <td>{String(row.name ?? '')}</td>
              <td>{String(row.warehouse_name ?? '')}</td>
              <td>{row.avg_cost == null ? 'hidden-cost' : String(row.avg_cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
}));

const workspaceRow = {
  id: 'p1:w1',
  product_id: 'p1',
  warehouse_id: 'w1',
  branch_id: 'b1',
  sku: 'SKU-1',
  name: 'إسمنت',
  unit: 'كيس',
  category_id: null,
  category_name: null,
  warehouse_name: 'المخزن الرئيسي',
  branch_name: 'الفرع الرئيس',
  quantity: 10,
  reorder_level: 5,
  stock_state: 'in_stock' as const,
  avg_cost: '12.00',
  stock_value: '120.00',
};

function workspaceResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: [workspaceRow],
    meta: {
      current_page: 1,
      last_page: 1,
      per_page: 25,
      total: 1,
      can_view_cost: true,
      total_quantity: 10,
      total_value: '120.00',
      ...((overrides.meta as object | undefined) ?? {}),
    },
    ...overrides,
  };
}

beforeEach(() => {
  api.mockReset();
  exportDialog.mockReset();
  searchParams.forEach((_, key) => searchParams.delete(key));
  api.mockImplementation((path: string) => {
    if (path.startsWith('/inventory')) return Promise.resolve(workspaceResponse());
    if (path === '/warehouses') return Promise.resolve({ data: [{ id: 'w1', name: 'المخزن الرئيسي' }] });
    if (path === '/branches') return Promise.resolve({ data: [{ id: 'b1', name: 'الفرع الرئيس' }] });
    if (path === '/product-categories') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
});

afterEach(cleanup);

describe('مساحة عمل المخزون', () => {
  it('تستدعي GET /inventory?view=workspace ولا تحمّل القائمة القديمة', async () => {
    render(<InventoryPage />);
    await waitFor(() => expect(api).toHaveBeenCalled());
    const inventoryCalls = api.mock.calls.map((call) => String(call[0])).filter((path) => path.startsWith('/inventory'));
    expect(inventoryCalls[0]).toContain('view=workspace');
    expect(inventoryCalls).not.toContain('/inventory');
  });

  it('تعرض صف المخزن وإجمالي القيمة عند وجود صلاحية التكلفة', async () => {
    render(<InventoryPage />);
    expect(await screen.findByText('المخزن الرئيسي')).toBeTruthy();
    expect(screen.getByTestId('workspace-total-value')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'إسمنت' }).getAttribute('href')).toBe('/products/p1');
  });

  it('تخفي القيمة والتكلفة عندما can_view_cost=false', async () => {
    api.mockImplementation((path: string) => {
      if (path.startsWith('/inventory')) {
        return Promise.resolve(workspaceResponse({
          data: [{ ...workspaceRow, avg_cost: null, stock_value: null }],
          meta: {
            current_page: 1, last_page: 1, per_page: 25, total: 1,
            can_view_cost: false, total_quantity: 10, total_value: null,
          },
        }));
      }
      return Promise.resolve({ data: [] });
    });
    render(<InventoryPage />);
    await screen.findByText('المخزن الرئيسي');
    expect(screen.queryByTestId('workspace-total-value')).toBeNull();
    expect(screen.getByText('hidden-cost')).toBeTruthy();
  });

  it('تعرض حالة الخطأ وتبقي زر التصدير', async () => {
    api.mockImplementation((path: string) => {
      if (path.startsWith('/inventory')) return Promise.reject(new ApiError(500, 'تعذر التحميل', {}));
      return Promise.resolve({ data: [] });
    });
    render(<InventoryPage />);
    expect(await screen.findByText('تعذر التحميل')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'inventory.export' })).toBeTruthy();
  });

  it('تعرض الحالة الفارغة', async () => {
    api.mockImplementation((path: string) => {
      if (path.startsWith('/inventory')) {
        return Promise.resolve({
          data: [],
          meta: {
            current_page: 1, last_page: 1, per_page: 25, total: 0,
            can_view_cost: true, total_quantity: 0, total_value: '0.00',
          },
        });
      }
      return Promise.resolve({ data: [] });
    });
    render(<InventoryPage />);
    expect(await screen.findByText('inventory.empty')).toBeTruthy();
  });

  it('يفتح التصدير بعد التحميل', async () => {
    const user = userEvent.setup();
    render(<InventoryPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'inventory.export' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'inventory.export' }));
    expect(await screen.findByRole('dialog', { name: 'export' })).toBeTruthy();
  });
});
