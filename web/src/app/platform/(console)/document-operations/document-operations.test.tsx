/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import PlatformDocumentOperationsPage from './page';

const { platformApi, platformDownloadFile, replace, ApiError } = vi.hoisted(() => {
  class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, message: string, body: unknown = {}) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }
  return { platformApi: vi.fn(), platformDownloadFile: vi.fn(), replace: vi.fn(), ApiError };
});
let locale: 'en' | 'ar' = 'en';

function makeTranslator(lang: 'en' | 'ar') {
  return (key: string, values?: Record<string, string | number>) => {
    const text = ((lang === 'ar' ? ar : en) as unknown as Record<string, Record<string, unknown>>).documentOperations[key];
    if (typeof text !== 'string') return key;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
  };
}
const translators = { en: makeTranslator('en'), ar: makeTranslator('ar') };
vi.mock('next-intl', () => ({ useTranslations: () => translators[locale], useLocale: () => locale }));
const router = { replace, push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/platform-auth', () => ({ isPlatformAuthenticated: () => true }));
vi.mock('@/lib/platform-api', () => ({ platformApi, platformDownloadFile }));
vi.mock('@/lib/api', () => ({ ApiError }));

const t = (key: string, values?: Record<string, string | number>) => translators.en(key, values);
const CURSOR = '11111111-2222-3333-4444-555555555555';

const overview = () => ({
  runtime: { queue_configured: true, worker_status: 'online', worker_last_seen_at: null, queued_runs: 3, running_runs: 1, failed_runs: 2 },
  batches_by_status: [
    { status: 'queued', count: 3 },
    { status: 'failed', count: 2 },
    { status: 'quarantined', count: 1 },
    { status: 'brand_new_status', count: 4 },
  ],
  runs_by_status: [
    { status: 'running', count: 1 },
    { status: 'succeeded', count: 1234 },
    { status: 'failed', count: 2 },
  ],
  retention: { retention_days: 365, enabled: true, purge_mode: 'hard', last_run: { id: 'r0', status: 'completed', dry_run: true, purged_count: 0, finished_at: '2026-09-10T10:00:00Z' } },
  retention_runs: [
    { id: 'aaaaaaaa-0000-0000-0000-000000000001', dry_run: true, status: 'completed', cutoff_at: '2025-10-01T00:00:00Z', scanned_count: 100, eligible_count: 12, purged_count: 0, skipped_count: 3, after_file_id: null, next_after_file_id: CURSOR, created_at: '2026-09-10T09:00:00Z' },
    { id: 'bbbbbbbb-0000-0000-0000-000000000002', dry_run: false, status: 'planned', cutoff_at: null, scanned_count: 5, eligible_count: 5, purged_count: 5, skipped_count: 0, after_file_id: null, next_after_file_id: null, created_at: '2026-09-09T09:00:00Z' },
  ],
});
const usage = () => ({
  range: { from: '2026-09-14', to: '2026-10-13' },
  operations: 1234, pages: 5678, input_tokens: 1234567, output_tokens: 89012,
  per_tenant: [{ tenant_id: 'SECRET-TENANT-ID-123', operations: 9, pages: 9, input_tokens: 9, output_tokens: 9 }],
  per_provider_model: [{ provider: 'openai', model: 'gpt-secret-model', operations: 9, pages: 9 }],
});
const diagnostics = () => ({
  runtime: { processing_mode: 'async', queue_configured: true, worker_required: true, worker_online: true, scanner_ready: true, provider_configured: true, provider_network_locked: false, runs: { queued: 3, running: 1, failed: 2 } },
});

const writes = () => platformApi.mock.calls.filter(([, o]) => o?.method && o.method !== 'GET');
const reads = () => platformApi.mock.calls.filter(([, o]) => !o?.method);
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

let current = { overview: overview(), usage: usage(), diagnostics: diagnostics() };
beforeEach(() => {
  locale = 'en';
  current = { overview: overview(), usage: usage(), diagnostics: diagnostics() };
  platformApi.mockReset();
  platformDownloadFile.mockReset();
  replace.mockReset();
  platformApi.mockImplementation(async (path: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET' && path === '/platform/document-operations') return { data: current.overview };
    if (method === 'GET' && path === '/platform/document-usage') return { data: current.usage };
    if (method === 'GET' && path === '/platform/document-diagnostics') return { data: current.diagnostics };
    throw new Error(`unexpected ${method} ${path}`);
  });
});
afterEach(() => cleanup());

async function renderLoaded() {
  const utils = render(<PlatformDocumentOperationsPage />);
  await screen.findByText(t('platBatches'));
  return utils;
}
const card = (title: string) => screen.getByRole('heading', { name: title }).closest('[data-awj-card]') as HTMLElement;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('structure and states', () => {
  it('has no private back arrow, one h1, 44px header actions and a scope note', async () => {
    const { container } = await renderLoaded();
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.textContent).not.toContain('←');
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(button(t('refresh')).className).toContain('h-11');
    expect(button(t('exportAudit')).className).toContain('h-11');
    expect(screen.getByText(t('platScopeNote'))).toBeTruthy();
  });

  it('shows skeleton cards on first load, not a text line', async () => {
    const pending = deferred<{ data: unknown }>();
    platformApi.mockImplementation(() => pending.promise);
    render(<PlatformDocumentOperationsPage />);
    expect(screen.getByTestId('document-ops-skeleton')).toBeTruthy();
    expect(screen.queryByText(t('loading'))).toBeNull();
  });

  it('opening the page only reads the three endpoints and sends no write', async () => {
    await renderLoaded();
    expect(writes()).toHaveLength(0);
    expect(reads().map(([path]) => path).sort()).toEqual(['/platform/document-diagnostics', '/platform/document-operations', '/platform/document-usage']);
  });

  it('keeps the data on screen while a refresh is loading and when it fails, with an alert above', async () => {
    await renderLoaded();
    const pending = deferred<{ data: unknown }>();
    platformApi.mockImplementationOnce(() => pending.promise);
    fireEvent.click(button(t('refresh')));
    expect(screen.queryByTestId('document-ops-skeleton')).toBeNull();
    expect(screen.getByText(t('platBatches'))).toBeTruthy();
    expect(button(t('refresh')).disabled).toBe(true);
    pending.reject(new ApiError(500, 'Refresh failed'));
    expect((await screen.findByText('Refresh failed')).getAttribute('role')).toBe('alert');
    expect(screen.getByText(t('platBatches'))).toBeTruthy();
  });

  it('shows a first-load failure as an alert with a 44px retry and recovers', async () => {
    platformApi.mockImplementationOnce(async () => { throw new ApiError(500, 'Service down'); });
    render(<PlatformDocumentOperationsPage />);
    const alert = await screen.findByText('Service down');
    expect(alert.getAttribute('role')).toBe('alert');
    const retry = button(t('retry'));
    expect(retry.className).toContain('h-11');
    fireEvent.click(retry);
    expect(await screen.findByText(t('platBatches'))).toBeTruthy();
  });

  it('explains a forbidden or missing resource instead of a generic error', async () => {
    platformApi.mockImplementationOnce(async () => { throw new ApiError(403, 'حدث خطأ'); });
    const first = render(<PlatformDocumentOperationsPage />);
    expect((await screen.findByText(t('platForbidden'))).getAttribute('role')).toBe('alert');
    first.unmount();
    platformApi.mockImplementationOnce(async () => { throw new ApiError(404, 'حدث خطأ'); });
    render(<PlatformDocumentOperationsPage />);
    expect(await screen.findByText(t('platNotFound'))).toBeTruthy();
  });
});

