// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/messages/en.json';
import arMessages from '@/messages/ar.json';
import type { ScopeForm } from '@/modules/users/editor';
import { AccessScopeEditor, useScopeLookups } from './access-scope-editor';
import { useScopeText } from './scope-language';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/auth', () => ({ currentUser: () => ({ id: 'me', role: 'admin', permissions: ['*'] }) }));

const provider = (locale: 'en' | 'ar') => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={{ users: (locale === 'en' ? enMessages : arMessages).users } as never}>
      {children}
    </NextIntlClientProvider>
  );
  return Wrapper;
};

beforeEach(() => {
  api.mockImplementation((path: string) => {
    if (path === '/branches') return Promise.resolve({ data: [{ id: 'b1', name: 'Dammam' }, { id: 'b2', name: 'Khobar' }] });
    if (path === '/warehouses') return Promise.resolve({ data: [{ id: 'w1', name: 'Main', branch_id: 'b1' }] });
    return Promise.resolve({ data: [] });
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const blank: ScopeForm = { branches: { mode: 'all', ids: [] }, warehouses: { mode: 'all', ids: [] } };

function Harness({ caps = { branches: true, warehouses: true }, restricted = { branches: false, warehouses: false }, initial = blank }) {
  const [value, setValue] = React.useState<ScopeForm>(initial);
  const lookups = useScopeLookups(true, caps);
  return (
    <>
      <AccessScopeEditor
        value={value}
        onChange={setValue}
        caps={caps}
        restricted={restricted}
        issues={{ branches: null, warehouses: null }}
        branchOptions={lookups.branches}
        warehouseOptions={lookups.warehouses}
      />
      <output data-testid="state">{JSON.stringify(value)}</output>
    </>
  );
}

describe('AccessScopeEditor (shared by the users editor and the employee dialog)', () => {
  it('shows "All" by default and moves to a checklist on "Selected"', async () => {
    render(<Harness />, { wrapper: provider('en') });
    expect((await screen.findByRole('radio', { name: /All branches/ }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByRole('radio', { name: /Selected branches only/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Khobar' }));
    expect(JSON.parse(screen.getByTestId('state').textContent!).branches).toEqual({ mode: 'selected', ids: ['b2'] });
  });

  it('shows the parent branch next to each warehouse', async () => {
    render(<Harness initial={{ ...blank, warehouses: { mode: 'selected', ids: [] } }} />, { wrapper: provider('en') });
    const box = await screen.findByRole('checkbox', { name: /Main/ });
    await waitFor(() => expect(box.closest('label')?.textContent).toContain('Dammam'));
  });

  it('makes no request for a dimension the viewer cannot list, and says editing needs the permission', async () => {
    render(<Harness caps={{ branches: false, warehouses: true }} />, { wrapper: provider('en') });
    await screen.findByText(/Editing branches requires/);
    expect(api.mock.calls.map((c) => c[0])).toEqual(['/warehouses']);
  });

  it('states the limited-view rule for an actor limited to specific branches and disables "All"', async () => {
    render(<Harness restricted={{ branches: true, warehouses: false }} initial={{ ...blank, branches: { mode: 'selected', ids: [] } }} />, { wrapper: provider('en') });
    expect(await screen.findByText(/this list shows only those, and you can only assign branches from within it/)).toBeTruthy();
    expect((screen.getByRole('radio', { name: /All branches/ }) as HTMLInputElement).disabled).toBe(true);
  });
});

describe('scope summary language (one source)', () => {
  const text = (locale: 'en' | 'ar') => renderHook(() => useScopeText(), { wrapper: provider(locale) }).result.current;

  it('speaks All / names / counts the same everywhere (en)', () => {
    const t = text('en');
    expect(t({ kind: 'all' }, 'branches')).toBe('All branches');
    expect(t({ kind: 'all' }, 'warehouses')).toBe('All warehouses');
    expect(t({ kind: 'names', first: 'Dammam', more: 0 }, 'branches')).toBe('Dammam');
    expect(t({ kind: 'names', first: 'Dammam', more: 2 }, 'branches')).toBe('Dammam +2');
    expect(t({ kind: 'count', count: 3 }, 'branches')).toBe('3 branches');
    expect(t({ kind: 'selected', count: 1 }, 'warehouses')).toBe('1 warehouse');
  });

  it('and in Arabic with proper plurals', () => {
    const t = text('ar');
    expect(t({ kind: 'all' }, 'branches')).toBe('كل الفروع');
    expect(t({ kind: 'count', count: 2 }, 'branches')).toBe('فرعان');
    expect(t({ kind: 'selected', count: 1 }, 'warehouses')).toBe('مستودع واحد');
  });
});
