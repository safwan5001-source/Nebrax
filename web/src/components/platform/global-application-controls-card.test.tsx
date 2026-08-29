import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalApplicationControlsCard } from './global-application-controls-card';

const { platformApi, translate } = vi.hoisted(() => ({
  platformApi: vi.fn(),
  translate: (key: string, values?: Record<string, unknown>) => {
    const map: Record<string, string> = {
      title: 'Global application controls',
      subtitle: `Across ${values?.count ?? 0} tenants`,
      refresh: 'Refresh',
      loading: 'Loading',
      empty: 'No matching applications',
      search: 'Search applications',
      filterApps: 'Filter applications',
      filterAll: 'All applications',
      filterCommercial: 'Commercially gated',
      filterBuilt: 'Built non-mandatory',
      filterProtected: 'Protected',
      filterStatus: 'Filter status',
      statusAll: 'All statuses',
      statusMandatory: 'Mandatory',
      statusComingSoon: 'Coming soon',
      statusRetired: 'Retired',
      allAppsGrant: 'Grant all apps',
      allAppsRevert: 'Revert all apps',
      allAppsShow: 'Show all apps',
      allAppsHide: 'Hide all apps',
      grantAll: 'Grant all tenants',
      revertAll: 'Revert all tenants',
      showAll: 'Show all tenants',
      hideAll: 'Hide all tenants',
      rowActions: 'Application actions',
      previewTitle: 'Global control preview',
      previewOperation: 'Operation',
      previewLayer: 'Layer',
      previewTotal: 'Total tenants',
      previewWillApply: 'Will apply',
      previewSkipped: 'Will skip',
      previewFailed: 'Failed',
      previewSkipReasons: 'Skip reasons',
      previewTenant: 'Tenant',
      previewOutcome: 'Outcome',
      previewDetails: 'Details',
      reasonLabel: 'Reason',
      cancel: 'Cancel',
      applying: 'Applying',
      loadFailed: 'Load failed',
      previewFailed: 'Preview failed',
      applyFailed: 'Apply failed',
      'columns.app': 'Application',
      'columns.globalStatus': 'Global status',
      'columns.protected': 'Protection',
      'columns.actions': 'Actions',
      'counts.granted': `Granted ${values?.count ?? 0}`,
      'counts.enabled': `Enabled ${values?.count ?? 0}`,
      'counts.suspended': `Suspended ${values?.count ?? 0}`,
      'operations.grant_all_tenants': 'Grant all tenants',
      'layers.commercial': 'Commercial',
      'outcomes.applied': 'Will apply',
      'outcomes.skipped': 'Will skip',
      'outcomes.failed': 'Failed',
    };

    if (key === 'confirmApply') return `Apply to ${values?.count ?? 0} tenants`;
    if (key === 'applySummary') return `Applied ${values?.applied}, skipped ${values?.skipped}, failed ${values?.failed}`;

    return map[key] ?? key;
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: () => translate,
}));

vi.mock('@/lib/platform-api', () => ({ platformApi }));
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string, _body: unknown) {
      super(message);
      this.status = status;
    }
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

vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button> }));
vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock('@/components/ui/input', () => ({ Input: (props: React.ComponentProps<'input'>) => <input {...props} /> }));
vi.mock('@/components/ui/select', () => ({ Select: ({ children, ...props }: React.ComponentProps<'select'>) => <select {...props}>{children}</select> }));
vi.mock('@/components/ui/label', () => ({ Label: ({ children, ...props }: React.ComponentProps<'label'>) => <label {...props}>{children}</label> }));
vi.mock('@/components/ui/textarea', () => ({ Textarea: (props: React.ComponentProps<'textarea'>) => <textarea {...props} /> }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children, title }: { open: boolean; children: React.ReactNode; title: string }) => (
    open ? <div role="dialog" aria-label={title}>{children}</div> : null
  ),
}));
vi.mock('@/components/ui/dropdown', () => ({
  Dropdown: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownItem: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" disabled={disabled} onClick={onClick}>{children}</button>
  ),
}));

const summaryResponse = {
  data: {
    tenant_count: 2,
    applications: [{
      key: 'document_center.core',
      group: 'documents',
      maturity: 'built',
      mandatory: false,
      access: 'commercial',
      protected_status: null,
      global_commercial: { granted: 1, inherit: 1, denied: 0 },
      global_operational: { enabled: 1, disabled: 1, suspended: 0 },
      can_grant_all_tenants: true,
      can_revert_all_tenants: false,
      can_show_all_tenants: true,
      can_hide_all_tenants: true,
    }],
  },
};

describe('GlobalApplicationControlsCard', () => {
  beforeEach(() => {
    platformApi.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === '/platform/application-overrides/global/summary') return summaryResponse;
      if (path === '/platform/application-overrides/global/preview') {
        return {
          data: {
            request_id: 'req-1',
            operation: 'grant_all_tenants',
            application_key: 'document_center.core',
            layer: 'commercial',
            scope: { mode: 'all', total_tenants: 2, tenant_ids: null },
            counts: { eligible_tenants: 2, will_apply: 0, skipped: 2, failed: 0 },
            skip_reasons: { 'already granted': 2 },
            sample_tenants: [],
            protections: { mandatory: false, dependencies: [], maturity: 'built', coming_soon_blocked: false, retired_blocked: false },
          },
        };
      }
      return { data: {} };
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders global controls after loading summary', async () => {
    render(<GlobalApplicationControlsCard />);
    await waitFor(() => expect(screen.getByText('Global application controls')).toBeTruthy());
    expect(screen.getAllByText('document_center.core').length).toBeGreaterThan(0);
  });

  it('opens preview dialog and disables confirm when all tenants are skipped', async () => {
    render(<GlobalApplicationControlsCard />);
    await waitFor(() => expect(screen.getAllByTitle('Grant all tenants').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTitle('Grant all tenants')[0]);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Apply to 0 tenants' }).hasAttribute('disabled')).toBe(true);
  });

  it('returns nothing when platform manage permission is denied', async () => {
    const { ApiError } = await import('@/lib/api');
    platformApi.mockImplementationOnce(async () => {
      throw new ApiError(403, 'Forbidden', null);
    });
    const { container } = render(<GlobalApplicationControlsCard />);
    await waitFor(() => expect(platformApi).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
