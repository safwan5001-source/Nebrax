/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import { FileScanExceptions } from './file-scan-exceptions';

const { platformApi, erpApi, ApiError } = vi.hoisted(() => {
  class ApiError extends Error {}
  return { platformApi: vi.fn(), erpApi: vi.fn(), ApiError };
});
let locale: 'en' | 'ar' = 'en';

function makeTranslator(lang: 'en' | 'ar') {
  return (key: string, values?: Record<string, string | number>) => {
    const text = ((lang === 'ar' ? ar : en) as unknown as Record<string, Record<string, unknown>>).platformIntegrations[key];
    if (typeof text !== 'string') return key;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
  };
}
const translators = { en: makeTranslator('en'), ar: makeTranslator('ar') };
vi.mock('next-intl', () => ({ useTranslations: () => translators[locale], useLocale: () => locale }));
vi.mock('@/lib/platform-api', () => ({ platformApi }));
// The ERP client must never be used by this screen.
vi.mock('@/lib/api', () => ({ ApiError, api: erpApi }));

const t = (key: string, values?: Record<string, string | number>) => translators.en(key, values);

/** A fake server with the real contract: GET /platform/tenants?search&page&per_page -> { data: Tenant[], pagination }. */
const TOTAL = 45;
const everyTenant = Array.from({ length: TOTAL }, (_, index) => ({ id: `t${String(index + 1).padStart(2, '0')}`, name: `Tenant ${String(index + 1).padStart(2, '0')}` }));
function tenantsResponse(path: string, source = everyTenant) {
  const url = new URL(path, 'http://x');
  const search = (url.searchParams.get('search') ?? '').toLowerCase();
  const perPage = Number(url.searchParams.get('per_page'));
  const page = Number(url.searchParams.get('page'));
  const matches = source.filter((tenant) => tenant.name.toLowerCase().includes(search));
  return { data: matches.slice((page - 1) * perPage, page * perPage), pagination: { current_page: page, last_page: Math.max(1, Math.ceil(matches.length / perPage)), per_page: perPage, total: matches.length } };
}
const tenantCalls = () => platformApi.mock.calls.filter(([path]) => String(path).startsWith('/platform/tenants')).map(([path]) => new URL(String(path), 'http://x'));
const writes = () => platformApi.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');
const exceptions = () => [{ id: 'e1', tenant_id: 't01', tenant_name: 'Tenant 01', reason: 'Scanner outage', expires_at: null, status: 'active' }];

let serve: (path: string, init?: { method?: string }) => unknown;
beforeEach(() => {
  locale = 'en';
  platformApi.mockReset();
  erpApi.mockReset();
  serve = (path, init) => {
    if (path === '/platform/document-file-scan-exceptions' && (init?.method ?? 'GET') === 'GET') return { data: exceptions() };
    if (path.startsWith('/platform/tenants')) return tenantsResponse(path);
    if ((init?.method ?? 'GET') === 'POST') return { data: {} };
    throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
  };
  platformApi.mockImplementation(async (path: string, init?: { method?: string }) => serve(path, init));
});
afterEach(() => cleanup());

const picker = () => screen.getByLabelText(t('scanExTenant')) as HTMLSelectElement;
const search = () => screen.getByLabelText(t('scanExTenantSearch')) as HTMLInputElement;
const optionNames = () => Array.from(picker().options).map((option) => option.textContent);
async function renderReady() {
  const utils = render(<FileScanExceptions />);
  await screen.findByText(t('scanExTenantsShowing', { shown: 20, total: TOTAL }));
  return utils;
}
const loadMore = () => screen.getByRole('button', { name: t('scanExTenantsMore') });
async function grantFor(reason = 'Scanner maintenance') {
  fireEvent.change(screen.getByLabelText(t('scanExReason')), { target: { value: reason } });
  fireEvent.change(screen.getByLabelText(t('currentPassword')), { target: { value: 'pw-123456' } });
  fireEvent.click(screen.getByRole('button', { name: t('scanExGrant') }));
  await waitFor(() => expect(writes()).toHaveLength(1));
}

