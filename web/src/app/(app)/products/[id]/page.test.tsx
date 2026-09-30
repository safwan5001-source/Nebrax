// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductProfilePage from './page';

const { api, pathname } = vi.hoisted(() => ({
  api: vi.fn(),
  pathname: { value: '/products/p1' },
}));

const translate = (key: string) => ({
  back: 'Back',
  profile_title: 'Product profile',
  product_info: 'Product information',
  inventory_movements: 'Inventory movements',
  timeline: 'Timeline',
  activity: 'Activity',
  active: 'Active',
  stock: 'Stock',
  avg_cost: 'Average cost',
  sale_price: 'Sale price',
  units: 'Units',
  unit_base_badge: 'base',
  edit: 'Edit product',
  more_actions: 'More actions',
  load_profile_failed: 'Could not load product',
  action_failed: 'Action failed',
  copy: 'Copy',
  copy_success: 'Copied',
  delete: 'Delete',
  delete_confirm: 'Delete {name}?',
  transfer_stock: 'Transfer stock',
  add_inventory_operation: 'Add inventory operation',
  issue_stock: 'Issue stock',
  timeline_next_stage: 'Coming soon',
  no_activity: 'No activity',
  activity_by: 'By {name}',
  activity_unknown_user: 'Unknown',
}[key] ?? key);

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'p1' }),
  usePathname: () => pathname.value,
}));
vi.mock('next-intl', () => ({
  useTranslations: () => translate,
}));
vi.mock('@/lib/api', () => ({
  api,
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/formatting', () => ({ formatDateTime: (value: string) => value }));
vi.mock('@/lib/money', () => ({ formatRiyal: (value: string) => value }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/products/product-workspace', () => ({
  ProductWorkspace: ({ mode }: { mode: string }) => (
    <div data-testid="product-workspace-edit">
      <input aria-label="Product name" defaultValue="Test product" />
      <button type="button">Save changes</button>
      <span>{mode}</span>
    </div>
  ),
}));
vi.mock('lucide-react', () => {
  const Icon = () => <span aria-hidden="true" />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) => (typeof name === 'symbol' || name === 'then' || name === '__esModule' ? Reflect.get(target, name) : Icon),
    has: () => true,
  });
});

const product = {
  id: 'p1', sku: 'SKU-1', barcode: '123', name: 'Test product', name_en: null,
  type: 'good', unit: 'piece', description: null, category: null, brand: null,
  category_id: null, brand_id: null, unit_template_id: null, default_sales_unit: null,
  default_purchase_unit: null, reorder_level: null, min_sale_price: null, discount: null,
  discount_type: null, profit_margin: null, tags: null, internal_notes: null,
  sales_account_id: null, cogs_account_id: null, sale_price: '10.00', purchase_price: '5.00',
  tax_rate: 15, track_inventory: true, quantity_on_hand: 3, avg_cost: '5.00', is_active: true,
  units: [],
};

function mockProfileApi() {
  api.mockImplementation((request: string) => {
    if (request.endsWith('/activity')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: product });
  });
}

describe('ProductProfilePage route separation', () => {
  beforeEach(() => {
    api.mockReset();
    mockProfileApi();
    pathname.value = '/products/p1';
  });
  afterEach(cleanup);

  it('renders /products/:id as read-only without edit workspace, fields, or save button', async () => {
    render(<ProductProfilePage />);
    expect(await screen.findByText('Test product')).toBeTruthy();
    expect(screen.queryByTestId('product-workspace-edit')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Product name' })).toBeNull();
  });

  it('renders /products/:id/edit with the edit workspace and form controls', async () => {
    pathname.value = '/products/p1/edit';
    render(<ProductProfilePage />);
    expect(await screen.findByText('Test product')).toBeTruthy();
    expect(await screen.findByTestId('product-workspace-edit')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Product name' })).toBeTruthy();
  });
});