describe('what is shown (real fields only)', () => {
  it('lists batches and runs by their real status, translated, and shows an unknown status as received', async () => {
    await renderLoaded();
    const batches = card(t('platBatches'));
    expect(within(batches).getByText(t('platBatch_queued'))).toBeTruthy();
    expect(within(batches).getByText(t('platBatch_failed'))).toBeTruthy();
    expect(within(batches).getByText(t('platBatch_quarantined'))).toBeTruthy();
    expect(within(batches).getByText('brand_new_status')).toBeTruthy();
    // statuses the API did not return are not invented
    expect(within(batches).queryByText(t('platBatch_needs_review'))).toBeNull();
    const runs = card(t('platRuns'));
    expect(within(runs).getByText(t('platRun_running'))).toBeTruthy();
    expect(within(runs).getByText('1,234')).toBeTruthy();
  });

  it('shows empty states for no batches or runs', async () => {
    current.overview.batches_by_status = [];
    current.overview.runs_by_status = [];
    await renderLoaded();
    expect(screen.getByText(t('platBatchesEmpty'))).toBeTruthy();
    expect(screen.getByText(t('platRunsEmpty'))).toBeTruthy();
  });

  it('shows running, queued and failed counts from the diagnostics', async () => {
    await renderLoaded();
    const processing = screen.getByText(t('processing')).closest('[data-awj-card]') as HTMLElement;
    expect(processing.textContent).toContain('1');
    expect(processing.textContent).toContain(`${t('platQueued')}: 3`);
    expect(processing.textContent).toContain(`${t('failed')}: 2`);
  });

  it('shows the usage totals, grouped, with the period, and never the per-tenant or per-provider rows', async () => {
    await renderLoaded();
    const usageCard = card(t('platformUsage'));
    expect(within(usageCard).getByText('1,234,567')).toBeTruthy();
    expect(within(usageCard).getByText('89,012')).toBeTruthy();
    expect(usageCard.textContent).toContain('2026-09-14');
    expect(usageCard.textContent).toContain('2026-10-13');
    expect(document.body.textContent).not.toContain('SECRET-TENANT-ID-123');
    expect(document.body.textContent).not.toContain('gpt-secret-model');
  });

  it('shows each retention run with dry-run or applied, a translated status, all four counts, dates and the cursor', async () => {
    await renderLoaded();
    const history = card(t('platRunHistory'));
    const rows = within(history).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText(t('platRunDry'))).toBeTruthy();
    expect(within(rows[0]!).getByText(t('platRet_completed'))).toBeTruthy();
    expect(rows[0]!.textContent).toContain(`${t('platScanned')}100`);
    expect(rows[0]!.textContent).toContain(`${t('platEligible')}12`);
    expect(rows[0]!.textContent).toContain(`${t('summaryPurged')}0`);
    expect(rows[0]!.textContent).toContain(`${t('platSkipped')}3`);
    expect(rows[0]!.textContent).toContain(CURSOR);
    expect(rows[0]!.textContent).toContain('aaaaaaaa-000'); // shortened id
    expect(rows[0]!.textContent).not.toContain('aaaaaaaa-0000-0000');
    expect(within(rows[1]!).getByText(t('platRunApplied'))).toBeTruthy();
    expect(within(rows[1]!).getByText(t('platRet_planned'))).toBeTruthy();
    expect(rows[0]!.querySelectorAll('bdi').length).toBe(2); // created + cutoff
  });

  it('dates follow the page language: English digits and words on the English page', async () => {
    await renderLoaded();
    const arabic = /[؀-ۿ]/;
    for (const el of Array.from(document.querySelectorAll('bdi'))) expect(el.textContent).not.toMatch(arabic);
  });

  it('warns that runs are rejected while the saved policy is disabled, without disabling the run button', async () => {
    current.overview.retention.enabled = false;
    await renderLoaded();
    expect(screen.getByText(t('platPolicyDisabledNote'))).toBeTruthy();
    expect(button(t('runRetention')).disabled).toBe(false);
  });
});

