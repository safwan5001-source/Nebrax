// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PosConfigurationPage from './page';

const { api, success } = vi.hoisted(() => ({ api: vi.fn(), success: vi.fn() }));
const strings: Record<string, string> = {
  back_to_settings: 'Back to POS settings',
  configuration_title: 'POS configuration',
  configuration_subtitle: 'Configure POS.',
  configuration_loading: 'Loading POS configuration…',
  section_customer_sales: 'Customer and selling',
  section_customer_sales_description: 'Customer section description.',
  section_products_pricing: 'Products and pricing',
  section_products_pricing_description: 'Products section description.',
  section_payment: 'Payment',
  section_payment_description: 'Payment section description.',
  section_receipt_printing: 'Receipt and printing',
  section_receipt_printing_description: 'Printing section description.',
  section_operating_policies: 'Operating policies',
  section_operating_policies_description: 'Policy section description.',
  default_customer: 'Default customer',
  default_customer_hint: 'Default customer hint.',
  allow_discount: 'Allow discount',
  allow_discount_hint: 'Discount hint.',
  show_product_images: 'Show product images',
  show_product_images_hint: 'Image hint.',
  apply_customer_price_list: 'Apply price list',
  apply_customer_price_list_hint: 'Price list hint.',
  allow_unit_price_override: 'Allow override',
  allow_unit_price_override_hint: 'Override hint.',
  show_onscreen_numeric_keypad: 'Show numeric keypad while editing',
  show_onscreen_numeric_keypad_hint: 'Keypad hint.',
  allow_deferred_payment: 'Allow deferred payment',
  allow_deferred_payment_hint: 'Deferred hint.',
  print_receipt: 'Auto-print receipt',
  print_receipt_hint: 'Print hint.',
  receipt_printing_disabled_hint: 'Print disabled hint.',
  receipt_paper_size: 'Paper size',
  receipt_paper_80: '80 mm',
  receipt_paper_58: '58 mm',
  receipt_paper_size_hint: 'Paper hint.',
  receipt_footer: 'Receipt footer',
  receipt_footer_hint: 'Footer hint.',
  default_pos_receipt_template: 'Default POS receipt template',
  default_pos_receipt_template_hint: 'Receipt template hint.',
  default_pos_receipt_template_fallback: 'Use fallback thermal template',
  default_pos_receipt_template_reset: 'Reset to fallback',
  default_pos_receipt_template_empty: 'No compatible receipt template.',
  default_pos_receipt_template_manage: 'Manage document templates',
  payment_methods: 'Payment-method mode',
  payment_methods_hint: 'Methods hint.',
  payment_methods_empty: 'No methods.',
  payment_methods_mode_all_active: 'All active methods',
  payment_methods_mode_only: 'Selected methods only',
  payment_methods_mode_none: 'No payment methods',
  payment_methods_mode_all_active_hint: 'All methods hint.',
  payment_methods_mode_only_hint: 'Selected methods hint.',
  payment_methods_mode_only_empty: 'Choose one method.',
  payment_methods_mode_none_hint: 'No methods hint.',
  enabled_payment_methods: 'Allowed payment methods',
  default_payment_method: 'Default method',
  default_payment_method_auto: 'Automatic',
  default_payment_method_hint: 'Method hint.',
  product_category_visibility: 'Category visibility',
  product_category_visibility_hint: 'Category hint.',
  product_category_visibility_all: 'All categories',
  product_category_visibility_only: 'Only categories',
  product_category_visibility_except: 'Except categories',
  product_category_selection: 'Categories',
  product_category_selection_only_hint: 'Only hint.',
  product_category_selection_except_hint: 'Except hint.',
  product_category_selection_empty: 'No categories.',
  product_category_visibility_only_empty: 'No selected category.',
  product_category_visibility_except_empty: 'No excluded category.',
  cash_refund_policy: 'Cash refund policy',
  cash_refund_original_cash_only: 'Original cash only',
  cash_refund_allow_any_pos_sale: 'Any POS sale',
  cash_refund_policy_hint: 'Refund hint.',
  exchange_surplus_policy: 'Exchange surplus policy',
  exchange_surplus_customer_credit_only: 'Customer credit only',
  exchange_surplus_allow_cash_refund: 'Cash refund allowed',
  exchange_surplus_policy_hint: 'Exchange hint.',
  held_sale_close_policy: 'Held-sale close policy',
  held_sale_discard_on_session_close: 'Discard',
  held_sale_keep_for_next_session: 'Keep',
  held_sale_close_policy_hint: 'Held hint.',
  save: 'Save settings',
  saving: 'Saving…',
  updated: 'Updated',
  saveFailed: 'Save failed.',
  load_failed: 'Load failed.',
  walkin_customer: 'Walk-in customer',
  customer_search: 'Search customers',
  no_customers: 'No customers',
};
const translate = (key: string) => strings[key] ?? key;

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success }) }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));

