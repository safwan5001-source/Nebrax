/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductProfilePage from './page';

const { api, push, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    back: 'Back', edit: 'Edit', copy: 'Copy', delete: 'Delete',
    add_inventory_operation: 'Receive stock', issue_stock: 'Issue stock', transfer_stock: 'Transfer stock',
    active: 'Active', inactive: 'Inactive',
    item_details: 'Item details', pricing_details: 'Pricing', inventory_mgmt: 'Inventory',
    inventory_movements: 'Stock movements', section_more: 'Additional data', activity: 'Activity',
    product_info: 'Product summary', no_activity: 'No activity yet', no_media: 'No images yet',
    sku: 'SKU', barcode: 'Barcode', type: 'Type', good: 'Good', service: 'Service',
    unit: 'Unit', units: 'Units', category: 'Category', brand: 'Brand', unclassified: 'Unclassified',
    name_en: 'English name',
    sale_price: 'Sale price', purchase_price: 'Purchase price', tax_rate: 'Tax rate',
    min_sale_price: 'Minimum sale price', discount: 'Discount', profit_margin: 'Profit margin',
    track_inventory: 'Track inventory', tracked: 'Tracked', untracked: 'Not tracked',
    stock: 'Stock', avg_cost: 'Average cost', reorder_level: 'Reorder level',
    description: 'Description', tags: 'Tags', internal_notes: 'Internal notes',
    image_preview: 'Image {number}',
    load_profile_failed: 'Could not load the product.', loading_profile: 'Loading product…',
    activity_by: 'by {name}', activity_unknown_user: 'Unknown',
    summary: 'Summary', loading: 'Loading', retry: 'Try again', empty: 'No records',
    date: 'Date', qty: 'Quantity', balance: 'Balance', in: 'In', out: 'Out', adjustment: 'Adjustment',
  };
  const translator = Object.assign(
    (key: string, values?: Record<string, unknown>) =>
      (strings[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => String(values?.[n] ?? '')),
    { raw: () => ({}), rich: (key: string) => strings[key] ?? key }
  );
  return { api: vi.fn(), push: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
const router = { push };
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => ({ id: 'pr9' }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/api', () => ({
  api,
  ApiError: class ApiError extends Error {},
  fetchImageUrl: () => Promise.resolve(null),
}));
vi.mock('@/components/ui/toast', () => {
  const fns = { success: vi.fn(), error: vi.fn() };
  return { useToast: () => fns };
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

const product = {
  id: 'pr9', name: 'Tissue carton', name_en: null, sku: 'SKU-009', barcode: '2000000000090',
  type: 'good', unit: 'carton', unit_template_id: 'ut-1',
  category: 'Stationery', brand: 'Riyadh Packaging', category_id: 'pc-1', brand_id: 'br-2',
  sale_price: '120.00', purchase_price: '78.00', tax_rate: 15,
  min_sale_price: '100.00', profit_margin: 20, discount: 5, discount_type: 'percent',
  supplier_id: null, sales_account_id: null, cogs_account_id: null,
  track_inventory: true, reorder_level: 40, quantity_on_hand: 320, avg_cost: '76.00',
  description: 'Premium tissue.', tags: 'tissue', internal_notes: 'Reorder monthly.',
  is_active: true, units: [{ name: 'carton', factor: 1 }, { name: 'pack', factor: 12 }],
};

function respond(overrides: Record<string, unknown> = {}) {
  api.mockImplementation((path: string) => {
    if (path in overrides) return (overrides[path] as () => Promise<unknown>)();
    if (path === '/products/pr9') return Promise.resolve({ data: product });
    if (path === '/products/pr9/media') return Promise.resolve({ data: [] });
    if (path === '/products/pr9/activity') return Promise.resolve({ data: [] });
    if (path === '/inventory/pr9/movements') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
}

describe('product detail', () => {
  afterEach(cleanup);
  beforeEach(() => { api.mockReset(); push.mockReset(); });

  it('leads with the product identity, its status and its code', async () => {
    respond();
    render(<ProductProfilePage />);

    expect(await screen.findByRole('heading', { name: 'Tissue carton' })).toBeTruthy();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SKU-009').length).toBeGreaterThan(0);
  });

  // كانت أربعة حقول فقط داخل تبويب: لا ضريبة ولا حدّ أدنى ولا حالة تتبّع ولا وحدات.
  it('shows the commercial and inventory facts that the old profile omitted', async () => {
    respond();
    render(<ProductProfilePage />);
    await screen.findByRole('heading', { name: 'Tissue carton' });

    for (const label of ['Tax rate', 'Minimum sale price', 'Profit margin', 'Reorder level', 'Units']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('Tracked').length).toBeGreaterThan(0);
    expect(screen.getAllByText('carton ×1 · pack ×12').length).toBeGreaterThan(0);
  });

  // التحرير صفحةٌ كاملة الآن، لا حوارٌ فوق التفاصيل.
  it('sends the edit action to the full edit page', async () => {
    respond();
    render(<ProductProfilePage />);
    await screen.findByRole('heading', { name: 'Tissue carton' });

    const edit = screen.getAllByRole('link', { name: 'Edit' })[0];
    expect(edit.getAttribute('href')).toBe('/products/pr9/edit');
  });

  // إجراءان ثانويان يبقيان ظاهرَين و`ActionGroup` يطوي الباقي في قائمة فائض واحدة.
  it('keeps the stock permit actions reachable from the profile', async () => {
    respond();
    render(<ProductProfilePage />);
    await screen.findByRole('heading', { name: 'Tissue carton' });

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toContain('/stock-permits/new?type=receipt&product=pr9');
    expect(hrefs).toContain('/stock-permits/new?type=issue&product=pr9');
    expect(screen.getByRole('button', { name: 'moreActions' })).toBeTruthy();
  });

  it('renders the movements section from its own endpoint', async () => {
    respond({
      '/inventory/pr9/movements': () => Promise.resolve({
        data: [{
          id: 'm1', type: 'in', quantity: 100, unit_cost: '76.00', total_cost: '7600.00',
          balance_quantity: 320, movement_date: '2026-08-01', notes: null,
        }],
      }),
    });
    render(<ProductProfilePage />);
    await screen.findByRole('heading', { name: 'Tissue carton' });

    await waitFor(() => expect(screen.getAllByText('2026-08-01').length).toBeGreaterThan(0));
  });

  it('shows an error state with a retry when the product cannot be loaded', async () => {
    respond({ '/products/pr9': () => Promise.reject(new Error('nope')) });
    render(<ProductProfilePage />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('presents money with the central riyal formatter and no retired glyph', async () => {
    respond();
    const { container } = render(<ProductProfilePage />);
    await screen.findByRole('heading', { name: 'Tissue carton' });

    expect(container.textContent).toContain('120.00');
    expect(container.textContent).not.toContain('﷼');
    expect(container.textContent).not.toContain('SAR');
  });

  it('summarises stock, cost and price without inventing analytics', async () => {
    respond();
    render(<ProductProfilePage />);
    await screen.findByRole('heading', { name: 'Tissue carton' });

    expect(screen.getAllByText('Product summary').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Stock').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Average cost').length).toBeGreaterThan(0);
  });
});
