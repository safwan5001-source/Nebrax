// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FuelAviRfidPage from './page';

const { api, currentUser, translate } = vi.hoisted(() => {
  const translator = (key: string) => key;
  return { api: vi.fn(), currentUser: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/auth', () => ({ currentUser }));
vi.mock('lucide-react', () => ({
  BadgeCheck: () => <span />, CircleAlert: () => <span />, Fingerprint: () => <span />, KeyRound: () => <span />, Plus: () => <span />, ShieldCheck: () => <span />,
}));
vi.mock('@/components/data-table', () => ({
  DataTable: ({ columns, data }: { columns: Array<{ id?: string; accessorKey?: string; cell?: (context: { row: { original: unknown } }) => React.ReactNode }>; data: unknown[] }) => (
    <table><tbody>{data.map((item, itemIndex) => <tr key={itemIndex}>{columns.map((column, columnIndex) => (
      <td key={column.id ?? column.accessorKey ?? columnIndex}>{column.cell?.({ row: { original: item } })}</td>
    ))}</tr>)}</tbody></table>
  ),
}));
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));
vi.mock('@/components/ui/dialog', () => ({ Dialog: () => null }));
vi.mock('@/components/ui/input', () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
vi.mock('@/components/ui/label', () => ({ Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label> }));
vi.mock('@/components/ui/skeleton', () => ({ Skeleton: () => <span /> }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn() }) }));

const authorization = (suspicionSignals: unknown) => ({
  id: 'auth-1', fuel_station_id: 'station-1', fuel_nozzle_id: 'nozzle-1', vehicle_identity_tag_id: null, driver_identity_tag_id: null,
  partner_id: null, fuel_fleet_vehicle_id: null, quantity_milliliters: 50000, decision: 'approved', reason_code: null,
  authorized_at: '2026-08-24T10:00:00.000Z', expires_at: null, fuel_sale_id: null,
  ...(suspicionSignals === undefined ? {} : { suspicion_signals: suspicionSignals }),
});

describe('FuelAviRfidPage API normalization', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  beforeEach(() => {
    vi.stubGlobal('React', React);
    currentUser.mockReturnValue({ permissions: ['*'] });
    api.mockImplementation((path: string) => Promise.resolve({
      data: path === '/fuel-stations/avi-rfid/authorizations' ? [authorization(null)] : [],
    }));
  });

  it.each([
    ['null', null],
    ['missing', undefined],
  ])('renders authorization data when suspicion_signals is %s', async (_description, suspicionSignals) => {
    api.mockImplementation((path: string) => Promise.resolve({
      data: path === '/fuel-stations/avi-rfid/authorizations' ? [authorization(suspicionSignals)] : [],
    }));

    render(<FuelAviRfidPage />);

    expect(await screen.findByText('title')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