describe('retention run: dry run default, apply confirmation, duplicates', () => {
  it('is a dry run by default; turning it off needs the confirmation and toggling sends nothing', async () => {
    await renderLoaded();
    expect((screen.getByLabelText(t('dryRun')) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(t('platDryEffect'))).toBeTruthy();
    fireEvent.click(screen.getByLabelText(t('dryRun')));
    expect(screen.getByText(t('platApplyEffect'))).toBeTruthy();
    const apply = button(t('applyRun'));
    expect(apply.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(t('confirmApply')));
    expect(apply.disabled).toBe(false);
    // going back to dry run clears the confirmation
    fireEvent.click(screen.getByLabelText(t('dryRun')));
    fireEvent.click(screen.getByLabelText(t('dryRun')));
    expect(button(t('applyRun')).disabled).toBe(true);
    expect(writes()).toHaveLength(0);
  });

  it('sends the bodies the API accepts: dry run (apply is required by the API even then) with the resume cursor, then apply', async () => {
    await renderLoaded();
    platformApi.mockImplementationOnce(async () => ({ data: { run_id: 'r1', dry_run: true, status: 'completed', cutoff_at: null, after_file_id: CURSOR, next_after_file_id: null, results: { scanned: 1, eligible: 1, purged: 0, skipped: 0 } } }));
    fireEvent.click(button(t('runRetention')));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual(['/platform/document-retention-runs', { method: 'POST', body: { dry_run: true, apply: true, after_file_id: CURSOR } }]);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(t('runCompleted')));

    fireEvent.click(screen.getByLabelText(t('dryRun')));
    fireEvent.click(screen.getByLabelText(t('confirmApply')));
    platformApi.mockImplementationOnce(async () => ({ data: { run_id: 'r2', dry_run: false, status: 'completed', cutoff_at: null, after_file_id: null, next_after_file_id: null, results: { scanned: 1, eligible: 1, purged: 1, skipped: 0 } } }));
    fireEvent.click(button(t('applyRun')));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toEqual(['/platform/document-retention-runs', { method: 'POST', body: { dry_run: false, apply: true } }]);
  });

  it('blocks every action while one is in flight, so a second click sends nothing', async () => {
    await renderLoaded();
    const pending = deferred<{ data: unknown }>();
    platformApi.mockImplementationOnce(() => pending.promise);
    const run = button(t('runRetention'));
    fireEvent.click(run);
    expect(run.disabled).toBe(true);
    fireEvent.click(run);
    for (const name of [t('savePolicy'), t('exportAudit')]) expect(button(name).disabled).toBe(true);
    fireEvent.click(button(t('savePolicy')));
    expect(writes()).toHaveLength(1);
    pending.resolve({ data: { run_id: 'r1', dry_run: true, status: 'completed', cutoff_at: null, after_file_id: null, next_after_file_id: null, results: { scanned: 0, eligible: 0, purged: 0, skipped: 0 } } });
    await waitFor(() => expect(button(t('savePolicy')).disabled).toBe(false));
    expect(writes()).toHaveLength(1);
  });

  it('shows a failed run as an alert with the server message, a forbidden one in plain words, and keeps the page', async () => {
    await renderLoaded();
    platformApi.mockImplementationOnce(async () => { throw new ApiError(422, 'Retention policy is disabled'); });
    fireEvent.click(button(t('runRetention')));
    expect((await screen.findByText('Retention policy is disabled')).closest('[role="alert"]')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    platformApi.mockImplementationOnce(async () => { throw new ApiError(403, 'حدث خطأ'); });
    fireEvent.click(button(t('runRetention')));
    expect((await screen.findByText(t('platForbidden'))).closest('[role="alert"]')).toBeTruthy();
    expect(screen.getByText(t('platBatches'))).toBeTruthy();
  });
});

describe('retention policy', () => {
  it('saves the same payload, requires a whole number of days from 1 to 3650, and sends nothing for an invalid value', async () => {
    await renderLoaded();
    const input = screen.getByLabelText(t('retentionDaysLabel')) as HTMLInputElement;
    expect(input.className).toContain('h-11');
    for (const bad of ['0', '3651', '1.5', '']) {
      fireEvent.change(input, { target: { value: bad } });
      expect(button(t('savePolicy')).disabled).toBe(true);
      expect(input.getAttribute('aria-invalid')).toBe('true');
    }
    expect(writes()).toHaveLength(0);
    fireEvent.change(input, { target: { value: '400' } });
    fireEvent.click(screen.getByLabelText(t('policyEnabled')));
    expect(button(t('savePolicy')).disabled).toBe(false);
    platformApi.mockImplementationOnce(async () => ({ data: {} }));
    fireEvent.click(button(t('savePolicy')));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual(['/platform/document-retention-policy', { method: 'PATCH', body: { retention_days: 400, enabled: false } }]);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(t('policySaved')));
  });
});

