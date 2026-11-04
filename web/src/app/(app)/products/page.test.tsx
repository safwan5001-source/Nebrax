// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductsPage from './page';

const { api, downloadFile, translate, getSystemTaxInclusive, getShowStockQuantities } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    title: 'Products',
    search: 'Search products',
    sku: 'SKU',
    barcode: 'Barcode',
    name: 'Name',
    type: 'Type',
    good: 'Good',
    service: 'Service',
    stock: 'Stock',
    status_label: 'Status',
    active: 'Active',
    inactive: 'Inactive',
    sale_price: 'Sale price',
    tax_incl_tag: 'incl. VAT',
    tax_excl_tag: 'excl. VAT',
    empty: 'No products',
    import: 'Import',
    ai_import: 'Assisted review import',
    add: 'Add product',
    view: 'View',
    edit: 'Edit',
    copy: 'Copy',
    delete: 'Delete',
    action_failed: 'Action failed',
    noResults: 'No results',
    exportCsv: 'Export CSV',
    retry: 'Try again',
    export: 'Export',
    export_title: 'Export products',
    export_scope: 'Export scope',
    export_scope_selected: 'Scope selected',
    export_scope_filtered: 'Scope filtered',
    export_scope_all: 'Scope all',
    export_template: 'File template',
    export_format: 'Format',
    export_submit: 'Run export',
    export_no_selection: 'Nothing selected',
    cancel: 'Cancel',
    selected_count: 'Selected',
    clear_selection: 'Clear selection',
    selectRow: 'Select row',
    selectAllRows: 'Select all visible rows',
    selection_mode_enter: 'Select',
    selection_mode_exit: 'Done',
    selection_mode_hint: 'Select products to export them.',
    select_page: 'Select all products on this page',
  };
  // بديلٌ مبسّط لـ`t`: `rich` تُرجع القيم غير الدالّية فقط، فيكفي لاختبار سجلّ
  // الجوال دون محاكاة ICU كاملاً — الترجمة نفسها مُختبَرة في `nebrax/`.
  const translator = Object.assign((key: string) => strings[key] ?? key, {
    raw: () => ({}),
    rich: (key: string, values: Record<string, unknown> = {}) =>
      Object.values(values).filter((value) => typeof value !== 'function').join(' ') || (strings[key] ?? key),
  });
  return {
    api: vi.fn(),
    downloadFile: vi.fn(),
    translate: translator,
    getSystemTaxInclusive: vi.fn(),
    getShowStockQuantities: vi.fn(),
  };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/api', () => ({ api, downloadFile, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/tax', () => ({ getSystemTaxInclusive }));
