/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlatformTenantsPage from './page';

const { platformApi, routerReplace, ApiError, authed, router } = vi.hoisted(() => {
  class ApiError extends Error {}
  const routerReplace = vi.fn();
  return {
    platformApi: vi.fn(),
    routerReplace,
    ApiError,
    authed: { value: true },
    router: { replace: routerReplace, push: vi.fn() },
  };
});

const messages: Record<string, string> = {
  title: 'Tenants',
  subtitle: 'Tenant operations',
  back: 'Back',
  search: 'Search tenants',
  filterByPlan: 'Filter by plan',
  allPlans: 'All plans',
  filterByStatus: 'Filter by status',
  allStatuses: 'All statuses',
  pageFilterNote: 'Filters apply to this page only.',
  refresh: 'Refresh',
  retry: 'Retry',
  empty: 'No tenants',
  loadFailed: 'Load failed',
  active: 'Active',
  inactive: 'Inactive',
  resultsNavigation: 'Results',
  perPage: 'Rows per page',
  previousPage: 'Previous page',
  nextPage: 'Next page',
};

const translate = Object.assign((key: string) => messages[key] ?? key, {
  rich: (key: string, values?: { n?: number; page?: string }) => {
    if (key === 'resultCount') return `total:${values?.n}`;
    if (key === 'pagePosition') return `pos:${values?.page}`;
    return messages[key] ?? key;
  },
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/platform-auth', () => ({ isPlatformAuthenticated: () => authed.value }));
vi.mock('@/lib/platform-api', () => ({ platformApi }));
vi.mock('@/lib/api', () => ({ ApiError }));
vi.mock('@/components/platform/global-application-controls-card', () => ({
  GlobalApplicationControlsCard: () => <div data-testid="global-application-controls" />,
}));
vi.mock('lucide-react', () => {
  const icon = ({ className }: { className?: string }) => <svg className={className} />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) =>
      typeof name === 'symbol' || name === 'then' || name === '__esModule'
        ? Reflect.get(target, name)
        : icon,
    has: () => true,
  });
});
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, asChild: _asChild, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children?: React.ReactNode }) => <section>{children}</section>,
  CardContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props}>{children}</select>,
}));
vi.mock('@/components/data-table', () => ({
  DataTable: ({
    data,
    loading,
    emptyLabel,
    searchValue,
    onSearchChange,
    searchPlaceholder,
  }: {
    data: Array<{ id: string; name: string }>;
    loading?: boolean;
    emptyLabel?: string;
    searchValue?: string;
    onSearchChange?: (value: string) => void;
    searchPlaceholder?: string;
  }) => (
    <div>
      <input
        aria-label={searchPlaceholder}
        value={searchValue}
        onChange={(event) => onSearchChange?.(event.target.value)}
      />
      {loading ? <div role="status">loading</div> : null}
      {!loading && data.length === 0 ? <p>{emptyLabel}</p> : null}
      {data.map((row) => <p key={row.id}>{row.name}</p>)}
    </div>
  ),
}));

function tenant(id: string, name: string, plan = 'pro', active = true) {
  return {
    id,
    name,
    slug: id,
    account_number: 1000000,
    support_number: 1000,
    plan,
    is_active: active,
    trial_ends_at: null,
    users_count: 2,
    contact: null,
  };
}

function payload(page: number, lastPage: number, rows: ReturnType<typeof tenant>[], total: number, perPage = 25) {
  return {
    data: rows,
    pagination: { current_page: page, last_page: lastPage, per_page: perPage, total },
  };
}

function pageOf(path: string): string | null {
  return new URL(path, 'http://platform.local').searchParams.get('page');
}

