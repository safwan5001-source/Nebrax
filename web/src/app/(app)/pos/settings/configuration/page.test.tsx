// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PosConfigurationPage from './page';

const { api, success } = vi.hoisted(() => ({ api: vi.fn(), success: vi.fn() }));
const strings: Record<string, string> = {
  back_to_settings: 'Back', configuration_title: 'POS configuration', configuration_subtitle: 'Configure POS.',
  default_customer: 'Default customer', allow_discount: 'Allow discount', show_product_images: 'Show product images', show_product_images_hint: 'Image hint.',
  apply_customer_price_list: 'Apply price list', apply_customer_price_list_hint: 'Price list hint.', allow_unit_price_override: 'Allow override', allow_unit_price_override_hint: 'Override hint.',
  payment_methods: 'Payment methods', payment_methods_hint: 'Methods hint.', payment_methods_empty: 'No methods.', all_active_payment_methods: 'All active methods',
  default_payment_method: 'Default method', default_payment_method_auto: 'Automatic', default_payment_method_hint: 'Method hint.',
  product_category_visibility: 'Category visibility', product_category_visibility_hint: 'Category hint.', product_category_visibility_all: 'All categories', product_category_visibility_only: 'Only categories', product_category_visibility_except: 'Except categories', product_category_selection: 'Categories', product_category_selection_only_hint: 'Only hint.', product_category_selection_except_hint: 'Except hint.', product_category_selection_empty: 'No categories.', product_category_visibility_only_empty: 'No selected category.', product_category_visibility_except_empty: 'No excluded category.',
  allow_deferred_payment: 'Allow deferred payment', allow_deferred_payment_hint: 'Deferred hint.', cash_refund_policy: 'Cash refund policy', cash_refund_original_cash_only: 'Original cash only', cash_refund_allow_any_pos_sale: 'Any POS sale', cash_refund_policy_hint: 'Refund hint.', exchange_surplus_policy: 'Exchange surplus policy', exchange_surplus_customer_credit_only: 'Customer credit only', exchange_surplus_allow_cash_refund: 'Cash refund allowed', exchange_surplus_policy_hint: 'Exchange hint.', held_sale_close_policy: 'Held-sale close policy', held_sale_discard_on_session_close: 'Discard', held_sale_keep_for_next_session: 'Keep', held_sale_close_policy_hint: 'Held hint.',
  save: 'Save', updated: 'Updated', saveFailed: 'Save failed.', load_failed: 'Load failed.',
};
const translate = (key: string) => strings[key] ?? key;

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success }) }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));

const settings = {
  default_customer: '', receipt_footer: '', print_receipt: true, receipt_paper_size: 'thermal_80', allow_discount: true,
  apply_customer_price_list: true, allow_unit_price_override: false, enabled_payment_method_ids: [], payment_methods_mode: 'all_active',
  default_payment_method_id: null, allow_deferred_payment: true, product_category_visibility_mode: 'all', product_category_ids: [],
  cash_refund_policy: 'original_cash_only', exchange_surplus_policy: 'customer_credit_only', held_sale_close_policy: 'discard_on_session_close', show_product_images: true,
  cash_drawer_driver: 'local_bridge', cash_drawer_enabled: true, cash_drawer_auto_open_after_cash: true,
};

describe('صفحة تهيئة POS بعد نقل إعدادات درج النقدية', () => {
  afterEach(() => { cleanup(); api.mockReset(); success.mockReset(); });

  it('لا تعرض عناصر درج النقدية ولا تعيد إرسالها عند حفظ إعدادات التهيئة الأخرى', async () => {
    api.mockResolvedValueOnce({ data: settings });
    api.mockResolvedValueOnce({ data: [] });
    api.mockResolvedValueOnce({ data: [] });
    api.mockResolvedValueOnce({ data: settings });
    api.mockResolvedValueOnce({ data: [] });
    api.mockResolvedValueOnce({ data: [] });
    render(<PosConfigurationPage />);

    await screen.findByLabelText('Default customer');
    expect(screen.queryByText('cash_drawer_contract')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api).toHaveBeenNthCalledWith(4, '/sales-config/pos', expect.objectContaining({ method: 'PUT' })));
    const saved = api.mock.calls[3][1].body.data;
    expect(saved).not.toHaveProperty('cash_drawer_driver');
    expect(saved).not.toHaveProperty('cash_drawer_enabled');
    expect(saved).not.toHaveProperty('cash_drawer_auto_open_after_cash');
  });
});