vi.mock('@/lib/inventory', () => ({ getShowStockQuantities }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/products/product-dialog', () => ({ ProductDialog: () => null }));
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

const baseProduct = {
  id: 'p1', sku: 'SKU-1000', barcode: '6280000001001', name: 'Diesel oil filter', name_en: null,
  type: 'good', unit: 'pc', description: null, category: null, brand: null,
  category_id: 'c1', brand_id: null, unit_template_id: null, reorder_level: 5,
  min_sale_price: null, discount: null, discount_type: null, profit_margin: null,
  tags: null, internal_notes: null, sales_account_id: null, cogs_account_id: null,
  sale_price: '75.50', purchase_price: '50.00', tax_rate: 15,
  track_inventory: true, quantity_on_hand: 21, avg_cost: '48.00', is_active: true,
};

function respondWith(products: unknown[]) {
  api.mockImplementation((path: string) => {
    if (path === '/product-categories') {
      return Promise.resolve({ data: [{ id: 'c1', name: 'Spare parts', parent_id: null, is_active: true }] });
    }
    return Promise.resolve({ data: products });
  });
}

/** سجلّ الجوال هو قائمة `DataTable` المقابلة للجدول — أول `ul` في الصفحة. */
async function firstMobileRecord() {
  const list = await screen.findByRole('list');
  return within(list).getAllByRole('listitem')[0];
}

describe('ProductsPage mobile record identifiers', () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.mockReset();
    getSystemTaxInclusive.mockResolvedValue(false);
    getShowStockQuantities.mockResolvedValue(true);
  });

  it('shows the SKU and the barcode together, each with its own label', async () => {
    respondWith([baseProduct]);
    render(<ProductsPage />);

    const record = within(await firstMobileRecord());
    expect(record.getByText('SKU')).toBeTruthy();
    expect(record.getByText('SKU-1000')).toBeTruthy();
    expect(record.getByText('Barcode')).toBeTruthy();
    expect(record.getByText('6280000001001')).toBeTruthy();
  });

  it('renders both identifiers left-to-right so scanned codes stay readable in an RTL page', async () => {
    respondWith([baseProduct]);
    render(<ProductsPage />);

    const record = within(await firstMobileRecord());
    expect(record.getByText('SKU-1000').getAttribute('dir')).toBe('ltr');
    expect(record.getByText('6280000001001').getAttribute('dir')).toBe('ltr');
  });

  it('shows the barcode alone when the product has no SKU', async () => {
    respondWith([{ ...baseProduct, sku: null }]);
    render(<ProductsPage />);

    const record = within(await firstMobileRecord());
    expect(record.getByText('6280000001001')).toBeTruthy();
    expect(record.queryByText('SKU')).toBeNull();
  });

  it('shows the SKU alone when the product has no barcode', async () => {
    respondWith([{ ...baseProduct, barcode: null }]);
    render(<ProductsPage />);

    const record = within(await firstMobileRecord());
    expect(record.getByText('SKU-1000')).toBeTruthy();
    expect(record.queryByText('Barcode')).toBeNull();
  });

  it('keeps the record hierarchy: name, then category, then price', async () => {
    respondWith([baseProduct]);
    render(<ProductsPage />);

    const text = (await firstMobileRecord()).textContent ?? '';
    expect(text.indexOf('Diesel oil filter')).toBeLessThan(text.indexOf('Spare parts'));
    expect(text.indexOf('Spare parts')).toBeLessThan(text.indexOf('75.50'));
  });
});

describe('ProductsPage AI import entry', () => {
  afterEach(cleanup);

  it('keeps the traditional import and exposes the assistant review route as separate permitted actions', async () => {
    respondWith([baseProduct]);
    const user = userEvent.setup();
    render(<ProductsPage />);
    await screen.findByRole('list');

    expect(screen.getByRole('link', { name: 'Import' }).getAttribute('href')).toBe('/products/import');
    // The action group keeps secondary product-management actions in its
    // overflow menu; it is still gated exactly like the traditional import.
    await user.click(screen.getByRole('button', { name: 'moreActions' }));
    expect(screen.getByRole('menuitem', { name: 'Assisted review import' }).getAttribute('href')).toBe('/products/ai-import');
  });
});

/**
 * تصدير المنتجات والفرز والتحديد — العقد الذي يمنع تصدير الصفحة الحالية
 * تحت اسم «كل النتائج».
 */
