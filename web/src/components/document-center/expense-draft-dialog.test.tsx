// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { ExpenseDraftDialog } from './expense-draft-dialog';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), api }));

const labels = {
  title: 'title', reason: 'reason', account: 'account', category: 'category', costCenter: 'costCenter', paymentMethod: 'paymentMethod',
  chooseAccount: 'chooseAccount', noCategory: 'noCategory', noCostCenter: 'noCostCenter', cash: 'cash', bank: 'bank', credit: 'credit',
  cancel: 'cancel', create: 'create', required: 'required', loadOptions: 'loadOptions', optionsFailed: 'optionsFailed', retry: 'retry',
  failed: 'failed', stale: 'stale', repeatTitle: 'repeatTitle', repeatBody: 'repeatBody', repeatConfirm: 'repeatConfirm', repeatSubmit: 'repeatSubmit',
};

function mockApi(postResponses: Array<unknown | Error>) {
  const posts: Array<Record<string, unknown>> = [];
  api.mockImplementation((path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
    if (options?.method === 'POST') {
      posts.push(options.body ?? {});
      const next = postResponses.shift();
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next ?? {});
    }
    if (path === '/accounts') return Promise.resolve({ data: [{ id: 'acc-1', code: '5130', name: 'مصروفات', type: 'expense', is_group: false }] });
    return Promise.resolve({ data: [] });
  });
  return posts;
}

const repeatRefusal = () => new ApiError(422, 'dup', { reason: 'duplicate_document', distinct_confirmable: true });

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByLabelText('account');
  await user.type(screen.getByLabelText('reason'), 'سبب');
  await user.selectOptions(screen.getByLabelText('account'), 'acc-1');
  await user.click(screen.getByRole('button', { name: 'create' }));
}

describe('ExpenseDraftDialog — distinct-occurrence confirmation (IMP-DOC-DISTINCT-01)', () => {
  beforeEach(() => {
    api.mockReset();
  });
  afterEach(cleanup);

  it('never sends the confirmation on the first submit and shows the second step only after a confirmable refusal', async () => {
    const user = userEvent.setup();
    const posts = mockApi([repeatRefusal()]);
    render(<ExpenseDraftDialog open onClose={vi.fn()} endpoint="/document-batches/b1/create-expense-draft" expectedVersion={3} onSuccess={vi.fn()} labels={labels} />);

    expect(screen.queryByText('repeatTitle')).toBeNull();
    await fillAndSubmit(user);

    await screen.findByText('repeatTitle');
    expect(posts).toHaveLength(1);
    expect('confirm_distinct_occurrence' in posts[0]).toBe(false);
    // الزر الجديد معطّل حتى التأكيد الصريح.
    const submit = screen.getByRole('button', { name: 'repeatSubmit' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('sends confirm_distinct_occurrence only after the explicit checkbox, then succeeds once', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const posts = mockApi([repeatRefusal(), { data: {} }]);
    render(<ExpenseDraftDialog open onClose={vi.fn()} endpoint="/e" expectedVersion={3} onSuccess={onSuccess} labels={labels} />);

    await fillAndSubmit(user);
    await user.click(await screen.findByRole('checkbox', { name: 'repeatConfirm' }));
    await user.click(screen.getByRole('button', { name: 'repeatSubmit' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(posts).toHaveLength(2);
    expect(posts[1]).toMatchObject({ confirm_distinct_occurrence: true, expected_version: 3, account_id: 'acc-1' });
  });

  it('does not offer the confirmation for a refusal that is not confirmable (same document)', async () => {
    const user = userEvent.setup();
    mockApi([new ApiError(422, 'نفس المستند', { reason: 'duplicate_document', distinct_confirmable: false })]);
    render(<ExpenseDraftDialog open onClose={vi.fn()} endpoint="/e" expectedVersion={1} onSuccess={vi.fn()} labels={labels} />);

    await fillAndSubmit(user);
    await screen.findByText('نفس المستند');
    expect(screen.queryByText('repeatTitle')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('drops a pending confirmation when the reviewer edits the account (it applied to the old inputs)', async () => {
    const user = userEvent.setup();
    mockApi([repeatRefusal()]);
    render(<ExpenseDraftDialog open onClose={vi.fn()} endpoint="/e" expectedVersion={1} onSuccess={vi.fn()} labels={labels} />);

    await fillAndSubmit(user);
    await user.click(await screen.findByRole('checkbox', { name: 'repeatConfirm' }));
    await user.type(screen.getByLabelText('reason'), ' إضافة');

    expect(screen.queryByText('repeatTitle')).toBeNull();
    expect((screen.getByRole('button', { name: 'create' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
