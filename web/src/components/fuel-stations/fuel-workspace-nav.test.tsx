// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

const state = vi.hoisted(() => ({ permissions: ['*'] as string[], tankers: (() => ({ data: [], meta: {} })) as () => unknown }));
const calls = vi.hoisted(() => [] as string[]);

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/fuel-stations' }));
vi.mock('@/lib/auth', () => ({ currentUser: () => ({ permissions: state.permissions }) }));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(async (path: string) => {
    calls.push(path);
    if (path === '/applications/nav-state') return { data: {} };
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

beforeEach(() => { calls.length = 0; state.permissions = ['*']; state.tankers = () => ({ data: [], meta: {} }); });
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