describe('audit export', () => {
  it('starts one download, reports success as status, and the demo outcome and failures distinctly', async () => {
    await renderLoaded();
    platformDownloadFile.mockResolvedValueOnce('downloaded');
    fireEvent.click(button(t('exportAudit')));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(t('exported')));
    expect(platformDownloadFile).toHaveBeenCalledWith('/platform/document-audit/export', 'platform-document-audit.csv');
    platformDownloadFile.mockResolvedValueOnce('demo');
    fireEvent.click(button(t('exportAudit')));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(t('exportDemoUnavailable')));
    platformDownloadFile.mockRejectedValueOnce(new ApiError(429, 'Too many exports'));
    fireEvent.click(button(t('exportAudit')));
    expect((await screen.findByText('Too many exports')).closest('[role="alert"]')).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it('shows translated texts for a refused or failed export, never a server body', async () => {
    await renderLoaded();
    // 401: the library already cleared the platform session and redirects; the page's own translated text is shown
    platformDownloadFile.mockRejectedValueOnce(new ApiError(401, ''));
    fireEvent.click(button(t('exportAudit')));
    expect((await screen.findByText(t('platformActionFailed'))).closest('[role="alert"]')).toBeTruthy();
    // 403: a permission refusal in plain words, not a session expiry
    platformDownloadFile.mockRejectedValueOnce(new ApiError(403, ''));
    fireEvent.click(button(t('exportAudit')));
    expect((await screen.findByText(t('platForbidden'))).closest('[role="alert"]')).toBeTruthy();
    // 500: the library passes no server text on, so the generic translated text is shown
    platformDownloadFile.mockRejectedValueOnce(new ApiError(500, ''));
    fireEvent.click(button(t('exportAudit')));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(t('platformActionFailed')));
    expect(writes()).toHaveLength(0);
  });

  it('does not start a second export while one is running', async () => {
    await renderLoaded();
    const pending = deferred<string>();
    platformDownloadFile.mockImplementationOnce(() => pending.promise);
    fireEvent.click(button(t('exportAudit')));
    expect(button(t('exportAudit')).disabled).toBe(true);
    fireEvent.click(button(t('exportAudit')));
    expect(platformDownloadFile).toHaveBeenCalledTimes(1);
    pending.resolve('downloaded');
    await waitFor(() => expect(button(t('exportAudit')).disabled).toBe(false));
  });
});

