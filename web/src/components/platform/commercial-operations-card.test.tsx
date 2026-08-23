import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommercialOperationsCard } from './commercial-operations-card';

const { platformApi, translate } = vi.hoisted(() => ({
  platformApi: vi.fn(),
  translate: (key: string) => ({
    subscriptionApplications: 'Subscription & Applications',
    subscriptionApplicationsNotice: 'Authoritative commercial operations',
    retry: 'Retry',
    assignApplication: 'Assign application',
    currentCommercialPlan: 'Current commercial plan',
    noCommercialPlan: 'No commercial plan',
    includedProducts: 'Included products',
    activeAddons: 'Active add-ons',
    activeTrials: 'Active trials',
    applicationProducts: 'Products & applications',
    applicationProductsNotice: 'Separate statuses',
    operationalReadOnly: 'Operational state is read-only',
    noCommercialProducts: 'No products',
    commercialProduct: 'Commercial product',
    commercialStatusLabel: 'Commercial status',
    effectiveAccessLabel: 'Effective access',
    operationalStateLabel: 'Operational state',
    legacyEntitlements: 'Legacy entitlements',
    noLegacyEntitlements: 'No legacy entitlements',
    endedAssignments: 'Ended assignments',
    noEndedAssignments: 'No ended assignments',
    none: 'None',
    unknownProduct: 'Unknown product',
    commercialHistory: 'Commercial assignment history',
    commercialHistoryNotice: 'History is retained',
    noCommercialHistory: 'No commercial history',
    accessInspector: 'Access inspector',
    accessInspectorNotice: 'Inspector explanation',
    capabilityKey: 'Capability key',
    selectCapability: 'Select capability',
    operationClass: 'Operation class',
    inspectAccess: 'Inspect access',
    commercialSources: 'Commercial sources',
    applicationState: 'Application state',
    dependenciesLabel: 'Dependencies',
    rbacLabel: 'RBAC',
    rbacNotEvaluated: 'RBAC not evaluated',
    finalDecision: 'Final decision',
    assignmentDialogNotice: 'Preview first',
    assignmentType: 'Assignment type',
    assignmentTypeAddon: 'Add-on',
    assignmentTypePlan: 'Plan',
    assignmentTypeTrial: 'Trial',
    trialTarget: 'Trial target',
    selectProduct: 'Select product',
    selectVersion: 'Select version',
    productVersion: 'Product version',
    planVersion: 'Plan version',
    startDate: 'Start date',
    endDateOptional: 'End date (optional)',
    trialDurationDays: 'Trial duration',
    previewAssignment: 'Preview assignment',
    applyAssignment: 'Apply assignment',
    assignmentPreview: 'Preview before apply',
    idempotentAssignment: 'Matching assignment',
    previewCapabilities: 'Capabilities',
    previewExistingGrants: 'Existing grants',
    previewNewGrants: 'Grants to create',
    previewResult: 'Resulting access',
    previewConflicts: 'Conflicts',
    close: 'Close',
    reason: 'Reason',
    commercialLoadFailed: 'Load failed',
    commercialPreviewFailed: 'Preview failed',
    commercialApplyFailed: 'Apply failed',
    commercialActionFailed: 'Action failed',
    commercialFormMissing: 'Missing form data',
    'commercialStatus.addon': 'Add-on',
    'commercialStatus.not_assigned': 'Not assigned',
    'commercialStatus.included': 'Included',
    'commercialStatus.trial': 'Trial',
    'commercialStatus.scheduled': 'Scheduled cancellation',
    'commercialStatus.cancelled': 'Cancelled',
    'commercialStatus.expired': 'Expired',
    'commercialStatus.revoked': 'Revoked',
    'effectiveAccess.full': 'Full',
    'effectiveAccess.read_only': 'Read-only',
    'effectiveAccess.denied': 'Denied',
    'operationalState.enabled': 'Enabled',
    'operationalState.disabled': 'Disabled',
    'operationalState.suspended': 'Suspended',
    'operation.read': 'Read',
    'operation.write': 'Write',
    'operation.transition': 'Transition',
    'operation.destructive': 'Destructive',
    'operation.export': 'Export',
  }[key] ?? key),
}));

vi.mock('next-intl', () => ({ useTranslations: () => translate }));