const settings = {
  default_customer_id: 'customer-1',
  default_customer: 'Customer One',
  receipt_footer: 'Thank you',
  print_receipt: true,
  receipt_paper_size: 'thermal_80',
  allow_discount: true,
  apply_customer_price_list: true,
  allow_unit_price_override: false,
  show_onscreen_numeric_keypad: false,
  enabled_payment_method_ids: [],
  payment_methods_mode: 'all_active',
  default_payment_method_id: null as string | null,
  allow_deferred_payment: true,
  product_category_visibility_mode: 'all',
  product_category_ids: [],
  cash_refund_policy: 'original_cash_only',
  exchange_surplus_policy: 'customer_credit_only',
  held_sale_close_policy: 'discard_on_session_close',
  show_product_images: true,
  sound_enabled: true,
  cash_drawer_driver: 'local_bridge',
  cash_drawer_enabled: true,
  cash_drawer_auto_open_after_cash: true,
};

const paymentMethods = [
  { id: 'cash', name: 'Cash', name_en: 'Cash', settlement_type: 'cash', is_active: true, is_default: true },
  { id: 'bank', name: 'Bank transfer', name_en: 'Bank transfer', settlement_type: 'bank', is_active: true, is_default: false },
];

const productCategories = [
  { id: 'food', name: 'Food', parent_id: null, is_active: true },
  { id: 'drinks', name: 'Drinks', parent_id: 'food', is_active: true },
];

const customers = [
  { id: 'customer-1', code: 'C-001', name: 'Customer One', type: 'customer', phone: '0500000000', is_active: true },
  { id: 'supplier-1', code: 'S-001', name: 'Supplier One', type: 'supplier', phone: '0500000001', is_active: true },
];

const receiptTemplates = [
  { id: 'thermal-80-a', name: 'Thermal 80 A', status: 'published', document_types: ['tax_invoice'], published_revision: { id: 'thermal-80-a-r1', status: 'published', document_types: ['tax_invoice'], definition: { template_id: 'tax-invoice-thermal80' } } },
  { id: 'thermal-80-b', name: 'Thermal 80 B', status: 'published', document_types: ['tax_invoice'], published_revision: { id: 'thermal-80-b-r1', status: 'published', document_types: ['tax_invoice'], definition: { template_id: 'tax-invoice-thermal80' } } },
  { id: 'thermal-58', name: 'Thermal 58', status: 'published', document_types: ['tax_invoice'], published_revision: { id: 'thermal-58-r1', status: 'published', document_types: ['tax_invoice'], definition: { template_id: 'tax-invoice-thermal58' } } },
  { id: 'page-template', name: 'A4 template', status: 'published', document_types: ['tax_invoice'], published_revision: { id: 'page-r1', status: 'published', document_types: ['tax_invoice'], definition: { template_id: 'tax-invoice-classic' } } },
  { id: 'draft-thermal', name: 'Draft thermal', status: 'draft', document_types: ['tax_invoice'], published_revision: null },
];

function mockSuccessfulLoad(
  overrides: Partial<typeof settings> = {},
  availableReceiptTemplates = receiptTemplates,
  receiptAssignmentRevisionId: string | null = 'thermal-80-a-r1',
) {
  const responseSettings = { ...settings, ...overrides };
  api.mockImplementation((url: string, options?: { method?: string; body?: { data: unknown } }) => {
    if (url === '/sales-config/pos' && options?.method === 'PUT') return Promise.resolve({ data: options.body?.data });
    if (url === '/sales-config/pos') return Promise.resolve({ data: responseSettings });
    if (url === '/payment-methods') return Promise.resolve({ data: paymentMethods });
    if (url === '/product-categories') return Promise.resolve({ data: productCategories });
    if (url === '/partners') return Promise.resolve({ data: customers });
    if (url === '/print-templates') return Promise.resolve({ data: availableReceiptTemplates });
    if (url === '/print-templates/resolve?document_type=tax_invoice&usage=thermal') {
      return Promise.resolve({ data: receiptAssignmentRevisionId ? { print_template_revision_id: receiptAssignmentRevisionId } : null });
    }
    if (url === '/print-templates/assignments/default') return Promise.resolve({ data: null });
    return Promise.reject(new Error(`Unexpected endpoint: ${url}`));
  });
}

async function renderLoaded(overrides: Partial<typeof settings> = {}) {
  mockSuccessfulLoad(overrides);
  render(<PosConfigurationPage />);
  await screen.findByRole('heading', { name: 'Customer and selling' });
}