describe('locales', () => {
  it('has every new key in both languages, including every known status', () => {
    const keys = ['platForbidden', 'platNotFound', 'platScopeNote', 'platQueued', 'platStatesTitle', 'platBatches', 'platRuns', 'platBatchesEmpty', 'platRunsEmpty', 'platDaysHint',
      'platPolicyDisabledNote', 'platDryEffect', 'platApplyEffect', 'platPeriod', 'platRunHistory', 'platRunDry', 'platRunApplied', 'platScanned', 'platEligible', 'platSkipped', 'platCreatedAt', 'platCutoff', 'platLastRun'];
    const batch = ['draft', 'receiving', 'received', 'queued', 'processing', 'needs_review', 'reviewed', 'ready_for_draft', 'creating_draft', 'draft_created', 'archived', 'failed', 'quarantined', 'duplicate', 'cancelled'].map((s) => `platBatch_${s}`);
    const runs = ['queued', 'running', 'succeeded', 'failed', 'cancelled'].map((s) => `platRun_${s}`);
    const retention = ['planned', 'completed', 'failed'].map((s) => `platRet_${s}`);
    for (const lang of [ar, en]) for (const key of [...keys, ...batch, ...runs, ...retention]) expect(typeof (lang.documentOperations as Record<string, unknown>)[key]).toBe('string');
  });

  it('renders in Arabic with Arabic status labels and grouped Latin digits', async () => {
    locale = 'ar';
    render(<PlatformDocumentOperationsPage />);
    await screen.findByText(ar.documentOperations.platBatches);
    expect(screen.getByText(ar.documentOperations.platScopeNote)).toBeTruthy();
    expect(screen.getByText(ar.documentOperations.platBatch_quarantined)).toBeTruthy();
    expect(screen.getAllByText('1,234,567').length).toBeGreaterThan(0);
  });
});
