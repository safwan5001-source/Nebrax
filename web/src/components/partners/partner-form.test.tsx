/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewPartnerPage from '@/app/(app)/partners/new/page';
import EditPartnerPage from '@/app/(app)/partners/[id]/edit/page';

const { api, push, translate, params, search } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    new_title: 'New partner', edit_title: 'Edit partner', back: 'Back', save: 'Save', cancel: 'Cancel',
    customer_details: 'Partner details', contact_details: 'Contact details',
    tax_identity: 'Tax identity', account_details: 'Account details', national_address: 'National address',
    name: 'Name', name_en: 'English name', type: 'Type',
    customer: 'Customer', supplier: 'Supplier', both: 'Customer & supplier',
    entity_type: 'Entity type', entity_type_customer: 'Customer entity', entity_type_supplier: 'Supplier entity',
    commercial: 'Commercial', individual: 'Individual',
    code: 'Code', classification: 'Classification', classification_hint: 'e.g. VIP',
    cls_wholesale: 'Wholesale', cls_retail: 'Retail', cls_government: 'Government',
    active: 'Active', active_hint: 'Inactive partners are hidden from pickers.',
    phone: 'Phone', mobile: 'Mobile', email: 'Email',
    vat_number: 'VAT number', vat_hint: '3xxxxxxxxxxxxx3', vat_length_hint: 'Fifteen digits.',
    cr_number: 'CR number',
    opening_balance: 'Opening balance', opening_balance_date: 'Opening balance date',
    opening_balance_hint: 'Posts an opening entry once.',
    opening_balance_locked: 'Opening balance is posted at creation and cannot be edited here.',
    credit_limit: 'Credit limit', credit_period: 'Credit period', credit_limit_hint: 'Zero means no limit.',
    default_price_list: 'Default price list', default_price_list_none: 'No price list',
    default_price_list_inactive: 'inactive', default_price_list_hint: 'Applied to new invoices.',
    address: 'Address', city: 'City', district: 'District', street: 'Street',
    building_no: 'Building number', postal_code: 'Postal code', country: 'Country',
    not_found: 'Partner not found.', saveFailed: 'Could not save.', created: 'Created', updated: 'Updated',
    loading: 'Loading', retry: 'Try again',
  };
  const translator = Object.assign(
    (key: string, values?: Record<string, unknown>) =>
      (strings[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => String(values?.[n] ?? '')),
    { raw: () => ({}), rich: (key: string) => strings[key] ?? key }
  );
  return {
    api: vi.fn(), push: vi.fn(), translate: translator,
    params: { current: { id: 'pt1' } }, search: { current: new URLSearchParams() },
  };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
const router = { push };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => params.current,
  useSearchParams: () => search.current,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
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

const priceLists = [
  { id: 'pl-1', name: 'Wholesale prices', is_active: true },
  { id: 'pl-3', name: 'Year-end campaign', is_active: false },
];

const storedPartner = {
  id: 'pt1', name: 'Al Tumooh Trading Co.', name_en: 'Al Tumooh', type: 'customer', entity_type: 'commercial',
  phone: '0138012345', mobile: '0551234567', email: 'info@tumooh.sa',
  address: 'King Fahd Road', city: 'Dammam', building_no: '3421', street: 'King Fahd', district: 'Olaya',
  postal_code: '32233', country: 'SA', vat_number: '311111111100003', cr_number: '2050123456',
  code: 'C-001', classification: 'VIP', credit_limit: '150000.00', credit_period: 30,
  default_price_list_id: 'pl-1', is_active: true,
};

function respond(overrides: (path: string, init?: { method?: string }) => Promise<unknown> | null = () => null) {
  api.mockImplementation((path: string, init?: { method?: string }) => {
    const override = overrides(path, init);
    if (override) return override;
    if (path === '/price-lists') return Promise.resolve({ data: priceLists });
    if (path === '/partners/pt1') return Promise.resolve({ data: storedPartner });
    return Promise.resolve({ data: {} });
  });
}

async function renderCreate() {
  respond();
  render(<NewPartnerPage />);
  await screen.findByLabelText(/^Name/);
}

describe('partner master-data form', () => {
  afterEach(cleanup);
  beforeEach(() => {
    api.mockReset();
    push.mockReset();
    params.current = { id: 'pt1' };
    search.current = new URLSearchParams();
  });

  it('renders the create form as the approved form pattern with one save action', async () => {
    await renderCreate();

    expect(screen.getByRole('heading', { name: 'New partner' })).toBeTruthy();
    for (const section of ['Partner details', 'Contact details', 'Tax identity', 'Account details', 'National address']) {
      expect(screen.getByText(section)).toBeTruthy();
    }
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1);
  });

  it('offers the three partner roles in user-facing wording', async () => {
    await renderCreate();

    const type = screen.getByLabelText('Type') as HTMLSelectElement;
    expect(Array.from(type.options).map((option) => option.textContent)).toEqual([
      'Customer', 'Supplier', 'Customer & supplier',
    ]);
    expect(type.value).toBe('customer');
  });

  // `?type=supplier` تأتي من قائمة الموردين، وبدونها كان كل مورّد يُنشأ «عميلاً».
  it('opens on the supplier role when the suppliers list sends it', async () => {
    search.current = new URLSearchParams('type=supplier');
    respond();
    render(<NewPartnerPage />);

    await waitFor(() => expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe('supplier'));
  });

  it('keeps phone, code and VAT number left-to-right and numeric-friendly', async () => {
    await renderCreate();

    const phone = screen.getByLabelText('Phone') as HTMLInputElement;
    const vat = screen.getByLabelText('VAT number') as HTMLInputElement;
    const code = screen.getByLabelText('Code') as HTMLInputElement;
    expect(phone.getAttribute('dir')).toBe('ltr');
    expect(phone.getAttribute('inputmode')).toBe('tel');
    expect(vat.getAttribute('dir')).toBe('ltr');
    expect(vat.getAttribute('maxlength')).toBe('15');
    expect(code.className).toContain('num');
  });

  // الخادم يرفض قائمة سعر افتراضية لطرفٍ ليس عميلاً (422) — فتُخفى وتُمحى قبل الإرسال.
  it('hides the default price list for a supplier and clears any stored choice', async () => {
    await renderCreate();

    await waitFor(() => expect(screen.getByLabelText('Default price list')).toBeTruthy());
    await userEvent.selectOptions(screen.getByLabelText('Default price list'), ['pl-1']);
    await userEvent.selectOptions(screen.getByLabelText('Type'), ['supplier']);
    expect(screen.queryByLabelText('Default price list')).toBeNull();

    await userEvent.type(screen.getByLabelText(/^Name/), 'Najd Supplies');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = api.mock.calls.find(([path, init]) => path === '/partners' && init?.method === 'POST');
      const body = call![1].body as Record<string, unknown>;
      expect(body.type).toBe('supplier');
      expect(body.default_price_list_id).toBeNull();
    });
  });

  it('marks an inactive price list so it cannot be picked by mistake', async () => {
    await renderCreate();

    await waitFor(() => expect(screen.getByLabelText('Default price list')).toBeTruthy());
    const inactive = screen.getByRole('option', { name: /Year-end campaign/ }) as HTMLOptionElement;
    expect(inactive.disabled).toBe(true);
  });

  it('sends the opening balance in minor units on create only', async () => {
    await renderCreate();

    await userEvent.type(screen.getByLabelText(/^Name/), 'Al Waha');
    await userEvent.type(screen.getByLabelText('Opening balance'), '1500.50');
    await userEvent.type(screen.getByLabelText('Credit limit'), '20000');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = api.mock.calls.find(([path, init]) => path === '/partners' && init?.method === 'POST');
      const body = call![1].body as Record<string, unknown>;
      expect(body.opening_balance).toBe(150050);
      expect(body.credit_limit).toBe(2000000);
    });
  });

  it('keeps save disabled until the required name is present', async () => {
    await renderCreate();

    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/^Name/), 'Al Waha');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('prefills every stored field on edit', async () => {
    respond();
    render(<EditPartnerPage />);

    await waitFor(() => expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Al Tumooh Trading Co.'));
    expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe('C-001');
    expect((screen.getByLabelText('VAT number') as HTMLInputElement).value).toBe('311111111100003');
    expect((screen.getByLabelText('Phone') as HTMLInputElement).value).toBe('0138012345');
    expect((screen.getByLabelText('City') as HTMLInputElement).value).toBe('Dammam');
    expect((screen.getByLabelText('Credit period') as HTMLInputElement).value).toBe('30');
    await waitFor(() =>
      expect((screen.getByLabelText('Default price list') as HTMLSelectElement).value).toBe('pl-1')
    );
  });

  // `UpdatePartnerRequest` يرفضه بـ`prohibited`: قيدٌ مرحّل لا حقل بيانات.
  it('never offers the opening balance on edit, and explains why', async () => {
    respond();
    render(<EditPartnerPage />);

    await waitFor(() => expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Al Tumooh Trading Co.'));
    expect(screen.queryByLabelText('Opening balance')).toBeNull();
    expect(screen.getByText('Opening balance is posted at creation and cannot be edited here.')).toBeTruthy();
  });

  it('saves the edit with PUT and without the prohibited opening balance', async () => {
    respond();
    render(<EditPartnerPage />);

    await waitFor(() => expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Al Tumooh Trading Co.'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = api.mock.calls.find(([path, init]) => path === '/partners/pt1' && init?.method === 'PUT');
      expect(call).toBeTruthy();
      const body = call![1].body as Record<string, unknown>;
      expect(body).not.toHaveProperty('opening_balance');
      expect(body).not.toHaveProperty('opening_balance_date');
      expect(body.vat_number).toBe('311111111100003');
      expect(body.credit_limit).toBe(15000000);
      expect(body.type).toBe('customer');
    });
  });

  it('shows an error state with a retry when the partner cannot be loaded', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/partners/pt1') return Promise.reject(new Error('nope'));
      return Promise.resolve({ data: [] });
    });
    render(<EditPartnerPage />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('surfaces a save failure at the top of the form', async () => {
    respond((path, init) => (path === '/partners' && init?.method === 'POST' ? Promise.reject(new Error('boom')) : null));
    render(<NewPartnerPage />);
    await screen.findByLabelText(/^Name/);

    await userEvent.type(screen.getByLabelText(/^Name/), 'Al Waha');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
