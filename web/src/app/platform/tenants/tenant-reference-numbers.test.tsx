import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlatformTenantsPage from './page';
import PlatformTenantDetailPage from './[id]/page';

const { platformApi, clipboardWriteText, routerPush, translate } = vi.hoisted(() => ({
  platformApi: vi.fn(),
  clipboardWriteText: vi.fn(),
  routerPush: vi.fn(),
  translate: (key: string) => ({
    title: 'Tenants', subtitle: 'Tenant operations', back: 'Back', search: 'Search by account number',
    name: 'Organization', accountNumber: 'Account number', supportNumber: 'Support number',
    contactName: 'Owner name', contact: 'Owner email', phone: 'Phone', plan: 'Plan', status: 'Status',
    filterByPlan: 'Filter by plan', allPlans: 'All plans', filterByStatus: 'Filter by status', allStatuses: 'All statuses',
    trialEndsAt: 'Trial ends', usersCount: 'Users', active: 'Active', inactive: 'Inactive', noTrial: 'No trial',
    loadFailed: 'Load failed', retry: 'Retry', empty: 'No tenants', detailTitle: 'Tenant details',
    activeUsers: 'Active users', totalUsers: 'Total users', registeredOn: 'Registered on', currentPlan: 'Current plan',
    changePlan: 'Change plan', savePlan: 'Save plan', trialManagement: 'Trial management', newTrialEndDate: 'Trial date',
    clearTrial: 'Clear trial', saveTrial: 'Save trial', accessManagement: 'Access management', accessNotice: 'Access notice',
    deactivate: 'Deactivate', activate: 'Activate', auditNotice: 'Audit notice', copyReference: 'Copy number',
    referenceCopied: 'Number copied.', commercialOperations: 'Commercial operations',
  }[key] ?? key),
}));

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPush, replace: routerPush }), useParams: () => ({ id: 'tenant-1' }) }));
vi.mock('@/lib/platform-auth', () => ({ isPlatformAuthenticated: () => true }));
vi.mock('@/lib/platform-api', () => ({ platformApi }));
vi.mock('@/lib/api', () => ({ ApiError: class ApiError extends Error {} }));
vi.mock('@/components/platform/contract-management-card', () => ({ ContractManagementCard: () => <div /> }));
vi.mock('@/components/platform/commercial-operations-card', () => ({ CommercialOperationsCard: () => <div /> }));
vi.mock('@/components/platform/application-override-card', () => ({ ApplicationOverrideCard: () => <div /> }));
vi.mock('@/components/platform/global-application-controls-card', () => ({ GlobalApplicationControlsCard: () => <div data-testid="global-application-controls" /> }));
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
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@/components/ui/card', () => ({ Card: ({ children }: any) => <section>{children}</section>, CardContent: ({ children }: any) => <div>{children}</div>, CardHeader: ({ children }: any) => <header>{children}</header>, CardTitle: ({ children }: any) => <h2>{children}</h2> }));
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@/components/ui/input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@/components/ui/select', () => ({ Select: ({ children, ...props }: any) => <select {...props}>{children}</select> }));
vi.mock('@/components/ui/skeleton', () => ({ Skeleton: () => <div /> }));
vi.mock('@/components/data-table', () => ({
  DataTable: ({ data, searchValue, onSearchChange, searchPlaceholder }: any) => (
    <div>
      <input aria-label={searchPlaceholder} value={searchValue} onChange={(event) => onSearchChange(event.target.value)} />
      {data.map((row: any) => <p key={row.id}>{`${row.name} ${row.account_number} ${row.support_number}`}</p>)}
    </div>
  ),
}));

const tenant = {
  id: 'tenant-1', name: 'Reference Co', slug: 'reference-co', account_number: 1000000, support_number: 1000,
  plan: 'free', is_active: true, trial_ends_at: null, subscription_ends_at: null, created_at: '2026-08-23',
  users_count: 1, active_users_count: 1, contact: { name: 'Owner', email: 'owner@reference.test', phone: null }, subscriptions: [],
};

describe('tenant reference numbers in Platform Admin', () => {
  afterEach(cleanup);

  beforeEach(() => {
    platformApi.mockReset();
    clipboardWriteText.mockReset();
    routerPush.mockReset();
    Object.assign(navigator, { clipboard: { writeText: clipboardWriteText } });
    platformApi.mockImplementation((path: string) => Promise.resolve(path === '/platform/tenants/tenant-1'
      ? { data: tenant }
      : { data: [tenant], pagination: { current_page: 1, last_page: 1, per_page: 100, total: 1 } }));
  });

  it('displays both numbers and forwards numeric search to the protected platform endpoint', async () => {
    render(<PlatformTenantsPage />);

    expect(await screen.findByText('Reference Co 1000000 1000')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search by account number' }), { target: { value: '1000' } });

    await waitFor(() => expect(platformApi).toHaveBeenCalledWith('/platform/tenants?per_page=100&search=1000'));
  });

  it('displays the numbers on tenant detail and copies the selected identifier', async () => {
    render(<PlatformTenantDetailPage />);

    expect(await screen.findByText('1000000')).toBeTruthy();
    expect(screen.getByText('1000')).toBeTruthy();
    expect(screen.getByText('1000000').parentElement?.getAttribute('dir')).toBe('ltr');

    fireEvent.click(screen.getAllByRole('button', { name: 'Copy number' })[0]);
    await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledWith('1000000'));
  });
});
