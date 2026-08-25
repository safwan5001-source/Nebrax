/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExpenseDetailPage from './page';

const { api, push, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    back: 'Back',
    loading: 'Loading…',
    retry: 'Try again',
    expense_document: 'Expense {number}',
    expense_not_found: 'This expense could not be found.',
    load_detail_failed: 'Could not load the expense.',
    saveFailed: 'Could not save.',
    detail_title: 'Expense details',
    attachments: 'Attachments',
    financial_summary: 'Financial summary',
    no_attachments: 'No attachments',
    number: 'Number',
    date: 'Date',
    account: 'Expense account',
    category: 'Category',
    no_category: 'No category',
    vendor_name: 'Vendor',
    supplier: 'Supplier',
    none: 'None',
    cost_center: 'Cost centre',
    no_center: 'No cost centre',
    payment_method: 'Payment method',
    'method.bank': 'Bank transfer',
    description: 'Description',
    subtotal: 'Subtotal',
    tax_total: 'Tax',
    total: 'Total',
    draft: 'Draft',
    posted: 'Posted',
    cancelled: 'Cancelled',
    prints: 'Print',
    edit: 'Edit',
    duplicate: 'Duplicate',
    delete: 'Delete',
    post: 'Post',
    posting: 'Posting…',
    draft_action_only: 'Drafts only.',
    linked_draft_delete_blocked: 'Linked to a source document.',
    journal_entry_created: 'Journal entry created',
    journal_entry_pending: 'No journal entry yet',
    posted_immutable_note: 'Posted documents cannot be edited.',
    draft_posting_note: 'Posting creates a balanced journal entry.',
    source_document: 'Source document',
    download: 'Download',
    downloading: 'Downloading…',
    unknown_file_type: 'Unknown type',
    post_success: 'Posted',
    duplicate_success: 'Duplicated',
    deleted_success: 'Deleted',
    confirm_post_expense: 'Post this expense?',
    confirm_delete_expense: 'Delete this expense?',
  };
  const translator = Object.assign(
    (key: string, values?: Record<string, unknown>) =>
      (strings[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? '')),
    { raw: () => ({}), rich: (key: string) => strings[key] ?? key }
  );
  return { api: vi.fn(), push: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'ex1' }),
  useRouter: () => ({ push, replace: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/lib/api', () => ({
  api,
  ApiError: class ApiError extends Error {},
  downloadFile: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/components/ui/toast', () => {
  const fns = { success: vi.fn(), error: vi.fn() };
  return { useToast: () => fns };
});
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

const draftExpense = {
  id: 'ex1', number: 'EXP-2026-00004', account_code: '5140', account_name: 'Fuel',
  category_name: 'Rent & utilities', partner_name: null, vendor_name: 'Saudi Electricity Co.',
  cost_center_name: null, cost_center_code: null, journal_entry_id: null,
  expense_date: '2026-06-25', payment_method: 'bank', description: 'Showroom rent',
  amount: '12000.00', tax_rate: 15, tax_amount: '1800.00', total: '13800.00',
  status: 'draft' as const, document_linked: false, attachments: [],
};

const respond = (expense: unknown) => api.mockImplementation(() => Promise.resolve({ data: expense }));

/**
 * الإجراءات الثانوية التي تتجاوز حدّ العرض المباشر تنزل إلى قائمة الفائض
 * (`role="menuitem"`) بدل أن تزدحم في صفّ واحد — فالبحث يشمل الشكلين.
 */
function action(name: string) {
  // `hidden: true` لأن عناصر قائمة الفائض خارج شجرة الوصول ما دامت مغلقة.
  const hits = screen.queryAllByRole('button', { name, hidden: true })
    .concat(screen.queryAllByRole('menuitem', { name, hidden: true }))
    .concat(screen.queryAllByRole('link', { name, hidden: true }));
  return hits[0] ?? null;
}

async function findAction(name: string) {
  await waitFor(() => expect(action(name)).not.toBeNull());
  return action(name) as HTMLElement;
}

describe('ExpenseDetailPage — states', () => {
  afterEach(cleanup);
  beforeEach(() => { api.mockReset(); push.mockReset(); });

  it('shows a busy state before the expense resolves', () => {
    api.mockImplementation(() => new Promise(() => {}));
    render(<ExpenseDetailPage />);

    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  });

  it('shows an error with a retry instead of a blank page when loading fails', async () => {
    api.mockImplementation(() => Promise.reject(new Error('network down')));
    render(<ExpenseDetailPage />);

    expect(await screen.findByRole('alert')).toBeTruthy();

    respond(draftExpense);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: /EXP-2026-00004/ })).toBeTruthy();
  });
});

