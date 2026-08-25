// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FuelStationsWorkspacePage from './page';

const { api, currentUser, translate, locale, literUnit } = vi.hoisted(() => {
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
    litersToday: 'Liters today',
  };
  const literUnit = { current: 'L' };
  const locale = { current: 'en' };
  const translator = Object.assign(
    (key: string) => (key === 'literUnit' ? literUnit.current : strings[key] ?? key),
    { raw: () => ({}) }
  );
  return { api: vi.fn(), currentUser: vi.fn(), translate: translator, locale, literUnit };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => locale.current }));
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

const dashboard = {
  sales_today_minor: 128455075,
  liters_today_milliliters: 84250000,
  gross_margin_minor: 18422050,
  open_shifts: 4,
  open_work_orders: 2,
  active_alerts: 1,
  degraded_devices: 3,
  data_boundary: 'branch',
};

function respondWith(workspacePayload: unknown) {
  api.mockImplementation((path: string) => {
    if (path === '/fuel-stations/workspace') return Promise.resolve(workspacePayload);
    if (path === '/fuel-stations/dashboard') return Promise.resolve({ data: dashboard });
    return Promise.resolve({ data: [] });
  });
}

describe('FuelStationsWorkspacePage workspace payload', () => {
  afterEach(cleanup);

  beforeEach(() => {
    currentUser.mockReturnValue({ role: 'owner', permissions: ['*'] });
    api.mockReset();
    locale.current = 'en';
    literUnit.current = 'L';
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

  it('names the liters metric once, in English', async () => {
    locale.current = 'en';
    literUnit.current = 'L';
    respondWith({ data: { stations: [station] } });
    render(<FuelStationsWorkspacePage />);

    const metric = await screen.findByText(/84,250/);
    expect(metric.textContent).toBe('84,250 L');
  });

  it('names the liters metric once, in Arabic', async () => {
    locale.current = 'ar';
    literUnit.current = 'لتر';
    respondWith({ data: { stations: [station] } });
    render(<FuelStationsWorkspacePage />);

    const metric = await screen.findByText(/84,250/);
    // كانت الوحدة تُلحَق مرتين فتظهر «84,250 L لتر».
    expect(metric.textContent).toBe('84,250 لتر');
    expect(metric.textContent).not.toContain('L');
  });

  it('keeps the page header visible on the failure path so the user is not stranded', async () => {
    respondWith({ data: [] });
    render(<FuelStationsWorkspacePage />);

    await screen.findByRole('alert');
    expect(screen.getByRole('heading', { name: 'Fuel command centre' })).toBeTruthy();
  });
});
