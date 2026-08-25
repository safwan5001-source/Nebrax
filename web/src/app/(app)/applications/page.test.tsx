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
    'columns.dependencies': 'Dependencies',
    'commercial.trial': 'Trial',
    'commercial.addon': 'Add-on',
    'commercial.included': 'Included',
    'commercial.not_available': 'Not available',
    'actions.unavailable': 'Unavailable',
    'actions.blocked.access_denied': 'Activation is unavailable because effective access is denied.',
    'actions.blocked.read_only': 'Application is read only.',
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
// أي أيقونة تُستدعى من الصفحة أو من مكوّنات نبراكس المشتركة تُرجع عنصراً فارغاً،
// فلا يكسر الاختبارَ استيرادُ أيقونة جديدة في مكوّن مشترك.
vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  // أي أيقونة تُستدعى من الصفحة أو من مكوّنات نبراكس المشتركة تُرجع عنصراً فارغاً،
  // فلا يكسر الاختبارَ استيرادُ أيقونة جديدة في مكوّن مشترك.
  // `then` والرموز تُترك للسلوك الافتراضي؛ لولا ذلك لبدت الوحدة thenable فانتظرها المُحمِّل بلا نهاية.
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) =>
      typeof name === 'symbol' || name === 'then' || name === '__esModule'
        ? Reflect.get(target, name)
        : iconStub,
    has: () => true,
  });
});
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: any) => <section>{children}</section>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/ui/dialog', () => ({ Dialog: () => null }));
vi.mock('@/components/ui/label', () => ({ Label: ({ children }: any) => <label>{children}</label> }));
vi.mock('@/components/ui/textarea', () => ({ Textarea: (props: any) => <textarea {...props} /> }));
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

function cardFor(label: string) {
  const heading = screen.getByRole('heading', { name: label });
  const card = heading.closest('article');
  if (!card) throw new Error(`Expected an application card for ${label}`);
  return card;
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

  it('offers an accessible activation switch for eligible built applications regardless of commercial metadata', async () => {
    render(<ApplicationsPage />);
    await screen.findByRole('heading', { name: 'Fuel trial' });

    for (const label of ['Fuel trial', 'Fuel add-on', 'Fuel included']) {
      const control = within(cardFor(label)).getByRole('switch', { name: `Enable ${label}` }) as HTMLButtonElement;
      expect(control.disabled).toBe(false);
      expect(control.getAttribute('aria-checked')).toBe('false');
    }
  });

  it('keeps denied access and missing dependencies blocked while explaining why', async () => {
    render(<ApplicationsPage />);
    await screen.findByRole('heading', { name: 'Fuel denied' });

    const denied = within(cardFor('Fuel denied'));
    expect((denied.getByRole('switch', { name: 'Enable Fuel denied' }) as HTMLButtonElement).disabled).toBe(true);
    expect(denied.getByText('Activation is unavailable because effective access is denied.')).toBeTruthy();

    const dependency = within(cardFor('Fuel dependency'));
    expect((dependency.getByRole('switch', { name: 'Enable Fuel dependency' }) as HTMLButtonElement).disabled).toBe(true);
    expect(dependency.getByText('Enable the required dependencies before activating this application.')).toBeTruthy();
  });

  it('renders compact status controls and group-level bulk actions', async () => {
    render(<ApplicationsPage />);
    await screen.findByRole('heading', { name: 'Fuel trial' });

    expect(screen.getAllByRole('button', { name: 'All' }).length).toBeGreaterThan(0);
    const group = screen.getByRole('heading', { name: 'Fuel Stations' }).closest('section');
    if (!group) throw new Error('Expected Fuel Stations group');
    expect(within(group).getByRole('button', { name: 'Enable' })).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'Disable' })).toBeTruthy();
  });
});
