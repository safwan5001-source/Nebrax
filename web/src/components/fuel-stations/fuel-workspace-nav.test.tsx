// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

const state = vi.hoisted(() => ({ permissions: ['*'] as string[], tankers: (() => ({ data: [], meta: {} })) as () => unknown, fills: (() => ({ data: [], meta: { counts: {} } })) as () => unknown }));
const calls = vi.hoisted(() => [] as string[]);

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/fuel-stations' }));
vi.mock('@/lib/auth', () => ({ currentUser: () => ({ permissions: state.permissions }) }));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(async (path: string) => {
    calls.push(path);
    if (path === '/applications/nav-state') return { data: {} };
    if (path.startsWith('/fuel-stations/tanker-fills/inventory-workspace')) {
      const result = state.fills();
      if (result instanceof Error) throw result;
      return result;
    }
    if (path.startsWith('/fuel-stations/tanker-owners')) {
      const result = state.tankers();
      if (result instanceof Error) throw result;
      return result;
    }
    return {};
  }),
}));

import { ApiError } from '@/lib/api';
import { FuelWorkspaceNav } from './fuel-workspace-nav';

beforeEach(() => { calls.length = 0; state.permissions = ['*']; state.tankers = () => ({ data: [], meta: {} }); state.fills = () => ({ data: [], meta: { counts: { pending: 0, posted: 0, reversed: 0, attention: 0 } } }); });
afterEach(cleanup);

describe.each([['ar', 'أصحاب الصهاريج'], ['en', 'Tanker owners']] as const)('FuelWorkspaceNav tanker gate (%s)', (locale, label) => {
  it('shows the link only after the server confirms the gate is open', async () => {
    renderIntl(<FuelWorkspaceNav />, locale);
    expect(await screen.findByRole('link', { name: label })).toBeTruthy();
    expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe('/fuel-stations/tanker-owners');
  });

  it('keeps it hidden when the gate is closed (404) and for any other failure', async () => {
    state.tankers = () => new ApiError(404, 'Not Found', {});
    const closed = renderIntl(<FuelWorkspaceNav />, locale);
    await waitFor(() => expect(calls.some((p) => p.startsWith('/fuel-stations/tanker-owners'))).toBe(true));
    await screen.findAllByRole('link');
    expect(screen.queryByRole('link', { name: label })).toBeNull();
    closed.unmount();

    calls.length = 0;
    state.tankers = () => new ApiError(500, 'boom', {});
    renderIntl(<FuelWorkspaceNav />, locale);
    await waitFor(() => expect(calls.some((p) => p.startsWith('/fuel-stations/tanker-owners'))).toBe(true));
    expect(screen.queryByRole('link', { name: label })).toBeNull();
  });

  it('does not even probe for users without the view permission', async () => {
    state.permissions = ['fuel_stations.view', 'fuel_stations.manage'];
    renderIntl(<FuelWorkspaceNav />, locale);
    await screen.findAllByRole('link');
    expect(calls.some((p) => p.startsWith('/fuel-stations/tanker-owners'))).toBe(false);
    expect(screen.queryByRole('link', { name: label })).toBeNull();
  });
});

describe.each([['ar', 'سندات التعبئة — الدمج المخزني'], ['en', 'Tanker fills — inventory posting']] as const)('FuelWorkspaceNav inventory workspace gate (%s)', (locale, label) => {
  const probes = () => calls.filter((p) => p.startsWith('/fuel-stations/tanker-fills/inventory-workspace'));

  it('shows the link only after a light probe of the workspace succeeds', async () => {
    renderIntl(<FuelWorkspaceNav />, locale);
    expect(await screen.findByRole('link', { name: label })).toBeTruthy();
    expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe('/fuel-stations/tanker-fills');
    expect(probes()).toEqual(['/fuel-stations/tanker-fills/inventory-workspace?per_page=1']);
  });

  it('keeps it hidden when the gate is closed (404) or on any other failure or malformed response', async () => {
    for (const failure of [new ApiError(404, 'Not Found', {}), new ApiError(500, 'boom', {}), { data: 'nope' }]) {
      calls.length = 0;
      state.fills = () => failure;
      const view = renderIntl(<FuelWorkspaceNav />, locale);
      await waitFor(() => expect(probes()).toHaveLength(1));
      await screen.findAllByRole('link');
      expect(screen.queryByRole('link', { name: label })).toBeNull();
      view.unmount();
    }
  });

  it('does not probe for users without the inventory view permission', async () => {
    state.permissions = ['fuel_stations.view', 'fuel.tanker.view'];
    renderIntl(<FuelWorkspaceNav />, locale);
    await screen.findAllByRole('link');
    expect(probes()).toHaveLength(0);
    expect(screen.queryByRole('link', { name: label })).toBeNull();
  });
});
