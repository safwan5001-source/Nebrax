// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ApplicationsPage from './page';

const { api, currentUser, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    title: 'Application Management',
    subtitle: 'Application controls',
    experienceTitle: 'Applications',
    experienceSubtitle: 'Operational controls',
    allTab: 'All',
    noAccess: 'No access',
    loadFailed: 'Load failed',
    saveFailed: 'Save failed',
    mandatoryBadge: 'Mandatory',
    comingSoonBadge: 'Coming soon',
    enabledBadge: 'Enabled',
    disabledBadge: 'Disabled',
    suspendedBadge: 'Suspended',
    enable: 'Enable',
    disable: 'Disable',
    emptyTitle: 'No applications',
    securityNotice: 'Security notice',
    'columns.name': 'Application',
    'columns.group': 'Group',
    'columns.commercial': 'Commercial',
    'columns.access': 'Effective access',
    'columns.operational': 'Operational',
    'columns.dependencies': 'Dependencies',
    'columns.actions': 'Actions',
    'commercial.trial': 'Trial',
    'commercial.addon': 'Add-on',
    'commercial.included': 'Included',
    'access.full': 'Full',
    'access.denied': 'Denied',
    'dependencies.notApplicable': 'None',
    'dependencies.missing': 'Missing',
    'actions.unavailable': 'Unavailable',
    'actions.blocked.access_denied': 'Activation is unavailable because effective access is denied.',
    'actions.blocked.dependencies_missing': 'Enable the required dependencies before activating this application.',
  };
  const translator = Object.assign((key: string) => strings[key] ?? key, {
    raw: (key: string) => {
      if (key === 'groups') return { fuel_stations: 'Fuel Stations' };
      if (key === 'keys') return {
        fuel_trial: 'Fuel trial',
        fuel_addon: 'Fuel add-on',
        fuel_included: 'Fuel included',
        fuel_denied: 'Fuel denied',
        fuel_dependency: 'Fuel dependency',
      };
      return {};
    },
  });
  return { api: vi.fn(), currentUser: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('@/lib/auth', () => ({ currentUser }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('lucide-react', () => ({
  Boxes: () => <span />, CircleAlert: () => <span />, Clock3: () => <span />, LayoutGrid: () => <span />, ShieldCheck: () => <span />,
}));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: any) => <section>{children}</section>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <header>{children}</header>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock('@/components/ui/dialog', () => ({ Dialog: () => null }));
vi.mock('@/components/ui/label', () => ({ Label: ({ children }: any) => <label>{children}</label> }));
vi.mock('@/components/ui/textarea', () => ({ Textarea: (props: any) => <textarea {...props} /> }));
vi.mock('@/components/ui/tabs', () => ({ Tabs: () => null }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const app = (key: string, availability: 'trial' | 'addon' | 'included', overrides = {}) => ({
  key,
  group: 'fuel_stations',
  maturity: 'built' as const,
  mandatory: false,
  dependencies: [],
  enabled: false,
  status: 'disabled' as const,
  changed_by: null,
  changed_at: null,
  reason: null,
  commercial: { availability, source_count: 1 },
  effective_access: 'full' as const,
  dependency_status: 'not_applicable' as const,
  ...overrides,
});

function rowFor(label: string) {
  const labelInTable = screen.getAllByText(label).find((element) => element.closest('tr'));
  if (!labelInTable) throw new Error(`Expected a table row for ${label}`);
  return labelInTable.closest('tr') as HTMLTableRowElement;
}

describe('ApplicationsPage operational actions', () => {
  afterEach(cleanup);

  beforeEach(() => {
    currentUser.mockReturnValue({ role: 'admin' });
    api.mockResolvedValue({ data: {
      fuel_trial: app('fuel_trial', 'trial'),
      fuel_addon: app('fuel_addon', 'addon'),
      fuel_included: app('fuel_included', 'included'),
      fuel_denied: app('fuel_denied', 'trial', { effective_access: 'denied' }),
      fuel_dependency: app('fuel_dependency', 'addon', {
        dependencies: ['fuel_stations.core'],
        dependency_status: 'missing',
      }),
    } });
  });

  it('enables disabled built applications with full access regardless of trial, add-on, or included commercial metadata', async () => {
    await render(<ApplicationsPage />);
    await screen.findAllByText('Fuel trial');

    for (const label of ['Fuel trial', 'Fuel add-on', 'Fuel included']) {
      expect((within(rowFor(label)).getByRole('button', { name: 'Enable' }) as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it('keeps denied access unavailable and explains dependency blocks without offering activation', async () => {
    await render(<ApplicationsPage />);
    await screen.findAllByText('Fuel denied');

    expect((within(rowFor('Fuel denied')).getByRole('button', { name: 'Enable' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(rowFor('Fuel denied')).getByText('Activation is unavailable because effective access is denied.')).toBeTruthy();

    expect((within(rowFor('Fuel dependency')).getByRole('button', { name: 'Enable' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(rowFor('Fuel dependency')).getByText('Enable the required dependencies before activating this application.')).toBeTruthy();
  });
});
