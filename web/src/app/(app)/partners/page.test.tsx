// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PartnersPage from './page';

const { api, translate } = vi.hoisted(() => {
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
  return { api: vi.fn(), translate: translator };
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
  });

  // الإضافة صفحةٌ كاملة لا حوار: الحوار السريع لا يحمل رقماً ضريبياً ولا رمزاً
  // ولا رصيداً افتتاحياً، وكانت `/partners/new` بلا رابطٍ يصل إليها من القائمة.
  it('links the primary add action to the full create page', async () => {
    respondWith([basePartner]);
    render(<PartnersPage />);

    expect(screen.getByRole('heading', { name: 'Customers' })).toBeTruthy();
    const add = await screen.findByRole('link', { name: 'Add partner' });
    expect(add.getAttribute('href')).toBe('/partners/new');
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

  it('orders the mobile record: name, then phone, then city, then classification', async () => {
    respondWith([basePartner]);
    render(<PartnersPage />);

    const record = await firstMobileRecord();
    const text = record.textContent ?? '';
    expect(text.indexOf('Al Tumooh Trading Co.')).toBeLessThan(text.indexOf('0555001122'));
    expect(text.indexOf('0555001122')).toBeLessThan(text.indexOf('Dammam'));
    expect(text.indexOf('Dammam')).toBeLessThan(text.indexOf('Commercial'));
  });

  it('shows the city as a compact address line directly under the phone — name, then phone, then city', async () => {
    respondWith([basePartner]);
    render(<PartnersPage />);

    const record = await firstMobileRecord();
    const name = within(record).getByText('Al Tumooh Trading Co.');
    const phone = within(record).getByText('0555001122');
    const city = within(record).getByText('Dammam');

    const text = record.textContent ?? '';
    expect(text.indexOf(name.textContent!)).toBeLessThan(text.indexOf(phone.textContent!));
    expect(text.indexOf(phone.textContent!)).toBeLessThan(text.indexOf(city.textContent!));
    // مدينة نصّية لا مرجعاً رقمياً، فلا تحمل خط Mono الذي يحمله سطر التاريخ/المرجع.
    expect(city.className).not.toContain('num');
  });

  it('omits the city line when the partner has no city, without leaving a gap', async () => {
    respondWith([{ ...basePartner, city: null }]);
    render(<PartnersPage />);

    const record = await firstMobileRecord();
    expect(within(record).queryByText('Dammam')).toBeNull();
  });

  it('falls back to the partner id when there is no phone or email', async () => {
    respondWith([{ ...basePartner, phone: null, email: null }]);
    render(<PartnersPage />);

    const record = await firstMobileRecord();
    expect(within(record).getByText('pt1')).toBeTruthy();
  });

  it('links each row edit action to that partner full edit page', async () => {
    respondWith([basePartner]);
    render(<PartnersPage />);

    await screen.findAllByText('Al Tumooh Trading Co.');
    const editLinks = screen.getAllByRole('link', { name: 'Edit' });
    expect(editLinks[0].getAttribute('href')).toBe('/partners/pt1/edit');
  });
});
