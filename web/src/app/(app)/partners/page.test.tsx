// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PartnersPage from './page';

const { api, translate, partnerDialogSpy } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    title: 'Customers',
    add: 'Add partner',
    edit: 'Edit',
    name: 'Name',
    entity_type_customer: 'Customer kind',
    individual: 'Individual',
    commercial: 'Commercial',
    email: 'Email',
    phone: 'Phone',
    city: 'City',
    search: 'Search…',
    empty: 'No partners',
    present: 'Present',
    absent: 'Missing',
    sort_name_asc: 'Name: A–Z',
    sort_name_desc: 'Name: Z–A',
    load_error: 'Could not load customers.',
    retry: 'Try again',
  };
  // بديلٌ مبسّط لـ`t`: `rich` تُرجع القيم غير الدالّية فقط، فيكفي لتفعيل
  // مكوّنات `nebrax` التي تستدعيها — الترجمة الحقيقية مُختبَرة هناك.
  const translator = Object.assign((key: string) => strings[key] ?? key, {
    raw: () => ({}),
    rich: (key: string, values: Record<string, unknown> = {}) =>
      Object.values(values).filter((value) => typeof value !== 'function').join(' ') || (strings[key] ?? key),
  });
  return { api: vi.fn(), translate: translator, partnerDialogSpy: vi.fn() };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/components/partners/partner-dialog', () => ({
  PartnerDialog: (props: { open: boolean; partner: { name: string } | null }) => {
    partnerDialogSpy(props);
    return null;
  },
}));
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

const basePartner = {
  id: 'pt1', name: 'Al Tumooh Trading Co.', type: 'customer', entity_type: 'commercial',
  email: 'billing@altumooh.test', phone: '0555001122', city: 'Dammam',
};

function respondWith(partners: unknown[]) {
  api.mockImplementation(() => Promise.resolve({ data: partners }));
}

function respondWithError() {
  api.mockImplementation(() => Promise.reject(new Error('network down')));
}

/** سجلّ الجوال هو قائمة `DataTable` المقابلة للجدول — أول `ul` في الصفحة. */
async function firstMobileRecord() {
  const list = await screen.findByRole('list');
  return within(list).getAllByRole('listitem')[0];
}

describe('PartnersPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.mockReset();
    partnerDialogSpy.mockReset();
  });

  it('renders the header with a primary add action', async () => {
    respondWith([basePartner]);
    render(<PartnersPage />);

    expect(screen.getByRole('heading', { name: 'Customers' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Add partner' })).toBeTruthy();
  });

  it('shows a busy state before the data resolves', () => {
    api.mockImplementation(() => new Promise(() => {}));
    render(<PartnersPage />);

    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  });

  it('shows an error state on API failure, with a working retry', async () => {
    respondWithError();
    render(<PartnersPage />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();

    respondWith([basePartner]);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findAllByText('Al Tumooh Trading Co.')).length).toBeGreaterThan(0);
  });

  it('shows the empty state when there are genuinely no partners', async () => {
    respondWith([]);
    render(<PartnersPage />);

    expect(await screen.findByText('No partners')).toBeTruthy();
  });

  it('orders the mobile record: name, then phone, then classification, then city', async () => {
    respondWith([basePartner]);
    render(<PartnersPage />);

    const record = await firstMobileRecord();
    const text = record.textContent ?? '';
    expect(text.indexOf('Al Tumooh Trading Co.')).toBeLessThan(text.indexOf('0555001122'));
    expect(text.indexOf('0555001122')).toBeLessThan(text.indexOf('Commercial'));
    expect(text.indexOf('Commercial')).toBeLessThan(text.indexOf('Dammam'));
  });

  it('falls back to the partner id when there is no phone or email', async () => {
    respondWith([{ ...basePartner, phone: null, email: null }]);
    render(<PartnersPage />);

    const record = await firstMobileRecord();
    expect(within(record).getByText('pt1')).toBeTruthy();
  });

  it('opens the edit dialog with the selected partner', async () => {
    respondWith([basePartner]);
    render(<PartnersPage />);

    await screen.findAllByText('Al Tumooh Trading Co.');
    const editButtons = screen.getAllByRole('button', { name: 'Edit' });
    await userEvent.click(editButtons[0]);

    expect(partnerDialogSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, partner: expect.objectContaining({ id: 'pt1' }) })
    );
  });
});
