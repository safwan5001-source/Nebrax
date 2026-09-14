// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FuelReportsPage from './page';

const { api, currentUser, replace, searchParams, translate } = vi.hoisted(() => ({
  api: vi.fn(),
  currentUser: vi.fn(),
  replace: vi.fn(),
  searchParams: { params: new URLSearchParams('report=sales-station') },
  translate: (key: string) => key,
}));

vi.mock('next-intl', () => ({ useLocale: () => 'ar', useTranslations: () => translate }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams.params,
}));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('@/lib/auth', () => ({ currentUser }));
vi.mock('@/lib/export', () => ({ downloadCsv: vi.fn(), toCsv: vi.fn(() => '') }));
vi.mock('lucide-react', () => ({ Download: () => <span />, Filter: () => <span />, RefreshCw: () => <span /> }));
vi.mock('@/components/reports/report-workspace-ui', () => ({
  ReportScreenHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  ReportMetricGrid: () => <div />, ReportMobileRows: () => <div />,
}));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));
vi.mock('@/components/ui/card', () => ({ Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>, CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2> }));
vi.mock('@/components/ui/dialog', () => ({ Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null }));
vi.mock('@/components/ui/input', () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
vi.mock('@/components/ui/skeleton', () => ({ Skeleton: () => <div /> }));
vi.mock('@/components/ui/table', () => ({ Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>, THead: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>, TBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>, TR: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>, TH: ({ children }: { children: React.ReactNode }) => <th>{children}</th>, TD: ({ children }: { children: React.ReactNode }) => <td>{children}</td> }));
vi.mock('@/components/ui/combobox', () => ({ Combobox: ({ value, onChange, options, searchPlaceholder: _searchPlaceholder, emptyText: _emptyText, clearLabel: _clearLabel, ...props }: { value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; searchPlaceholder?: string; emptyText?: string; clearLabel?: string } & React.SelectHTMLAttributes<HTMLSelectElement>) => <select value={value} onChange={(event) => onChange(event.target.value)} {...props}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));

function respond(path: string) {
  if (path.startsWith('/fuel-stations/reports/sales')) return Promise.resolve({ data: { rows: [{ dimension_id: 'station-1', sales_count: 1, quantity_milliliters: 1000, revenue_minor: 1000, cogs_minor: 500, margin_minor: 500 }] } });
  return Promise.resolve({ data: [] });
}

describe('FuelReportsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('React', React);
    currentUser.mockReturnValue({ permissions: ['fuel.reports.view'] });
    api.mockImplementation(respond);
    replace.mockReset();
    searchParams.params = new URLSearchParams('report=sales-station');
  });

  afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

  it('loads the default supported report even when optional lookup collections are absent', async () => {
    api.mockImplementation((path: string) => path.startsWith('/fuel-stations/reports/sales')
      ? respond(path)
      : Promise.resolve({ data: null }));

    render(<FuelReportsPage />);

    expect(await screen.findByRole('heading', { name: 'title' })).toBeTruthy();
    expect(api).toHaveBeenCalledWith('/fuel-stations/reports/sales?dimension=station');
  });

  it('does not request reports when the user lacks the report-read permission', async () => {
    currentUser.mockReturnValue({ permissions: ['fuel_stations.view'] });

    render(<FuelReportsPage />);

    expect(await screen.findByText('noPermission')).toBeTruthy();
    expect(api.mock.calls.some(([path]) => String(path).startsWith('/fuel-stations/reports/'))).toBe(false);
  });

  it('stores only supported URL filters and switches reports through the URL state', async () => {
    render(<FuelReportsPage />);
    await screen.findByRole('heading', { name: 'title' });

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'sales-fuel' } });
    expect(replace).toHaveBeenLastCalledWith('/fuel-stations/reports?report=sales-fuel');

    fireEvent.change(screen.getAllByLabelText('from')[0], { target: { value: '2026-08-01' } });
    expect(replace).toHaveBeenLastCalledWith('/fuel-stations/reports?report=sales-station&from=2026-08-01');
  });

  it('renders the empty state safely for malformed report rows and null optional API data', async () => {
    api.mockImplementation((path: string) => path.startsWith('/fuel-stations/reports/sales')
      ? Promise.resolve({ data: { rows: null } })
      : Promise.resolve({ data: null }));

    render(<FuelReportsPage />);

    expect(await screen.findByText('empty')).toBeTruthy();
  });
});