describe('صفحة تهيئة POS بعد توحيد UX', () => {
  afterEach(() => { cleanup(); api.mockReset(); success.mockReset(); });

  it('تحمّل أقسام التهيئة والعميل الافتراضي القابل للبحث', async () => {
    await renderLoaded();

    expect(screen.getByRole('heading', { name: 'Products and pricing' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Payment' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Receipt and printing' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Default customer' }).textContent).toContain('Customer One');

    fireEvent.click(screen.getByRole('button', { name: 'Default customer' }));
    expect(await screen.findByRole('option', { name: /Customer One/ })).not.toBeNull();
    expect(screen.queryByRole('option', { name: /Supplier One/ })).toBeNull();
  });

  it('يحمّل القالب الحراري الملائم للمقاس فقط ويحفظ التعيين عبر المحرك العام', async () => {
    await renderLoaded();
    const selector = screen.getByLabelText('Default POS receipt template') as HTMLSelectElement;
    expect(selector.value).toBe('thermal-80-a-r1');
    expect(screen.getByRole('option', { name: 'Thermal 80 A' })).not.toBeNull();
    expect(screen.getByRole('option', { name: 'Thermal 80 B' })).not.toBeNull();
    expect(screen.queryByRole('option', { name: 'Thermal 58' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'A4 template' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Draft thermal' })).toBeNull();

    fireEvent.change(selector, { target: { value: 'thermal-80-b-r1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(api.mock.calls.some(([url, options]) => (
      url === '/print-templates/assignments/default' && options?.method === 'PUT'
    ))).toBe(true));
    const assignment = api.mock.calls.find(([url, options]) => (
      url === '/print-templates/assignments/default' && options?.method === 'PUT'
    ))![1].body;
    expect(assignment).toEqual({
      document_type: 'tax_invoice',
      usage: 'thermal',
      print_template_revision_id: 'thermal-80-b-r1',
    });
    const saved = api.mock.calls.find(([url, options]) => url === '/sales-config/pos' && options?.method === 'PUT')![1].body.data;
    expect(saved).toMatchObject({ receipt_footer: 'Thank you', receipt_paper_size: 'thermal_80' });
    expect(saved).not.toHaveProperty('cash_drawer_enabled');
  });

  it('يعيد selector إلى fallback ويعرض القوالب الملائمة للمقاس الجديد فقط', async () => {
    await renderLoaded();
    const selector = screen.getByLabelText('Default POS receipt template') as HTMLSelectElement;
    fireEvent.change(screen.getByLabelText('Paper size'), { target: { value: 'thermal_58' } });
    expect(selector.value).toBe('');
    expect(screen.getByRole('option', { name: 'Thermal 58' })).not.toBeNull();
    expect(screen.queryByRole('option', { name: 'Thermal 80 A' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(api.mock.calls.some(([url, options]) => (
      url === '/print-templates/assignments/default' && options?.method === 'DELETE'
    ))).toBe(true));
    const reset = api.mock.calls.find(([url, options]) => (
      url === '/print-templates/assignments/default' && options?.method === 'DELETE'
    ))![1].body;
    expect(reset).toEqual({ document_type: 'tax_invoice', usage: 'thermal' });
  });

  it('يعرض حالة فارغة مفهومة عند غياب قالب حراري ملائم', async () => {
    mockSuccessfulLoad({}, [], null);
    render(<PosConfigurationPage />);
    await screen.findByRole('heading', { name: 'Receipt and printing' });

    expect(screen.getByText('No compatible receipt template.')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Manage document templates' }).getAttribute('href')).toBe('/document-design');
    expect((screen.getByLabelText('Default POS receipt template') as HTMLSelectElement).disabled).toBe(true);
  });

  it('لا يعرض أي تحكم لدرج النقدية في صفحة Configuration', async () => {
    await renderLoaded();

    expect(document.querySelector('#cash-drawer-driver')).toBeNull();
    expect(document.querySelector('#cash-drawer-enabled')).toBeNull();
    expect(document.querySelector('#cash-drawer-auto-open-after-cash')).toBeNull();
  });

  it('يعرض اختيار التصنيفات فقط في وضعي only وexcept', async () => {
    await renderLoaded();
    expect(screen.queryByLabelText('Food')).toBeNull();

    fireEvent.change(screen.getByLabelText('Category visibility'), { target: { value: 'only' } });
    expect(await screen.findByLabelText('Food')).not.toBeNull();
    expect(screen.getByText('Only hint.')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Category visibility'), { target: { value: 'except' } });
    expect(await screen.findByText('Except hint.')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Category visibility'), { target: { value: 'all' } });
    expect(screen.queryByLabelText('Food')).toBeNull();
  });

  it('يفصح عن وسائل الدفع فقط في الوضع الذي يتطلب اختياراً ويخفي الافتراضي عند none', async () => {
    await renderLoaded();
    expect(screen.getByText('All methods hint.')).not.toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Cash/ })).toBeNull();

    fireEvent.change(screen.getByLabelText('Payment-method mode'), { target: { value: 'only' } });
    expect(await screen.findByRole('checkbox', { name: /Cash/ })).not.toBeNull();
    expect((screen.getByLabelText('Default method') as HTMLSelectElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: /Cash/ }));
    expect((screen.getByLabelText('Default method') as HTMLSelectElement).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText('Payment-method mode'), { target: { value: 'none' } });
    expect(await screen.findByText('No methods hint.')).not.toBeNull();
    expect(screen.queryByLabelText('Default method')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Cash/ })).toBeNull();
  });

  it('يحمّل مفتاح لوحة الأرقام ويحفظه ضمن عقد POS من دون إعادة Cash Drawer', async () => {
    await renderLoaded({ show_onscreen_numeric_keypad: false });
    const keypadSwitch = screen.getByRole('switch', { name: 'Show numeric keypad while editing' });
    expect(keypadSwitch.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(keypadSwitch);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(api.mock.calls.some(([url, options]) => url === '/sales-config/pos' && options?.method === 'PUT')).toBe(true));
    const saved = api.mock.calls.find(([url, options]) => url === '/sales-config/pos' && options?.method === 'PUT')![1].body.data;
    expect(saved).toMatchObject({ show_onscreen_numeric_keypad: true, allow_discount: true });
    expect(saved).not.toHaveProperty('cash_drawer_enabled');
  });

  it('يعطل ضوابط الإيصال الثانوية دون فقد قيمتها عند إيقاف الطباعة', async () => {
    await renderLoaded();
    const printSwitch = screen.getByRole('switch', { name: 'Auto-print receipt' });
    fireEvent.click(printSwitch);

    expect((screen.getByLabelText('Paper size') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Receipt footer') as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByText('Print disabled hint.')).not.toBeNull();
  });

  it('يعرض حالة التحميل وحالة الخطأ بوضوح', async () => {
    api.mockImplementation(() => new Promise(() => undefined));
    const { unmount } = render(<PosConfigurationPage />);
    expect(await screen.findByLabelText('Loading POS configuration…')).not.toBeNull();
    unmount();

    api.mockImplementation(() => Promise.reject(new Error('Network failed')));
    render(<PosConfigurationPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('Load failed.');
  });

  it('يحفظ الاختيارات المرئية من دون إعادة مفاتيح درج النقدية أو إسقاط الإعدادات الأخرى', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('switch', { name: 'Allow discount' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(api.mock.calls.some(([url, options]) => url === '/sales-config/pos' && options?.method === 'PUT')).toBe(true));
    const saved = api.mock.calls.find(([url, options]) => url === '/sales-config/pos' && options?.method === 'PUT')![1].body.data;

    expect(saved).toMatchObject({
      default_customer_id: 'customer-1',
      allow_discount: false,
      receipt_footer: 'Thank you',
      sound_enabled: true,
      show_onscreen_numeric_keypad: false,
    });
    expect(saved).not.toHaveProperty('cash_drawer_driver');
    expect(saved).not.toHaveProperty('cash_drawer_enabled');
    expect(saved).not.toHaveProperty('cash_drawer_auto_open_after_cash');
    expect(success).toHaveBeenCalledWith('Updated');
  });

  it('يمسح وسيلة الدفع الافتراضية عند الانتقال إلى only من دون اختيارها', async () => {
    await renderLoaded({ default_payment_method_id: 'cash' });
    fireEvent.change(screen.getByLabelText('Payment-method mode'), { target: { value: 'only' } });

    expect((screen.getByLabelText('Default method') as HTMLSelectElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(api.mock.calls.some(([url, options]) => url === '/sales-config/pos' && options?.method === 'PUT')).toBe(true));
    const saved = api.mock.calls.find(([url, options]) => url === '/sales-config/pos' && options?.method === 'PUT')![1].body.data;
    expect(saved).toMatchObject({ payment_methods_mode: 'only', enabled_payment_method_ids: [], default_payment_method_id: null });
  });

  it('يمسح وسيلة الدفع الافتراضية عند اختيار وضع none لتجنب حمولة متناقضة', async () => {
    await renderLoaded({ default_payment_method_id: 'cash' });
    fireEvent.change(screen.getByLabelText('Payment-method mode'), { target: { value: 'none' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(api.mock.calls.some(([url, options]) => url === '/sales-config/pos' && options?.method === 'PUT')).toBe(true));
    const saved = api.mock.calls.find(([url, options]) => url === '/sales-config/pos' && options?.method === 'PUT')![1].body.data;
    expect(saved).toMatchObject({ payment_methods_mode: 'none', enabled_payment_method_ids: [], default_payment_method_id: null });
  });
});