describe('ProductsPage server-side export, sorting and selection', () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.mockReset();
    downloadFile.mockReset();
    downloadFile.mockResolvedValue(undefined);
    getSystemTaxInclusive.mockResolvedValue(false);
    getShowStockQuantities.mockResolvedValue(true);
  });

  /** آخر مسار طلبته القائمة من الـAPI. */
  function lastListQuery(): URLSearchParams {
    const call = api.mock.calls.filter((entry) => String(entry[0]).startsWith('/products?')).at(-1);
    return new URLSearchParams(String(call?.[0]).split('?')[1] ?? '');
  }

  function lastExportQuery(): URLSearchParams {
    const path = downloadFile.mock.calls.at(-1)?.[0] as string;
    return new URLSearchParams(path.split('?')[1] ?? '');
  }

  it('never exports from the loaded rows — the download goes to the server route', async () => {
    respondWith([baseProduct]);
    const user = userEvent.setup();
    render(<ProductsPage />);
    await screen.findByRole('list');

    await user.click(screen.getAllByRole('button', { name: 'Export' })[0]);
    await user.click(await screen.findByRole('button', { name: 'Run export' }));

    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    expect(String(downloadFile.mock.calls[0][0])).toContain('/products/export?');
  });

  it('sends the list filters to the export route without pagination parameters', async () => {
    respondWith([baseProduct]);
    const user = userEvent.setup();
    render(<ProductsPage />);
    await screen.findByRole('list');

    // القائمة نفسها تُقسَّم؛ التصدير المفلتر لا يحمل التقسيم إطلاقاً.
    expect(lastListQuery().get('per_page')).toBe('25');

    await user.click(screen.getAllByRole('button', { name: 'Export' })[0]);
    await user.click(await screen.findByRole('button', { name: 'Run export' }));

    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    const params = lastExportQuery();
    expect(params.get('scope')).toBe('filtered');
    expect(params.get('sort')).toBe('name');
    expect(params.get('page')).toBeNull();
    expect(params.get('per_page')).toBeNull();
  });

  it('drives sorting through the server and keeps one source of truth', async () => {
    respondWith([baseProduct]);
    const user = userEvent.setup();
    render(<ProductsPage />);
    await screen.findByRole('list');

    expect(lastListQuery().get('sort')).toBe('name');

    await user.click(screen.getByRole('button', { name: /Sale price/ }));
    await waitFor(() => expect(lastListQuery().get('sort')).toBe('sale_price'));

    await user.click(screen.getByRole('button', { name: /Sale price/ }));
    await waitFor(() => expect(lastListQuery().get('sort')).toBe('-sale_price'));
  });

  it('does not offer header sorting for columns the server cannot sort', async () => {
    respondWith([baseProduct]);
    render(<ProductsPage />);
    await screen.findByRole('list');

    expect(screen.queryByRole('button', { name: /Barcode/ })).toBeNull();
    expect(screen.getByRole('button', { name: /SKU/ })).toBeTruthy();
  });

  it('exports only the selected products once rows are checked', async () => {
    respondWith([baseProduct, { ...baseProduct, id: 'p2', sku: 'SKU-1001', name: 'Air filter' }]);
    const user = userEvent.setup();
    render(<ProductsPage />);
    await screen.findByRole('list');

    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0]);
    expect(screen.getByText('Selected')).toBeTruthy();

    await user.click(screen.getAllByRole('button', { name: 'Export' })[0]);
    await user.click(await screen.findByLabelText('Scope selected'));
    await user.click(screen.getByRole('button', { name: 'Run export' }));

    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    const params = lastExportQuery();
    expect(params.get('scope')).toBe('selected');
    expect(params.getAll('ids[]')).toEqual(['p1']);
  });

  it('selects and clears every visible row from the header checkbox', async () => {
    respondWith([baseProduct, { ...baseProduct, id: 'p2', sku: 'SKU-1001', name: 'Air filter' }]);
    const user = userEvent.setup();
    render(<ProductsPage />);
    await screen.findByRole('list');

    await user.click(screen.getByRole('button', { name: 'Select' }));
    const selectAll = screen.getByRole('checkbox', { name: 'Select all visible rows' });
    await user.click(selectAll);
    expect(screen.getAllByRole('checkbox', { name: 'Select row' }).every((box) => (box as HTMLInputElement).checked)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByText('Selected')).toBeNull();
  });

  it('hides the selected scope until something is actually selected', async () => {
    respondWith([baseProduct]);
    const user = userEvent.setup();
    render(<ProductsPage />);
    await screen.findByRole('list');

    await user.click(screen.getAllByRole('button', { name: 'Export' })[0]);
    expect(screen.queryByLabelText('Scope selected')).toBeNull();
    expect(screen.getByLabelText('Scope all')).toBeTruthy();
  });

  it('keeps view and edit navigation on separate routes', async () => {
    respondWith([baseProduct]);
    render(<ProductsPage />);
    await screen.findByRole('list');

    const editLinks = screen.getAllByRole('link', { name: 'Edit' }) as HTMLAnchorElement[];
    expect(editLinks.length).toBeGreaterThan(0);
    editLinks.forEach((link) => expect(link.getAttribute('href')).toBe('/products/p1/edit'));
    expect(screen.getAllByRole('link', { name: 'View' }).some((link) => link.getAttribute('href') === '/products/p1')).toBe(true);
  });
});

/**
 * AWJ-UX-SELECTION-MODE-1 — التحديد صريح: لا مربعات ولا شريط جماعي خارج وضع التحديد.
 */