describe('tenant picker reaches every tenant (H15-03)', () => {
  it('a tenant in the first 20 is listed, selected by default, and sent unchanged', async () => {
    await renderReady();
    expect(picker().options).toHaveLength(20);
    expect(picker().value).toBe('t01');
    const first = tenantCalls()[0];
    expect(first.searchParams.get('page')).toBe('1');
    expect(first.searchParams.get('per_page')).toBe('20');
    expect(first.searchParams.has('search')).toBe(false);
    await grantFor();
    expect(writes()[0]).toEqual(['/platform/document-file-scan-exceptions', { method: 'POST', body: { tenant_id: 't01', reason: 'Scanner maintenance', expires_at: null, current_password: 'pw-123456' } }]);
  });

  it('a tenant beyond the first page is reachable by Load more and is granted with its own id', async () => {
    await renderReady();
    expect(optionNames()).not.toContain('Tenant 33');
    fireEvent.click(loadMore());
    await screen.findByText(t('scanExTenantsShowing', { shown: 40, total: TOTAL }));
    fireEvent.click(loadMore());
    await screen.findByText(t('scanExTenantsShowing', { shown: 45, total: TOTAL }));
    expect(screen.queryByRole('button', { name: t('scanExTenantsMore') })).toBeNull();
    expect(picker().options).toHaveLength(TOTAL);
    expect(tenantCalls().map((url) => url.searchParams.get('page'))).toEqual(['1', '2', '3']);
    fireEvent.change(picker(), { target: { value: 't33' } });
    await grantFor();
    expect(writes()[0][1].body.tenant_id).toBe('t33');
  });

  it('searches on the server across a large list instead of filtering the first 20 locally', async () => {
    await renderReady();
    fireEvent.change(search(), { target: { value: 'Tenant 4' } });
    await screen.findByText(t('scanExTenantsShowing', { shown: 6, total: 6 }));
    const searched = tenantCalls().at(-1)!;
    expect(searched.searchParams.get('search')).toBe('Tenant 4');
    expect(searched.searchParams.get('page')).toBe('1');
    expect(optionNames()).toContain('Tenant 45');
    expect(screen.queryByRole('button', { name: t('scanExTenantsMore') })).toBeNull();
    fireEvent.change(picker(), { target: { value: 't45' } });
    await grantFor();
    expect(writes()[0][1].body.tenant_id).toBe('t45');
  });

  it('clearing the search returns to the full list from page 1', async () => {
    await renderReady();
    fireEvent.change(search(), { target: { value: 'Tenant 4' } });
    await screen.findByText(t('scanExTenantsShowing', { shown: 6, total: 6 }));
    fireEvent.change(search(), { target: { value: '' } });
    await screen.findByText(t('scanExTenantsShowing', { shown: 20, total: TOTAL }));
    expect(tenantCalls().at(-1)!.searchParams.has('search')).toBe(false);
  });

  it('shows an empty-results state that is not an error or a loading state', async () => {
    await renderReady();
    fireEvent.change(search(), { target: { value: 'zzz' } });
    await screen.findByText(t('scanExTenantsNoMatch', { query: 'zzz' }));
    expect(screen.queryByText(t('scanExTenantsLoading'))).toBeNull();
    expect(screen.queryByText(t('scanExTenantsFailed'))).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows loading while a page is being fetched, distinct from empty and from failure', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    platformApi.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.startsWith('/platform/tenants')) await gate;
      return serve(path, init);
    });
    render(<FileScanExceptions />);
    await screen.findByText(t('scanExTenantsLoading'));
    expect(screen.queryByText(t('scanExTenantsNoMatch', { query: '' }))).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    release();
    await screen.findByText(t('scanExTenantsShowing', { shown: 20, total: TOTAL }));
  });

  it('reports an API failure with a retry, and the retry recovers', async () => {
    let fail = true;
    platformApi.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.startsWith('/platform/tenants') && fail) throw new Error('boom');
      return serve(path, init);
    });
    render(<FileScanExceptions />);
    expect(await screen.findByText(t('scanExTenantsFailed'))).toBeTruthy();
    expect(screen.queryByText(t('scanExTenantsNoMatch', { query: '' }))).toBeNull();
    fail = false;
    fireEvent.click(screen.getAllByRole('button', { name: t('retry') }).at(-1)!);
    await screen.findByText(t('scanExTenantsShowing', { shown: 20, total: TOTAL }));
    expect(picker().options).toHaveLength(20);
  });

  it('a failed Load more keeps what is loaded and the selection, and retry loads that same page', async () => {
    await renderReady();
    fireEvent.change(picker(), { target: { value: 't07' } });
    let fail = true;
    platformApi.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.startsWith('/platform/tenants') && fail) throw new Error('boom');
      return serve(path, init);
    });
    fireEvent.click(loadMore());
    await screen.findByText(t('scanExTenantsMoreFailed'));
    expect(picker().options).toHaveLength(20);
    expect(picker().value).toBe('t07');
    fail = false;
    fireEvent.click(screen.getAllByRole('button', { name: t('retry') }).at(-1)!);
    await screen.findByText(t('scanExTenantsShowing', { shown: 40, total: TOTAL }));
    expect(tenantCalls().at(-1)!.searchParams.get('page')).toBe('2');
    expect(picker().value).toBe('t07');
  });

  it('keeps the selected tenant while paging and while searching for others', async () => {
    await renderReady();
    fireEvent.change(picker(), { target: { value: 't05' } });
    fireEvent.click(loadMore());
    await screen.findByText(t('scanExTenantsShowing', { shown: 40, total: TOTAL }));
    expect(picker().value).toBe('t05');
    fireEvent.change(search(), { target: { value: 'Tenant 4' } });
    await screen.findByText(t('scanExTenantsShowing', { shown: 6, total: 6 }));
    expect(picker().value).toBe('t05');
    expect(optionNames()[0]).toBe('Tenant 05');
    await grantFor();
    expect(writes()[0][1].body.tenant_id).toBe('t05');
  });

  it('never lists a tenant twice when the server order shifts between pages', async () => {
    serve = (path, init) => {
      if (path === '/platform/document-file-scan-exceptions') return (init?.method ?? 'GET') === 'POST' ? { data: {} } : { data: exceptions() };
      const response = tenantsResponse(path);
      if (new URL(path, 'http://x').searchParams.get('page') === '2') response.data = [everyTenant[19], ...response.data.slice(0, 19)];
      return response;
    };
    await renderReady();
    fireEvent.click(loadMore());
    await screen.findByText(t('scanExTenantsShowing', { shown: 39, total: TOTAL }));
    const ids = Array.from(picker().options).map((option) => option.value);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ignores a slow earlier search that finishes after a later one', async () => {
    let releaseSlow!: () => void;
    const slow = new Promise<void>((resolve) => { releaseSlow = resolve; });
    platformApi.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.includes('search=Tenant+1') && !path.includes('search=Tenant+12')) await slow;
      return serve(path, init);
    });
    await renderReady();
    fireEvent.change(search(), { target: { value: 'Tenant 1' } });
    await waitFor(() => expect(tenantCalls().some((url) => url.searchParams.get('search') === 'Tenant 1')).toBe(true));
    fireEvent.change(search(), { target: { value: 'Tenant 12' } });
    await screen.findByText(t('scanExTenantsShowing', { shown: 1, total: 1 }));
    releaseSlow();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByText(t('scanExTenantsShowing', { shown: 1, total: 1 }))).toBeTruthy();
    expect(optionNames()).toEqual(['Tenant 01', 'Tenant 12']);
  });

  it('refuses a value that is not one of the loaded tenants', async () => {
    await renderReady();
    fireEvent.change(picker(), { target: { value: 't30' } });
    expect(picker().value).toBe('t01');
    await grantFor();
    expect(writes()[0][1].body.tenant_id).toBe('t01');
  });
});