vi.mock('@/lib/platform-api', () => ({ platformApi }));
vi.mock('lucide-react', () => ({
  Boxes: () => <span />, CalendarClock: () => <span />, Eye: () => <span />, Plus: () => <span />,
  RefreshCw: () => <span />, Search: () => <span />, ShieldCheck: () => <span />, XCircle: () => <span />,
}));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: any) => <section>{children}</section>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <header>{children}</header>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@/components/ui/dialog', () => ({ Dialog: ({ open, title, children }: any) => open ? <section aria-label={title}><h2>{title}</h2>{children}</section> : null }));
vi.mock('@/components/ui/input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@/components/ui/select', () => ({ Select: ({ children, ...props }: any) => <select {...props}>{children}</select> }));
vi.mock('@/components/ui/label', () => ({ Label: ({ children, ...props }: any) => <label {...props}>{children}</label> }));
vi.mock('@/components/ui/textarea', () => ({ Textarea: (props: any) => <textarea {...props} /> }));

const applicationsResponse = {
  applications: [{
    key: 'fuel_stations.core', group: 'operations', maturity: 'built', mandatory: false, dependencies: [], enabled: false,
    status: 'suspended', changed_at: null, reason: 'Existing operational evidence',
    commercial: { availability: 'addon', source_count: 1, source_types: ['addon'], trial_until: null, cancels_at: null, expired: false },
    effective_access: 'full', dependency_status: 'not_applicable',
  }],
  commercial_summary: { current_plan: null, included_products: [], active_addons: [], trials: [], legacy_entitlements: [], ended_assignments: [] },
};

const catalogResponse = {
  products: [{ id: 'fuel-product', code: 'fuel-stations', name: 'Fuel Stations', versions: [{ id: 'fuel-version', version: 1, published_at: '2026-08-01T00:00:00Z', retired_at: null, capabilities: ['fuel_stations.core'] }] }],
  plans: [],
};

describe('CommercialOperationsCard', () => {
  afterEach(cleanup);

  beforeEach(() => {
    platformApi.mockReset();
    platformApi.mockImplementation((path: string) => {
      if (path.endsWith('/commercial-applications')) return Promise.resolve({ data: applicationsResponse });
      if (path === '/platform/commercial-catalog') return Promise.resolve({ data: catalogResponse });
      if (path.endsWith('/commercial-assignments')) return Promise.resolve({ data: [] });
      if (path.endsWith('/preview')) return Promise.resolve({ data: {
        source_type: 'addon', target_version_id: 'fuel-version', starts_at: '2026-08-23T00:00:00Z', ends_at: null,
        products: ['fuel-stations'], capabilities: ['fuel_stations.core'], existing_grants: [],
        grants_to_create: [{ capability_key: 'fuel_stations.core', access_mode: 'full' }], conflicts: [],
        resulting_effective_access: [{ capability_key: 'fuel_stations.core', access_mode: 'full' }], idempotent_existing: false,
      } });
      return Promise.resolve({ data: { id: 'assignment-1' } });
    });
  });

  it('renders commercial status, effective access, and operational state independently', async () => {
    render(<CommercialOperationsCard tenantId="tenant-1" />);

    expect((await screen.findAllByText('Fuel Stations')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not assigned').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Full').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Suspended').length).toBeGreaterThan(0);
  });

  it('requires preview before applying an add-on assignment', async () => {
    const user = userEvent.setup();
    render(<CommercialOperationsCard tenantId="tenant-1" />);
    await screen.findAllByText('Fuel Stations');

    await user.click(screen.getByRole('button', { name: 'Assign application' }));
    fireEvent.change(screen.getByLabelText('Commercial product'), { target: { value: 'fuel-stations' } });
    fireEvent.change(screen.getByLabelText('Product version'), { target: { value: 'fuel-version' } });

    const apply = screen.getByRole('button', { name: 'Apply assignment' });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Preview assignment' }));

    expect(await screen.findByText('Preview before apply')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Apply assignment' }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Apply assignment' }));

    await waitFor(() => expect(platformApi).toHaveBeenCalledWith(
      '/platform/tenants/tenant-1/commercial-assignments/addon',
      expect.objectContaining({ method: 'POST' }),
    ));
  });
});
