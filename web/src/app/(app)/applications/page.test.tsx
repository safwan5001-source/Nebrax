// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    reasonLabel: 'Reason',
    enabledToast: 'Enabled',
    disabledToast: 'Disabled',
    cancel: 'Cancel',
    loading: 'Loading',
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

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
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
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, title, children }: any) => open ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));
vi.mock('@/components/ui/label', () => ({ Label: ({ children, ...props }: any) => <label {...props}>{children}</label> }));
vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange, ...props }: any) => (
    <button role="switch" aria-checked={checked} onClick={() => onCheckedChange?.(!checked)} {...props} />
  ),
}));
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
  group_enabled: true,
  status: 'disabled' as const,
  changed_by: null,
  changed_at: null,
  reason: null,
  commercial: { availability, source_count: 1 },
  effective_access: 'full' as const,
  dependency_status: 'not_applicable' as const,
  ...overrides,
});

const group = {
  key: 'fuel_stations',
  enabled: true,
  manageable: true,
  changed_by: null,
  changed_at: null,
  reason: null,
  capabilities: ['fuel_trial', 'fuel_addon', 'fuel_included', 'fuel_denied', 'fuel_dependency'],
};

const response = () => ({
  data: {
    fuel_trial: app('fuel_trial', 'trial'),
    fuel_addon: app('fuel_addon', 'addon'),
    fuel_included: app('fuel_included', 'included'),
    fuel_denied: app('fuel_denied', 'trial', { effective_access: 'denied' }),
    fuel_dependency: app('fuel_dependency', 'addon', {
      dependencies: ['fuel_stations.core'],
      dependency_status: 'missing',
    }),
  },
  groups: { fuel_stations: group },
});

function rowFor(label: string) {
  const labelInTable = screen.getAllByText(label).find((element) => element.closest('tr'));
  if (!labelInTable) throw new Error(`Expected a table row for ${label}`);
  return labelInTable.closest('tr') as HTMLTableRowElement;
}

function principalCard() {
  const title = screen.getAllByText('Fuel Stations').find((element) => element.closest('section'));
  if (!title) throw new Error('Expected principal application card');
  return title.closest('section') as HTMLElement;
}

describe('ApplicationsPage operational actions', () => {
  afterEach(cleanup);

  beforeEach(() => {
    currentUser.mockReturnValue({ role: 'admin' });
    api.mockReset();
    api.mockResolvedValue(response());
  });

  it('enables disabled built applications with full access regardless of trial, add-on, or included commercial metadata', async () => {
    render(<ApplicationsPage />);
    await screen.findAllByText('Fuel trial');

    for (const label of ['Fuel trial', 'Fuel add-on', 'Fuel included']) {
      expect((within(rowFor(label)).getByRole('button', { name: 'Enable' }) as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it('keeps denied access unavailable and explains dependency blocks without offering activation', async () => {
    render(<ApplicationsPage />);
    await screen.findAllByText('Fuel denied');

    expect((within(rowFor('Fuel denied')).getByRole('button', { name: 'Enable' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(rowFor('Fuel denied')).getByText('Activation is unavailable because effective access is denied.')).toBeTruthy();

    expect((within(rowFor('Fuel dependency')).getByRole('button', { name: 'Enable' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(rowFor('Fuel dependency')).getByText('Enable the required dependencies before activating this application.')).toBeTruthy();
  });

  it('disables a principal application through the existing endpoint without touching child controls', async () => {
    render(<ApplicationsPage />);
    await screen.findAllByText('Fuel Stations');

    fireEvent.click(within(principalCard()).getByRole('switch'));
    const dialog = screen.getByRole('dialog', { name: 'Disable this application?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disable' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/applications/disable', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ scope: 'group', group_key: 'fuel_stations' }),
    })));
  });

  it('bulk-disables child capabilities independently from the principal application state', async () => {
    render(<ApplicationsPage />);
    await screen.findAllByText('Fuel Stations');

    fireEvent.click(within(principalCard()).getByRole('button', { name: 'Disable all' }));
    const dialog = screen.getByRole('dialog', { name: 'Disable all application branches?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disable' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/applications/disable', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ scope: 'group_capabilities', group_key: 'fuel_stations' }),
    })));
  });

  it('bulk-disables all principal applications without mutating child state through the UI contract', async () => {
    render(<ApplicationsPage />);
    await screen.findAllByText('Fuel Stations');

    const globalDisable = screen.getAllByRole('button', { name: 'Disable all' })[0];
    fireEvent.click(globalDisable);
    const dialog = screen.getByRole('dialog', { name: 'Disable all applications?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disable' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/applications/disable', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ scope: 'all_groups' }),
    })));
  });
});
