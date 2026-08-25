// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FuelStationsWorkspacePage from './page';

const { api, currentUser, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    eyebrow: 'Fuel stations',
    commandCenterTitle: 'Fuel command centre',
    commandCenterSubtitle: 'Operational overview',
    loadFailed: 'Could not load the fuel workspace',
    retry: 'Try again',
    refresh: 'Refresh',
    stations: 'Stations',
    quickActions: 'Quick actions',
    quickActionsHint: 'Jump to the daily work',
    noQuickActions: 'No quick actions',
    noStations: 'No stations registered',
    quickStations: 'Station master data',
    operationalNotice: 'Operational notice',
    operationalSummary: 'Operational summary',
    statusActive: 'Active',
    statusUnknown: 'Unknown',
    noRecentShift: 'No recent shift',
    viewStation: 'View station',
  };
  const translator = Object.assign((key: string) => strings[key] ?? key, { raw: () => ({}) });
  return { api: vi.fn(), currentUser: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/auth', () => ({ currentUser }));
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

const station = {
  id: 'fs-1', branch_id: null, code: 'ST-001', name: 'Riyadh North',
  status: 'active', timezone: 'Asia/Riyadh', operating_day_starts_at: '06:00',
};

function respondWith(workspacePayload: unknown) {
  api.mockImplementation((path: string) => {
    if (path === '/fuel-stations/workspace') return Promise.resolve(workspacePayload);
    return Promise.resolve({ data: [] });
  });
}

describe('FuelStationsWorkspacePage workspace payload', () => {
  afterEach(cleanup);

  beforeEach(() => {
    currentUser.mockReturnValue({ role: 'owner', permissions: ['*'] });
    api.mockReset();
  });

  it('renders the command centre for a well-formed workspace', async () => {
    respondWith({ data: { stations: [station] } });
    render(<FuelStationsWorkspacePage />);

    expect(await screen.findByRole('heading', { name: 'Fuel command centre' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Riyadh North' })).toBeTruthy();
  });

  it('reports a load failure instead of crashing when the payload carries no stations list', async () => {
    // السقوط العام لأي مسار غير معروف يعيد `{ data: [] }`؛ كان يُخزَّن كما هو
    // فينهار العرض عند `stations.filter` داخل `useMemo` بـ TypeError يُسقط الصفحة.
    respondWith({ data: [] });
    render(<FuelStationsWorkspacePage />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Could not load the fuel workspace');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('reports a load failure for a null payload rather than throwing', async () => {
    respondWith({ data: null });
    render(<FuelStationsWorkspacePage />);

    expect((await screen.findByRole('alert')).textContent).toBe('Could not load the fuel workspace');
  });

  it('keeps the page header visible on the failure path so the user is not stranded', async () => {
    respondWith({ data: [] });
    render(<FuelStationsWorkspacePage />);

    await screen.findByRole('alert');
    expect(screen.getByRole('heading', { name: 'Fuel command centre' })).toBeTruthy();
  });
});
