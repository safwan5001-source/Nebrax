// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AwjGlobalSearch } from './awj-global-search';

const apiMock = vi.hoisted(() => vi.fn());
const pushMock = vi.hoisted(() => vi.fn());

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: apiMock };
});

const { ApiError } = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');

function setUser(permissions: string[]) {
  localStorage.setItem(
    'user',
    JSON.stringify({ id: 'u1', name: 'Test', email: 't@t.com', role: 'staff', tenant_id: 't1', permissions })
  );
}

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  pushMock.mockReset();
  localStorage.clear();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

/** يقدّم زمن الـdebounce ويُصرّف كل الوعود المعلَّقة (نداء API + تحديث الحالة). */
async function settleDebounce(ms = 350) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('AwjGlobalSearch', () => {
  it('only offers search types the user actually has permission for', () => {
    setUser(['invoices.view', 'products.view']);
    render(<AwjGlobalSearch />);

    fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));
    const options = screen.getAllByRole('option').map((el) => el.textContent);

    expect(options).toContain('type_invoices');
    expect(options).toContain('type_products');
    expect(options).not.toContain('type_purchases');
    expect(options).not.toContain('type_journal_entries');
  });

  it('does not query the backend before 2 characters are typed', async () => {
    setUser(['invoices.view']);
    render(<AwjGlobalSearch />);

    fireEvent.change(screen.getByPlaceholderText('placeholder_all'), { target: { value: 'a' } });
    await settleDebounce(500);

    expect(apiMock).not.toHaveBeenCalled();
    expect(screen.getByText('min_chars')).toBeTruthy();
  });

  it('debounces the query, searches only allowed categories, and renders context-rich results', async () => {
    setUser(['invoices.view']);
    apiMock.mockResolvedValue({
      data: [
        { id: 'inv-1', number: 'INV-001', partner: { name: 'Acme' }, invoice_date: '2026-01-05', total: '150.00' },
      ],
    });

    render(<AwjGlobalSearch />);
    fireEvent.change(screen.getByPlaceholderText('placeholder_all'), { target: { value: 'INV' } });
    await settleDebounce();

    // فئة واحدة فقط مسموحة (فواتير) — نداء واحد لا أربعة.
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('/invoices?search=INV'));
    expect(screen.getByText('INV-001')).toBeTruthy();
    expect(screen.getByText(/Acme/)).toBeTruthy();

    fireEvent.click(screen.getByText('INV-001'));
    expect(pushMock).toHaveBeenCalledWith('/invoices/inv-1');
  });

  it('shows "no results" when the search comes back empty', async () => {
    setUser(['invoices.view']);
    apiMock.mockResolvedValue({ data: [] });

    render(<AwjGlobalSearch />);
    fireEvent.change(screen.getByPlaceholderText('placeholder_all'), { target: { value: 'zzz' } });
    await settleDebounce();

    expect(screen.getByText('no_results')).toBeTruthy();
  });

  it('does not let a 403 from one category break the rest of an "all" search', async () => {
    setUser(['invoices.view', 'products.view']);
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith('/invoices')) {
        return Promise.reject(new ApiError(403, 'forbidden', {}));
      }
      return Promise.resolve({ data: [{ id: 'p-1', name: 'Widget', sku: 'W-1' }] });
    });

    render(<AwjGlobalSearch />);
    fireEvent.change(screen.getByPlaceholderText('placeholder_all'), { target: { value: 'wid' } });
    await settleDebounce();

    expect(screen.getByText('Widget')).toBeTruthy();
  });
});