describe('ExpenseDetailPage — populated', () => {
  afterEach(cleanup);
  beforeEach(() => { api.mockReset(); push.mockReset(); });

  it('leads with the document number and its status', async () => {
    respond(draftExpense);
    render(<ExpenseDetailPage />);

    expect(await screen.findByRole('heading', { name: /EXP-2026-00004/ })).toBeTruthy();
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
  });

  it('reports whether a journal entry exists yet', async () => {
    respond(draftExpense);
    render(<ExpenseDetailPage />);

    expect(await screen.findByText('No journal entry yet')).toBeTruthy();
  });

  it('renders the financial summary with the total set apart', async () => {
    respond(draftExpense);
    render(<ExpenseDetailPage />);

    // `formatRiyal` يلحق رمز الريال بالرقم، فالمطابقة بنمطٍ لا بنصٍّ حرفي.
    const totals = await screen.findAllByText(/13,800\.00/);
    expect(totals.some((node) => node.className.includes('font-bold'))).toBe(true);
    expect(totals[0].className).toContain('num');
  });

  it('never prints a currency word beside the amounts', async () => {
    respond(draftExpense);
    const { container } = render(<ExpenseDetailPage />);

    await screen.findAllByText(/13,800\.00/);
    // الرمز المعتمد \u20C1 وحده — لا «SAR» ولا «ريال» ولا الرمز القديم.
    expect(container.textContent).not.toMatch(/SAR|ريال|ر\.س|﷼/);
    expect(container.textContent).toContain('\u20C1');
  });
});

describe('ExpenseDetailPage — status-driven actions', () => {
  afterEach(cleanup);
  beforeEach(() => { api.mockReset(); push.mockReset(); });

  it('offers posting, editing and deleting on a draft', async () => {
    respond(draftExpense);
    render(<ExpenseDetailPage />);

    expect(await findAction('Post')).toBeTruthy();
    expect(action('Edit')!.getAttribute('href')).toBe('/expenses/new?edit=ex1');
    expect((action('Delete') as HTMLButtonElement).disabled).toBe(false);
  });

  it('withdraws posting and editing once the expense is posted', async () => {
    respond({ ...draftExpense, status: 'posted', journal_entry_id: 'je-6' });
    render(<ExpenseDetailPage />);

    await screen.findByRole('heading', { name: /EXP-2026-00004/ });
    expect(action('Post')).toBeNull();
    expect(action('Edit')).toBeNull();
    expect((action('Delete') as HTMLButtonElement).disabled).toBe(true);
  });

  it('blocks deleting a draft that came from a source document, and says why', async () => {
    respond({ ...draftExpense, document_linked: true });
    render(<ExpenseDetailPage />);

    const remove = await findAction('Delete');
    expect((remove as HTMLButtonElement).disabled).toBe(true);
    // التفسير يرافق الإجراء حتى داخل قائمة الفائض، وإلا بدا التعطيل عطلاً.
    expect(remove.getAttribute('title')).toBe('Linked to a source document.');
  });

  it('posts the draft through the posting endpoint after confirmation', async () => {
    respond(draftExpense);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ExpenseDetailPage />);

    await userEvent.click(await findAction('Post'));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/expenses/ex1/post', expect.objectContaining({ method: 'POST' })));
  });

  it('leaves the draft alone when the confirmation is declined', async () => {
    respond(draftExpense);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ExpenseDetailPage />);

    await userEvent.click(await findAction('Post'));

    expect(api).not.toHaveBeenCalledWith('/expenses/ex1/post', expect.anything());
  });

  it('switches the posting note once the expense is immutable', async () => {
    respond({ ...draftExpense, status: 'posted', journal_entry_id: 'je-6' });
    render(<ExpenseDetailPage />);

    expect((await screen.findAllByText('Posted documents cannot be edited.')).length).toBeGreaterThan(0);
  });
});

describe('ExpenseDetailPage — sections', () => {
  afterEach(cleanup);
  beforeEach(() => { api.mockReset(); push.mockReset(); });

  it('opens the details section first on mobile and switches on demand', async () => {
    respond(draftExpense);
    const { container } = render(<ExpenseDetailPage />);
    await screen.findByRole('heading', { name: /EXP-2026-00004/ });

    const accordion = container.querySelector('.lg\\:hidden') as HTMLElement;
    const headers = within(accordion).getAllByRole('button');
    expect(headers[0].getAttribute('aria-expanded')).toBe('true');

    await userEvent.click(headers[1]);
    expect(headers[0].getAttribute('aria-expanded')).toBe('false');
    expect(headers[1].getAttribute('aria-expanded')).toBe('true');
  });

  it('counts the attachments beside the section title', async () => {
    respond({
      ...draftExpense,
      attachments: [{ id: 'a1', original_name: 'invoice.pdf', mime_type: 'application/pdf', size: 2048 }],
    });
    const { container } = render(<ExpenseDetailPage />);
    await screen.findByRole('heading', { name: /EXP-2026-00004/ });

    const accordion = container.querySelector('.lg\\:hidden') as HTMLElement;
    expect(within(accordion).getByText('1')).toBeTruthy();
  });

  it('says so plainly when there are no attachments', async () => {
    respond(draftExpense);
    render(<ExpenseDetailPage />);

    expect((await screen.findAllByText('No attachments')).length).toBeGreaterThan(0);
  });
});