describe('platform tenant pagination', () => {
  beforeEach(() => {
    platformApi.mockReset();
    routerReplace.mockReset();
    authed.value = true;
    document.documentElement.dir = 'rtl';
  });

  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute('dir');
  });

  it('requests page 2, renders those rows, and counts pagination.total rather than the page length', async () => {
    platformApi.mockImplementation((path: string) => Promise.resolve(
      pageOf(path) === '2'
        ? payload(2, 5, [tenant('late', 'After First Hundred')], 120)
        : payload(1, 5, [tenant('early', 'First Page Co')], 120),
    ));

    render(<PlatformTenantsPage />);

    expect(await screen.findByText('First Page Co')).toBeTruthy();
    expect(platformApi).toHaveBeenCalledWith('/platform/tenants?per_page=25&page=1');
    expect(screen.getByText(/total:120/)).toBeTruthy();
    expect(screen.queryByText('total:1')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    expect(await screen.findByText('After First Hundred')).toBeTruthy();
    expect(screen.queryByText('First Page Co')).toBeNull();
    expect(platformApi).toHaveBeenCalledWith('/platform/tenants?per_page=25&page=2');
    expect(screen.getByText(/total:120/)).toBeTruthy();
  });

  it('reaches the page after the first hundred tenants', async () => {
    platformApi.mockImplementation((path: string) => {
      const page = Number(pageOf(path) ?? '1');
      return Promise.resolve(payload(page, 5, [tenant(`p${page}`, `Tenant page ${page}`)], 125));
    });

    render(<PlatformTenantsPage />);
    expect(await screen.findByText('Tenant page 1')).toBeTruthy();

    for (let page = 2; page <= 5; page += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      expect(await screen.findByText(`Tenant page ${page}`)).toBeTruthy();
    }

    expect(platformApi).toHaveBeenCalledWith('/platform/tenants?per_page=25&page=5');
    expect(screen.getByText(/total:125/)).toBeTruthy();
  });

  it('resets to page 1 when the search changes and when the page size changes', async () => {
    platformApi.mockImplementation((path: string) => {
      const url = new URL(path, 'http://platform.local');
      const page = url.searchParams.get('page');
      const search = url.searchParams.get('search');
      if (search === '1000') return Promise.resolve(payload(1, 1, [tenant('found', 'Matched Co')], 1));
      if (page === '2') return Promise.resolve(payload(2, 3, [tenant('second', 'Second Co')], 60));
      if (url.searchParams.get('per_page') === '50') return Promise.resolve(payload(1, 2, [tenant('wider', 'Wider Page')], 60, 50));
      return Promise.resolve(payload(1, 3, [tenant('first', 'First Co')], 60));
    });

    render(<PlatformTenantsPage />);
    expect(await screen.findByText('First Co')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Second Co')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search tenants' }), { target: { value: '1000' } });

    await waitFor(() => expect(platformApi).toHaveBeenCalledWith('/platform/tenants?per_page=25&page=1&search=1000'));
    expect(await screen.findByText('Matched Co')).toBeTruthy();
    expect(platformApi.mock.calls.some(([path]) => String(path).includes('page=2&search=1000'))).toBe(false);

    fireEvent.change(screen.getByRole('textbox', { name: 'Search tenants' }), { target: { value: '' } });
    expect(await screen.findByText('First Co')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Second Co')).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), { target: { value: '50' } });
    await waitFor(() => expect(platformApi).toHaveBeenCalledWith('/platform/tenants?per_page=50&page=1'));
    expect(await screen.findByText('Wider Page')).toBeTruthy();
  });

  it('filters plan and status on the loaded page only and says so', async () => {
    platformApi.mockResolvedValue(payload(1, 4, [
      tenant('free-row', 'Free Co', 'free', true),
      tenant('pro-row', 'Pro Co', 'pro', false),
    ], 80));

    render(<PlatformTenantsPage />);
    expect(await screen.findByText('Free Co')).toBeTruthy();
    expect(screen.getByText('Filters apply to this page only.')).toBeTruthy();
    expect(screen.getByText(/total:80/)).toBeTruthy();
    const calls = platformApi.mock.calls.length;

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by plan' }), { target: { value: 'pro' } });
    expect(screen.queryByText('Free Co')).toBeNull();
    expect(screen.getByText('Pro Co')).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by status' }), { target: { value: 'true' } });
    expect(screen.queryByText('Pro Co')).toBeNull();
    expect(screen.getByText('No tenants')).toBeTruthy();
    expect(screen.getByText(/total:80/)).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(platformApi.mock.calls.length).toBe(calls);
    expect(platformApi.mock.calls.every(([path]) => !String(path).includes('plan=') && !String(path).includes('status='))).toBe(true);
  });

  it('shows the loading state, then an error, and retries the same page', async () => {
    let rejectLoad: (reason: unknown) => void = () => {};
    platformApi.mockImplementation((path: string) => {
      if (pageOf(path) === '2') {
        return new Promise((_resolve, reject) => {
          rejectLoad = reject;
        });
      }
      return Promise.resolve(payload(1, 2, [tenant('ready', 'Ready Co')], 30));
    });

    render(<PlatformTenantsPage />);
    expect(screen.getByRole('status').textContent).toBe('loading');
    expect(await screen.findByText('Ready Co')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByRole('status')).toBeTruthy();
    rejectLoad(new ApiError('blocked'));

    expect((await screen.findByRole('alert')).textContent).toContain('blocked');
    platformApi.mockResolvedValue(payload(2, 2, [tenant('recovered', 'Recovered Co')], 30));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Recovered Co')).toBeTruthy();
    expect(platformApi).toHaveBeenLastCalledWith('/platform/tenants?per_page=25&page=2');
  });

  it('corrects a page past the end once, and keeps direction and breakpoint classes', async () => {
    platformApi.mockImplementation((path: string) => Promise.resolve(
      pageOf(path) === '2'
        ? payload(2, 2, [tenant('kept', 'Kept Co')], 40)
        : payload(9, 2, [], 40),
    ));

    render(<PlatformTenantsPage />);

    expect(await screen.findByText('Kept Co')).toBeTruthy();
    expect(platformApi.mock.calls.map(([path]) => path)).toEqual([
      '/platform/tenants?per_page=25&page=1',
      '/platform/tenants?per_page=25&page=2',
    ]);
    expect(screen.getByRole('navigation', { name: 'Results' }).className).toContain('flex-col');
    expect(screen.getByRole('navigation', { name: 'Results' }).className).toContain('sm:flex-row');
    expect(document.querySelector('header [class*="lg:flex-row"]')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Filter by plan' }).parentElement?.className).toContain('flex-wrap');
    expect(document.querySelector('main')?.getAttribute('dir')).toBeNull();
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.querySelector('svg[class*="rtl:rotate-180"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
  });

  it('does not call the platform API when the operator is signed out', async () => {
    authed.value = false;
    render(<PlatformTenantsPage />);
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/platform/login'));
    expect(platformApi).not.toHaveBeenCalled();
  });

  it('keeps the newest page, page size, search, and out-of-range correction when older responses arrive later', async () => {
    const queue: Array<{ path: string; resolve: (value: unknown) => void; reject: (reason?: unknown) => void }> = [];
    platformApi.mockImplementation((path: string) => new Promise((resolve, reject) => {
      queue.push({ path, resolve, reject });
    }));
    const take = async (part: string) => {
      await waitFor(() => expect(queue.some((entry) => entry.path.includes(part))).toBe(true));
      const index = queue.findIndex((entry) => entry.path.includes(part));
      return queue.splice(index, 1)[0];
    };

    render(<PlatformTenantsPage />);
    const first = await take('page=1');
    await act(async () => {
      first.resolve(payload(1, 5, [tenant('first', 'First Co')], 80));
    });
    expect(await screen.findByText('First Co')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    const second = await take('page=2');
    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), { target: { value: '50' } });
    const wider = await take('per_page=50');

    await act(async () => {
      wider.resolve(payload(1, 2, [tenant('wide', 'Wider Co')], 80, 50));
    });
    expect(await screen.findByText('Wider Co')).toBeTruthy();
    await act(async () => {
      second.resolve(payload(2, 5, [tenant('stale-page', 'Stale Page Co')], 80));
    });
    expect(screen.queryByText('Stale Page Co')).toBeNull();
    expect(screen.getByText('Wider Co')).toBeTruthy();
    expect(screen.getByText(/total:80/)).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search tenants' }), { target: { value: 'matched' } });
    const matched = await take('search=matched');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tenants' }), { target: { value: 'newer' } });
    const newer = await take('search=newer');
    await act(async () => {
      newer.resolve(payload(1, 1, [tenant('new', 'Newer Co')], 1));
    });
    expect(await screen.findByText('Newer Co')).toBeTruthy();
    await act(async () => {
      matched.resolve(payload(1, 1, [tenant('old-search', 'Older Search Co')], 1));
    });
    expect(screen.queryByText('Older Search Co')).toBeNull();
    expect(screen.queryByText('Matched Co')).toBeNull();
    expect(screen.getByText('Newer Co')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search tenants' }), { target: { value: '' } });
    const cleared = await take('per_page=50&page=1');
    await act(async () => {
      cleared.resolve(payload(1, 4, [tenant('cleared', 'Cleared Co')], 80, 50));
    });
    expect(await screen.findByText('Cleared Co')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    const overshot = await take('page=2');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tenants' }), { target: { value: 'owned' } });
    await act(async () => {
      overshot.resolve(payload(9, 2, [tenant('overshoot', 'Overshoot Co')], 40));
    });
    expect(screen.queryByText('Overshoot Co')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    const owned = await take('search=owned');
    await act(async () => {
      owned.resolve(payload(1, 1, [tenant('owner', 'Owned Co')], 1));
    });
    expect(await screen.findByText('Owned Co')).toBeTruthy();
    expect(screen.queryByText('Overshoot Co')).toBeNull();
    expect(screen.queryByText('Cleared Co')).toBeNull();
    expect(screen.getByText(/total:1/)).toBeTruthy();
    expect(platformApi.mock.calls.filter(([path]) => String(path).includes('search=owned')).length).toBe(1);
  });

  it('ignores a stale failure after a newer success, and a stale success after a newer failure', async () => {
    const queue: Array<{ path: string; resolve: (value: unknown) => void; reject: (reason?: unknown) => void }> = [];
    platformApi.mockImplementation((path: string) => new Promise((resolve, reject) => {
      queue.push({ path, resolve, reject });
    }));
    const take = async (part: string) => {
      await waitFor(() => expect(queue.some((entry) => entry.path.includes(part))).toBe(true));
      const index = queue.findIndex((entry) => entry.path.includes(part));
      return queue.splice(index, 1)[0];
    };

    render(<PlatformTenantsPage />);
    const first = await take('page=1');
    await act(async () => {
      first.resolve(payload(1, 4, [tenant('first', 'First Co')], 40));
    });
    expect(await screen.findByText('First Co')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    const second = await take('page=2');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tenants' }), { target: { value: 'current' } });
    const current = await take('search=current');
    expect(screen.getByRole('status').textContent).toBe('loading');

    await act(async () => {
      second.reject(new ApiError('stale failure'));
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('loading');

    await act(async () => {
      current.resolve(payload(1, 1, [tenant('current', 'Current Co')], 1));
    });
    expect(await screen.findByText('Current Co')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), { target: { value: '100' } });
    const lateSuccess = await take('per_page=100');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tenants' }), { target: { value: 'broken' } });
    const broken = await take('search=broken');
    await act(async () => {
      broken.reject(new ApiError('newest failed'));
    });
    expect((await screen.findByRole('alert')).textContent).toContain('newest failed');
    expect(screen.queryByText('Current Co')).toBeNull();

    await act(async () => {
      lateSuccess.resolve(payload(1, 1, [tenant('late', 'Late Success Co')], 40, 100));
    });
    expect(screen.queryByText('Late Success Co')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('newest failed');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const retried = await take('search=broken');
    await act(async () => {
      retried.resolve(payload(1, 1, [tenant('retried', 'Retried Co')], 1));
    });
    expect(await screen.findByText('Retried Co')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