describe('session, keyboard and unchanged behaviour', () => {
  it('uses only the platform client and leaves the ERP session untouched', async () => {
    localStorage.setItem('token', 'erp-token');
    await renderReady();
    fireEvent.click(loadMore());
    await screen.findByText(t('scanExTenantsShowing', { shown: 40, total: TOTAL }));
    expect(erpApi).not.toHaveBeenCalled();
    expect(platformApi.mock.calls.every(([path]) => String(path).startsWith('/platform/'))).toBe(true);
    expect(localStorage.getItem('token')).toBe('erp-token');
    localStorage.removeItem('token');
  });

  it('is reachable and operable by keyboard with clear labels', async () => {
    const user = userEvent.setup();
    await renderReady();
    expect(search().getAttribute('type')).toBe('search');
    expect(screen.getByLabelText(t('scanExTenantSearch'))).toBe(search());
    expect(picker().tagName).toBe('SELECT');
    expect(loadMore().tagName).toBe('BUTTON');
    for (const node of [search(), picker(), loadMore()]) expect(node.tabIndex).toBeGreaterThanOrEqual(0);
    search().focus();
    await user.tab();
    expect(document.activeElement).toBe(picker());
    await user.selectOptions(picker(), 't09');
    expect(picker().value).toBe('t09');
    expect(picker().getAttribute('aria-describedby')).toBe('scan-ex-tenant-status');
    expect(document.getElementById('scan-ex-tenant-status')?.getAttribute('aria-live')).toBe('polite');
    await user.tab();
    expect(document.activeElement).toBe(loadMore());
    await user.keyboard('{Enter}');
    await screen.findByText(t('scanExTenantsShowing', { shown: 40, total: TOTAL }));
  });

  it('granting still posts the same body, reloads only the exceptions, and keeps the picker state', async () => {
    await renderReady();
    fireEvent.click(loadMore());
    await screen.findByText(t('scanExTenantsShowing', { shown: 40, total: TOTAL }));
    fireEvent.change(picker(), { target: { value: 't25' } });
    const tenantRequests = tenantCalls().length;
    await grantFor('Planned outage');
    expect(writes()[0]).toEqual(['/platform/document-file-scan-exceptions', { method: 'POST', body: { tenant_id: 't25', reason: 'Planned outage', expires_at: null, current_password: 'pw-123456' } }]);
    await screen.findByText(t('scanExGranted'));
    expect(tenantCalls()).toHaveLength(tenantRequests);
    expect(picker().value).toBe('t25');
  });

  it('revoking still posts the same body', async () => {
    await renderReady();
    await screen.findByText('Scanner outage');
    fireEvent.click(screen.getByRole('button', { name: t('scanExRevoke') }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(t('scanExRevokeReason')), { target: { value: 'No longer needed' } });
    fireEvent.change(within(dialog).getByLabelText(t('currentPassword')), { target: { value: 'pw-123456' } });
    fireEvent.click(within(dialog).getByRole('button', { name: t('scanExRevokeConfirm') }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual(['/platform/document-file-scan-exceptions/e1/revoke', { method: 'POST', body: { reason: 'No longer needed', current_password: 'pw-123456' } }]);
  });

  it('has every new key in both languages and renders the picker in Arabic', async () => {
    for (const lang of [ar, en]) for (const key of ['scanExTenantSearch', 'scanExTenantSearchPlaceholder', 'scanExTenantsLoading', 'scanExTenantsShowing', 'scanExTenantsNoMatch', 'scanExTenantsFailed', 'scanExTenantsMoreFailed', 'scanExTenantsMore']) {
      expect(typeof (lang.platformIntegrations as Record<string, unknown>)[key]).toBe('string');
    }
    locale = 'ar';
    render(<FileScanExceptions />);
    await screen.findByText(translators.ar('scanExTenantsShowing', { shown: 20, total: TOTAL }));
    expect(screen.getByLabelText(ar.platformIntegrations.scanExTenantSearch)).toBeTruthy();
  });
});
