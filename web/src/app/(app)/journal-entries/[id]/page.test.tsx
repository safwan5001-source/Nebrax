/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JournalEntryDetailsPage from './page';

const { api, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    back: 'Back',
    loading: 'Loading…',
    retry: 'Try again',
    loadFailed: 'Could not load the entry.',
    manual: 'Manual',
    automatic: 'Automatic',
    reversal: 'Reversal',
    noDescription: 'No description',
    viewSource: 'View source document',
    openManual: 'Open manual journal',
    accountingEffect: 'Accounting effect',
    effectHint: 'against',
    unknownAccount: 'Unnamed account',
    lines: 'Entry lines',
    account: 'Account',
    description: 'Description',
    debit: 'Debit',
    credit: 'Credit',
    totals: 'Totals',
    reversalEntry: 'Reverses entry',
  };
  const translator = Object.assign((key: string) => strings[key] ?? key, {
    raw: () => ({}),
    rich: (key: string) => strings[key] ?? key,
  });
  return { api: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'je-5' }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
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

const entry = {
  id: 'je-5', number: 'JE-2026-0005', entry_date: '2026-06-24', description: 'Posting INV-2026-0118',
  status: 'posted', entry_kind: 'automatic' as const,
  source_type: 'App\\Models\\Invoice', source_id: 'inv-118', reversal_of: null,
  lines: [
    { id: 'l1', account_code: '1130', account_name: 'Receivables', description: null, debit: '5750.00', credit: '0.00' },
    { id: 'l2', account_code: '4110', account_name: 'Sales revenue', description: null, debit: '0.00', credit: '5000.00' },
    { id: 'l3', account_code: '2120', account_name: 'Output VAT', description: null, debit: '0.00', credit: '750.00' },
  ],
};

const respond = (data: unknown) => api.mockImplementation(() => Promise.resolve({ data }));

describe('JournalEntryDetailsPage', () => {
  afterEach(cleanup);
  beforeEach(() => { api.mockReset(); });

  it('shows a busy state before the entry resolves', () => {
    api.mockImplementation(() => new Promise(() => {}));
    render(<JournalEntryDetailsPage />);

    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  });

  it('shows an error with a retry rather than a blank page when the load fails', async () => {
    api.mockImplementation(() => Promise.reject(new Error('network down')));
    render(<JournalEntryDetailsPage />);

    // كانت الصفحة تُرجع null هنا فتظهر بيضاء بلا خبرٍ ولا طريق للأمام.
    expect(await screen.findByRole('alert')).toBeTruthy();

    respond(entry);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'JE-2026-0005' })).toBeTruthy();
  });

  it('leads with the entry number and its kind', async () => {
    respond(entry);
    render(<JournalEntryDetailsPage />);

    expect(await screen.findByRole('heading', { name: 'JE-2026-0005' })).toBeTruthy();
    expect(screen.getByText('Automatic')).toBeTruthy();
  });

  it('links an automatic entry back to the document that produced it', async () => {
    respond(entry);
    render(<JournalEntryDetailsPage />);

    const link = await screen.findByRole('link', { name: 'View source document' });
    expect(link.getAttribute('href')).toBe('/invoices/inv-118');
  });

  it('sends a manual entry to its manual journal instead', async () => {
    respond({ ...entry, entry_kind: 'manual', source_type: 'App\\Models\\ManualJournal', source_id: 'mj-2' });
    render(<JournalEntryDetailsPage />);

    const link = await screen.findByRole('link', { name: 'Open manual journal' });
    expect(link.getAttribute('href')).toBe('/manual-journals/mj-2');
  });

  it('offers no source link when the entry has no source document', async () => {
    respond({ ...entry, entry_kind: 'manual', source_type: null, source_id: null });
    render(<JournalEntryDetailsPage />);

    await screen.findByRole('heading', { name: 'JE-2026-0005' });
    expect(screen.queryByRole('link', { name: 'View source document' })).toBeNull();
  });

  it('renders every line and balances the totals', async () => {
    respond(entry);
    const { container } = render(<JournalEntryDetailsPage />);
    await screen.findByRole('heading', { name: 'JE-2026-0005' });

    const table = container.querySelector('table') as HTMLElement;
    const footer = table.querySelector('tfoot') as HTMLElement;
    // مدين ٥٧٥٠ = دائن ٥٠٠٠ + ٧٥٠ — قيدٌ متوازن.
    expect(within(footer).getAllByText(/5,750\.00/)).toHaveLength(2);
  });

  it('gives the lines a mobile record view, not just a wide table', async () => {
    respond(entry);
    const { container } = render(<JournalEntryDetailsPage />);
    await screen.findByRole('heading', { name: 'JE-2026-0005' });

    const list = container.querySelector('ul.md\\:hidden') as HTMLElement;
    expect(list).toBeTruthy();
    // ثلاثة بنود + سطر الإجماليات.
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
  });

  it('falls back to a stated placeholder when the entry carries no description', async () => {
    respond({ ...entry, description: null });
    render(<JournalEntryDetailsPage />);

    expect(await screen.findByText(/No description/)).toBeTruthy();
  });

  it('names the reversed entry when this one is a reversal', async () => {
    respond({ ...entry, entry_kind: 'reversal', reversal_of: 'je-2' });
    render(<JournalEntryDetailsPage />);

    expect(await screen.findByText('Reverses entry')).toBeTruthy();
    expect(screen.getByText('je-2')).toBeTruthy();
  });
});