describe('ProductsPage explicit selection mode', () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.mockReset();
    downloadFile.mockReset();
    downloadFile.mockResolvedValue(undefined);
    getSystemTaxInclusive.mockResolvedValue(false);
    getShowStockQuantities.mockResolvedValue(true);
  });

  const two = [baseProduct, { ...baseProduct, id: 'p2', sku: 'SKU-1001', name: 'Air filter' }];
  const boxes = () => screen.queryAllByRole('checkbox');

  it('default mode shows no checkboxes, no select-all and no selection bar', async () => {
    respondWith(two);
    render(<ProductsPage />);
    await screen.findByRole('list');

    expect(boxes()).toHaveLength(0);
    expect(screen.queryByText('Selected')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear selection' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Select' })).toBeTruthy();
    // التنقل وإجراءات الصف سليمة خارج الوضع.
    expect(screen.getAllByRole('link', { name: 'Edit' }).length).toBeGreaterThan(0);
  });

  it('entering the mode reveals the checkboxes but selects nothing', async () => {
    respondWith(two);
    const user = userEvent.setup();
    render(<ProductsPage />);
    await screen.findByRole('list');

    await user.click(screen.getByRole('button', { name: 'Select' }));
    expect(boxes().length).toBeGreaterThan(0);
    expect(boxes().every((box) => !(box as HTMLInputElement).checked)).toBe(true);
    expect(screen.queryByText('Selected')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear selection' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it('Done clears the selection: the checkboxes vanish and the export scope no longer offers "selected"', async () => {
    respondWith(two);
    const user = userEvent.setup();
    render(<ProductsPage />);
    await screen.findByRole('list');

    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select all visible rows' }));
    expect(screen.getByText('Selected')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(boxes()).toHaveLength(0);
    expect(screen.queryByText('Selected')).toBeNull();

    await user.click(screen.getAllByRole('button', { name: 'Export' })[0]);
    expect(screen.queryByLabelText('Scope selected')).toBeNull();

    // الدخول من جديد يبدأ فارغاً.
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Select' }));
    expect(boxes().every((box) => !(box as HTMLInputElement).checked)).toBe(true);
  });

  it('select-all only touches the rows of the current page', async () => {
    respondWith(two);
    const user = userEvent.setup();
    render(<ProductsPage />);
    await screen.findByRole('list');

    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select all visible rows' }));
    await user.click(screen.getAllByRole('button', { name: 'Export' })[0]);
    await user.click(await screen.findByLabelText('Scope selected'));
    await user.click(screen.getByRole('button', { name: 'Run export' }));

    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    const params = new URLSearchParams(String(downloadFile.mock.calls.at(-1)?.[0]).split('?')[1] ?? '');
    expect(params.getAll('ids[]').sort()).toEqual(['p1', 'p2']);
  });

  it('a search change keeps the mode but drops every selected row', async () => {
    respondWith(two);
    const user = userEvent.setup();
    render(<ProductsPage />);
    await screen.findByRole('list');

    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select all visible rows' }));
    expect(screen.getByText('Selected')).toBeTruthy();

    await user.type(screen.getByRole('searchbox'), 'oil');
    await waitFor(() => expect(screen.queryByText('Selected')).toBeNull());
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(boxes().every((box) => !(box as HTMLInputElement).checked)).toBe(true);
  });

  it('offers a mobile-only "select this page" control that touches the current page only', async () => {
    respondWith(two);
    const user = userEvent.setup();
    render(<ProductsPage />);
    await screen.findByRole('list');

    // خارج الوضع: لا شيء.
    expect(screen.queryByRole('checkbox', { name: 'Select all products on this page' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Select' }));

    const pageBox = screen.getByRole('checkbox', { name: 'Select all products on this page' }) as HTMLInputElement;
    expect(pageBox.checked).toBe(false);
    expect(pageBox.closest('label')?.className).toContain('md:hidden'); // سطح المكتب يستعمل رأس الجدول

    await user.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0]);
    expect(pageBox.indeterminate).toBe(true);
    await user.click(pageBox);
    expect(pageBox.checked).toBe(true);
    expect(screen.getAllByRole('checkbox', { name: 'Select row' }).every((box) => (box as HTMLInputElement).checked)).toBe(true);
    await user.click(pageBox);
    expect(screen.getAllByRole('checkbox', { name: 'Select row' }).every((box) => !(box as HTMLInputElement).checked)).toBe(true);
  });
});

