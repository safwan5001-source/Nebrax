// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JournalEntriesPage from './page';

const { api, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    title: 'Journal Entries',
    subtitle: 'A unified register of posted automatic and manual general-ledger entries.',
    drafts: 'Manual Journal Drafts',
    newManual: 'New Manual Journal',
    number: 'Journal No.',
    date: 'Date',
    source: 'Source & Description',
    type: 'Type',
    amount: 'Amount',
    actions: 'Actions',
    automatic: 'Automatic',
    manual: 'Manual',
    reversal: 'Reversal',
    view: 'View',
    viewSource: 'View Source',
    search: 'Search by journal number, source, or description…',
    empty: 'No posted journal entries in the selected scope.',
    noDescription: 'No description',
    filter_date_from: 'Date — from',
    filter_date_to: 'Date — to',
    filter_amount_min: 'Amount — minimum',
    filter_amount_max: 'Amount — maximum',
    sort_date_desc: 'Newest first',
    sort_date_asc: 'Oldest first',
    sort_amount_desc: 'Amount: highest',
    sort_amount_asc: 'Amount: lowest',
  };
  const translator = Object.assign((key: string) => strings[key] ?? key, {
    raw: () => ({}),
    rich: (key: string, values: Record<string, unknown> = {}) =>
      Object.values(values).filter((value) => typeof value !== 'function').join(' ') || (strings[key] ?? key),
  });
  return { api: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
// مرجعٌ ثابت لدوال التوست: عكس هذا يُعيد إنشاء `toastError` في كل عرض، فتتغيّر
// اعتماديات `load` باستمرار ويُعاد الجلب في حلقة لا تستقر أبداً على حالة الخطأ —
// وهو أثر مصطنع من المحاكاة لا من الصفحة (تُطابق `useToast` الحقيقية مراجع ثابتة).
const toastFns = { success: vi.fn(), error: vi.fn() };
vi.mock('@/components/ui/toast', () => ({ useToast: () => toastFns }));
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

const baseEntry = {
  id: 'je1', number: 'JE-2026-0001', entry_date: '2026-06-12',
  description: 'Invoice INV-2026-0100 posting', status: 'posted', entry_kind: 'automatic' as const,
  source_type: 'App\\Models\\Invoice', source_id: 'inv-100', total: '1150.00',
};

function respondWith(entries: unknown[]) {
  api.mockImplementation(() => Promise.resolve({ data: entries }));
}

function respondWithError() {
  api.mockImplementation(() => Promise.reject(new Error('network down')));
}

async function firstMobileRecord() {
  const list = await screen.findByRole('list');
  return within(list).getAllByRole('listitem')[0];
}

describe('JournalEntriesPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.mockReset();
  });

  it('renders the header with drafts and new-manual-journal actions', async () => {
    respondWith([baseEntry]);
    render(<JournalEntriesPage />);

    expect(screen.getByRole('heading', { name: 'Journal Entries' })).toBeTruthy();
    expect(await screen.findByRole('link', { name: /New Manual Journal/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Manual Journal Drafts/ })).toBeTruthy();
  });

  it('shows a busy state before the data resolves', () => {
    api.mockImplementation(() => new Promise(() => {}));
    render(<JournalEntriesPage />);

    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  });

  it('shows an error state on API failure, with a working retry', async () => {
    respondWithError();
    render(<JournalEntriesPage />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();

    respondWith([baseEntry]);
    await userEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect((await screen.findAllByText('JE-2026-0001')).length).toBeGreaterThan(0);
  });

  it('shows the empty state when there are genuinely no journal entries', async () => {
    respondWith([]);
    render(<JournalEntriesPage />);

    expect(await screen.findByText('No posted journal entries in the selected scope.')).toBeTruthy();
  });

  it('orders the mobile record: number, then description, then amount, then type', async () => {
    respondWith([baseEntry]);
    render(<JournalEntriesPage />);

    const record = await firstMobileRecord();
    const text = record.textContent ?? '';
    expect(text.indexOf('JE-2026-0001')).toBeLessThan(text.indexOf('Invoice INV-2026-0100 posting'));
    expect(text.indexOf('Invoice INV-2026-0100 posting')).toBeLessThan(text.indexOf('1,150.00'));
    expect(text.indexOf('1,150.00')).toBeLessThan(text.indexOf('Automatic'));
  });

  it('falls back to a placeholder when a manual entry has no description', async () => {
    respondWith([{ ...baseEntry, description: null, entry_kind: 'manual' }]);
    render(<JournalEntriesPage />);

    const record = within(await firstMobileRecord());
    expect(record.getByText('No description')).toBeTruthy();
  });

  it('links to the originating source document when one exists', async () => {
    respondWith([baseEntry]);
    render(<JournalEntriesPage />);

    await screen.findAllByText('JE-2026-0001');
    const sourceLinks = screen.getAllByRole('link', { name: 'View Source' });
    expect(sourceLinks.length).toBeGreaterThan(0);
    expect(sourceLinks[0].getAttribute('href')).toBe('/invoices/inv-100');
  });

  it('omits the source link for an entry without a resolvable source', async () => {
    respondWith([{ ...baseEntry, source_type: null, source_id: null }]);
    render(<JournalEntriesPage />);

    await screen.findAllByText('JE-2026-0001');
    expect(screen.queryByRole('link', { name: 'View Source' })).toBeNull();
  });
});
