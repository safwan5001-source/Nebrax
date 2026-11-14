// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_MESSAGES, type TestLocale } from '@/test-utils/intl';
import { ACCOUNT_CLEARING, actions, detail, FILL_ID, postingFacts, postingPreview, reversalPreview, writeOk } from './__fixtures__';

type Call = { path: string; method: string; body: unknown };
const state = vi.hoisted(() => ({ handler: (_path: string, _opts: { method?: string; body?: unknown }) => ({}) as unknown }));
const calls = vi.hoisted(() => [] as Array<{ path: string; method: string; body: unknown }>);

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    calls.push({ path, method: opts.method ?? 'GET', body: opts.body });
    const result = await state.handler(path, opts);
    if (result instanceof Error) throw result;
    return result;
  }),
}));

import { ApiError } from '@/lib/api';
import { OperationDialog } from './operation-dialog';

const T = (locale: TestLocale) => TEST_MESSAGES[locale].fuelTankerFills;
const writes = (): Call[] => calls.filter((c) => c.method === 'POST');
const POST_PATH = `/fuel-stations/tanker-fills/${FILL_ID}/inventory-posting`;
const REVERSE_PATH = `/fuel-stations/tanker-fills/${FILL_ID}/inventory-reversal`;

interface Handlers { postingPreview?: unknown; reversalPreview?: unknown; post?: () => unknown; reverse?: () => unknown; detail?: () => unknown }
function serve(h: Handlers = {}) {
  state.handler = async (path, opts) => {
    if (path === `${POST_PATH}/preview`) return h.postingPreview ?? postingPreview();
    if (path === `${REVERSE_PATH}/preview`) return h.reversalPreview ?? reversalPreview();
    if (path === POST_PATH && opts.method === 'POST') return (h.post ?? (() => writeOk('posted')))();
    if (path === REVERSE_PATH && opts.method === 'POST') return (h.reverse ?? (() => writeOk('reversed')))();
    if (path === `/fuel-stations/tanker-fills/${FILL_ID}/inventory`) return (h.detail ?? (() => detail()))();
    throw new Error(`unexpected ${opts.method ?? 'GET'} ${path}`);
  };
}

const onChanged = vi.fn();
const onClose = vi.fn();

function mount(locale: TestLocale, operation: 'post' | 'reverse', over: Partial<ReturnType<typeof actions>> = {}) {
  return renderIntl(
    <OperationDialog operation={operation} fillId={FILL_ID} fillNumber="FTF-2027-00001" quantityMilliliters={2_000_000} actions={{ ...actions(), preview_reversal: true, reverse: true, ...over }} onChanged={onChanged} onClose={onClose} />,
    locale,
  );
}
const confirmButton = () => document.querySelector('[data-confirm]') as HTMLButtonElement | null;
const flow = () => (document.querySelector('[data-operation-dialog]') as HTMLElement).getAttribute('data-flow');
const readyDialog = async () => { await waitFor(() => expect(document.querySelector('[data-preview-status]')).not.toBeNull()); };

beforeEach(() => { calls.length = 0; onChanged.mockReset(); onClose.mockReset(); serve(); });
afterEach(cleanup);

describe.each(['ar', 'en'] as const)('OperationDialog posting (%s)', (locale) => {
  const text = T(locale);

  it('loads the preview with a GET only: status, entry lines by role, masked/unmasked amount and consequences before the button', async () => {
    mount(locale, 'post');
    await readyDialog();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET ${POST_PATH}/preview`]);
    expect(screen.getByText(text.dialog.status.post.ready)).toBeTruthy();
    const lines = Array.from(document.querySelectorAll('[data-entry-line]')) as HTMLElement[];
    expect(lines.map((l) => l.getAttribute('data-entry-line'))).toEqual(['debit', 'credit']);
    expect(lines[0].textContent).toContain(text.dialog.entry.role.tanker_issue_clearing);
    expect(lines[1].textContent).toContain(text.dialog.entry.role.inventory);
    expect(lines[0].textContent).toContain(ACCOUNT_CLEARING.slice(0, 8));
    expect((document.querySelector('[data-entry] [data-amount]') as HTMLElement).textContent).toContain('6,543.21');
    expect(document.querySelector('[data-consequences]')?.textContent).toContain(text.dialog.consequences.post);
    expect(confirmButton()).not.toBeNull();
  });

  it('masks the amount and the accounts with a hidden marker when the server withheld them', async () => {
    serve({ postingPreview: postingPreview({ entry: { lines: [{ side: 'debit', account_id: null, role: 'tanker_issue_clearing' }, { side: 'credit', account_id: null, role: 'inventory' }], entry_date: '2027-01-26', amount_minor: null } }) });
    mount(locale, 'post');
    await readyDialog();
    expect(document.querySelector('[data-entry] [data-amount]')).toBeNull();
    expect(document.querySelectorAll('[data-entry] [data-hidden]').length).toBe(3);
    expect(screen.getAllByText(text.hidden).length).toBe(3);
  });

  it('a successful posting sends only reason/confirm_historical, shows the result (201) and tells the page to refetch', async () => {
    mount(locale, 'post');
    await readyDialog();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  ترحيل عادي  ' } });
    fireEvent.click(confirmButton() as HTMLElement);
    await waitFor(() => expect(flow()).toBe('ok'));
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ path: POST_PATH, method: 'POST', body: { reason: 'ترحيل عادي' } });
    expect(Object.keys(writes()[0].body as object)).toEqual(['reason']);
    expect(screen.getByText(text.dialog.outcome.ok.post)).toBeTruthy();
    expect(document.querySelector('[data-outcome="ok"]')?.getAttribute('data-replayed')).toBe('false');
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(confirmButton()).toBeNull(); // لا إرسال ثانٍ بعد النجاح
  });

  it('a replayed 200 is reported as already done, nothing repeated', async () => {
    serve({ post: () => writeOk('posted', true) });
    mount(locale, 'post');
    await readyDialog();
    fireEvent.click(confirmButton() as HTMLElement);
    await waitFor(() => expect(flow()).toBe('ok'));
    expect(document.querySelector('[data-outcome="ok"]')?.getAttribute('data-replayed')).toBe('true');
    expect(screen.getByText(text.dialog.outcome.replayed)).toBeTruthy();
    expect(screen.getByText(text.dialog.outcome.replayedBody)).toBeTruthy();
    expect(writes()[0].body).toEqual({});
  });

  it('blocks a double click: the lock and the disabled button allow exactly one POST', async () => {
    let release: (value: unknown) => void = () => {};
    state.handler = async (path, opts) => {
      if (path.endsWith('/preview')) return postingPreview();
      if (opts.method === 'POST') return new Promise((resolve) => { release = resolve; });
      return {};
    };
    mount(locale, 'post');
    await readyDialog();
    const button = confirmButton() as HTMLButtonElement;
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(flow()).toBe('sending'));
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);
    expect(writes()).toHaveLength(1);
    // الإغلاق ممنوع أثناء الإرسال.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    release(writeOk('posted'));
    await waitFor(() => expect(flow()).toBe('ok'));
    expect(writes()).toHaveLength(1);
  });

  it('a rejection (422 with blockers) shows the translated reason and blockers, and nothing changed', async () => {
    serve({ post: () => new ApiError(422, 'السند محجوب عن الترحيل.', { message: 'السند محجوب عن الترحيل.', reason: 'posting_blocked', details: { blockers: ['period_locked', 'brand_new'] } }) });
    mount(locale, 'post');
    await readyDialog();
    fireEvent.click(confirmButton() as HTMLElement);
    await waitFor(() => expect(flow()).toBe('rejected'));
    const panel = document.querySelector('[data-outcome="rejected"]') as HTMLElement;
    expect(panel.getAttribute('data-reason')).toBe('posting_blocked');
    expect(within(panel).getByText(text.reason.posting_blocked)).toBeTruthy();
    expect(within(panel).getByText(text.blocker.period_locked)).toBeTruthy();
    expect(within(panel).getByText(text.blocker.unknown.replace('{code}', 'brand_new'))).toBeTruthy();
    expect(screen.getByText(text.dialog.outcome.rejected)).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
    // الرفض لا أثر له: يجوز إعادة المحاولة بقرار المستخدم (القفل تحرّر).
    expect(confirmButton()).not.toBeNull();
  });

  it('after a server rejection the preview is refreshed silently (new blockers appear) without any second write', async () => {
    let previews = 0;
    state.handler = async (path, opts) => {
      if (path === `${POST_PATH}/preview`) { previews += 1; return previews === 1 ? postingPreview() : postingPreview({ status: 'blocked', blockers: ['period_locked'] }); }
      if (opts.method === 'POST') return new ApiError(422, 'x', { message: 'x', reason: 'period_locked' });
      return {};
    };
    mount(locale, 'post');
    await readyDialog();
    fireEvent.click(confirmButton() as HTMLElement);
    await waitFor(() => expect(flow()).toBe('rejected'));
    await waitFor(() => expect(previews).toBe(2));
    await waitFor(() => expect(screen.getByText(text.dialog.status.post.blocked)).toBeTruthy());
    expect(confirmButton()).toBeNull();
    expect(writes()).toHaveLength(1);
  });

  it.each([[403, 'forbidden'], [404, 'not_found'], [409, 'fill_not_pending'], [422, 'insufficient_stock']])('translates a %s rejection with reason %s', async (status, reason) => {
    serve({ post: () => new ApiError(status, 'x', { message: 'x', reason }) });
    mount(locale, 'post');
    await readyDialog();
    fireEvent.click(confirmButton() as HTMLElement);
    await waitFor(() => expect(flow()).toBe('rejected'));
    expect(within(document.querySelector('[data-outcome="rejected"]') as HTMLElement).getByText(text.reason[reason as keyof typeof text.reason] as string)).toBeTruthy();
  });

  it('an unknown reason code from the server is shown raw', async () => {
    serve({ post: () => new ApiError(422, 'x', { message: 'x', reason: 'brand_new_reason' }) });
    mount(locale, 'post');
    await readyDialog();
    fireEvent.click(confirmButton() as HTMLElement);
    await waitFor(() => expect(flow()).toBe('rejected'));
    expect(screen.getByText(text.reason.unknown.replace('{code}', 'brand_new_reason'))).toBeTruthy();
  });

  it('a network cut after sending is UNKNOWN: amber state, no auto-resend, "check state" re-reads the fill (GET) and, if it is now posted, reports done without another POST', async () => {
    serve({ post: () => new TypeError('Failed to fetch'), detail: () => detail({ inventory_status: 'posted' }, { posting: postingFacts() }) });
    mount(locale, 'post');
    await readyDialog();
    fireEvent.click(confirmButton() as HTMLElement);
    await waitFor(() => expect(flow()).toBe('unknown'));
    expect(screen.getByText(text.dialog.outcome.unknown)).toBeTruthy();
    expect(screen.getByText(text.dialog.outcome.unknownBody.network)).toBeTruthy();
    expect(document.querySelector('[data-result="warning"]')).not.toBeNull();
    // لا زر تأكيد ولا إعادة محاولة عمياء، وأي إرسال لم يتكرر.
    expect(confirmButton()).toBeNull();
    expect(document.querySelector('[data-retry]')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(writes()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: text.dialog.outcome.verify }));
    await waitFor(() => expect(flow()).toBe('verified_done'));
    expect(screen.getByText(text.dialog.outcome.verifiedDone.post)).toBeTruthy();
    expect(writes()).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'GET' && c.path === `/fuel-stations/tanker-fills/${FILL_ID}/inventory`)).toHaveLength(1);
    expect(document.querySelector('[data-retry]')).toBeNull();
    expect(onChanged).toHaveBeenCalled();
  });

  it('after an unknown outcome whose re-read shows no change, retry is offered only then, and needs an explicit click before a second POST', async () => {
    let attempt = 0;
    serve({ post: () => { attempt += 1; if (attempt === 1) return new ApiError(503, 'x', {}); return writeOk('posted'); }, detail: () => detail() });
    mount(locale, 'post');
    await readyDialog();
    fireEvent.click(confirmButton() as HTMLElement);
    await waitFor(() => expect(flow()).toBe('unknown'));
    expect(screen.getByText(text.dialog.outcome.unknownBody.server)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: text.dialog.outcome.verify }));
    await waitFor(() => expect(flow()).toBe('verified_unchanged'));
    expect(screen.getByText(text.dialog.outcome.verifiedUnchanged)).toBeTruthy();
    expect(writes()).toHaveLength(1);

    fireEvent.click(document.querySelector('[data-retry]') as HTMLElement);
    await waitFor(() => expect(flow()).toBe('idle'));
    await readyDialog();
    expect(writes()).toHaveLength(1); // العودة إلى النموذج لا ترسل شيئاً
    fireEvent.click(confirmButton() as HTMLElement);
    await waitFor(() => expect(flow()).toBe('ok'));
    expect(writes()).toHaveLength(2);
  });

  it('a failed verification keeps the unknown state and offers only another check, never a resend', async () => {
    serve({ post: () => new ApiError(500, 'x', {}), detail: () => new TypeError('offline') });
    mount(locale, 'post');
    await readyDialog();
    fireEvent.click(confirmButton() as HTMLElement);
    await waitFor(() => expect(flow()).toBe('unknown'));
    fireEvent.click(screen.getByRole('button', { name: text.dialog.outcome.verify }));
    await waitFor(() => expect(flow()).toBe('verify_failed'));
    expect(screen.getByText(text.dialog.outcome.verifyFailed)).toBeTruthy();
    expect(confirmButton()).toBeNull();
    expect(document.querySelector('[data-retry]')).toBeNull();
    expect(writes()).toHaveLength(1);
  });

  it('an unparseable success body is unknown too (the operation may have happened)', async () => {
    serve({ post: () => ({ data: 'strange' }) });
    mount(locale, 'post');
    await readyDialog();
    fireEvent.click(confirmButton() as HTMLElement);
    await waitFor(() => expect(flow()).toBe('unknown'));
    expect(screen.getByText(text.dialog.outcome.unknownBody.unverified)).toBeTruthy();
  });

  it('a timeout (abort) is unknown with its own wording', async () => {
    serve({ post: () => Object.assign(new Error('aborted'), { name: 'AbortError' }) });
    mount(locale, 'post');
    await readyDialog();
    fireEvent.click(confirmButton() as HTMLElement);
    await waitFor(() => expect(flow()).toBe('unknown'));
    expect(screen.getByText(text.dialog.outcome.unknownBody.timeout)).toBeTruthy();
  });

  it('a blocked preview shows its blockers and offers no confirm button', async () => {
    serve({ postingPreview: postingPreview({ status: 'blocked', blockers: ['insufficient_stock', 'downstream_link:supply_id'] }) });
    mount(locale, 'post');
    await readyDialog();
    expect(screen.getByText(text.dialog.status.post.blocked)).toBeTruthy();
    expect(screen.getByText(text.blocker.insufficient_stock)).toBeTruthy();
    expect(screen.getByText(text.blocker.downstream_supply)).toBeTruthy();
    expect(confirmButton()).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it('without the posting action the dialog is a read-only preview: a note and no confirm button', async () => {
    mount(locale, 'post', { post: false });
    await readyDialog();
    expect(document.querySelector('[data-no-permission]')).not.toBeNull();
    expect(confirmButton()).toBeNull();
  });

  describe('historical fill', () => {
    it('requires the review checkbox and a reason before anything is sent, then sends confirm_historical', async () => {
      serve({ postingPreview: postingPreview({ historical: true }) });
      mount(locale, 'post', { post_historical: true });
      await readyDialog();
      expect(document.querySelector('[data-historical-banner]')).not.toBeNull();
      fireEvent.click(confirmButton() as HTMLElement);
      expect(writes()).toHaveLength(0);
      expect(screen.getByText(text.dialog.problem.historical_review_required)).toBeTruthy();
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(confirmButton() as HTMLElement);
      expect(writes()).toHaveLength(0);
      expect(screen.getByText(text.dialog.problem.reason_required)).toBeTruthy();
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'سند من فترة سابقة' } });
      fireEvent.click(confirmButton() as HTMLElement);
      await waitFor(() => expect(flow()).toBe('ok'));
      expect(writes()).toHaveLength(1);
      expect(writes()[0].body).toEqual({ reason: 'سند من فترة سابقة', confirm_historical: true });
    });

    it('without the historical permission there is no confirm button and no checkbox (a note instead)', async () => {
      serve({ postingPreview: postingPreview({ historical: true }) });
      mount(locale, 'post', { post_historical: false });
      await readyDialog();
      expect(document.querySelector('[data-historical-no-permission]')).not.toBeNull();
      expect(confirmButton()).toBeNull();
      expect(screen.queryByRole('checkbox')).toBeNull();
    });

    it('a non-historical fill shows no checkbox and does not send confirm_historical', async () => {
      mount(locale, 'post', { post_historical: true });
      await readyDialog();
      expect(screen.queryByRole('checkbox')).toBeNull();
      fireEvent.click(confirmButton() as HTMLElement);
      await waitFor(() => expect(flow()).toBe('ok'));
      expect(writes()[0].body).toEqual({});
    });
  });

  it('preview failures: 403 and 404 explain, a server error offers a retry that reloads the preview', async () => {
    state.handler = async () => new ApiError(403, 'x', {});
    mount(locale, 'post');
    expect(await screen.findByText(text.dialog.previewForbidden)).toBeTruthy();
    cleanup();
    state.handler = async () => new ApiError(404, 'x', {});
    mount(locale, 'post');
    expect(await screen.findByText(text.dialog.previewGone)).toBeTruthy();
    cleanup();
    state.handler = async () => new ApiError(500, 'x', {});
    mount(locale, 'post');
    expect(await screen.findByText(text.dialog.previewFailed)).toBeTruthy();
    serve();
    fireEvent.click(screen.getByRole('button', { name: TEST_MESSAGES[locale].nebrax.retry }));
    await readyDialog();
    expect(confirmButton()).not.toBeNull();
  });

  it('closing after an attempt asks the page to refetch; closing an untouched dialog does not', async () => {
    mount(locale, 'post');
    await readyDialog();
    fireEvent.click(screen.getByRole('button', { name: text.dialog.cancel }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChanged).not.toHaveBeenCalled();
    cleanup();
    onClose.mockReset();
    serve({ post: () => new ApiError(409, 'x', { reason: 'fill_not_pending' }) });
    mount(locale, 'post');
    await readyDialog();
    fireEvent.click(confirmButton() as HTMLElement);
    await waitFor(() => expect(flow()).toBe('rejected'));
    fireEvent.click(screen.getByRole('button', { name: text.dialog.cancel }));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe.each(['ar', 'en'] as const)('OperationDialog reversal (%s)', (locale) => {
  const text = T(locale);

  it('previews with a GET: reversal date, historical-cost valuation, quantity and the flipped entry lines', async () => {
    mount(locale, 'reverse');
    await readyDialog();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET ${REVERSE_PATH}/preview`]);
    expect(screen.getByText(text.dialog.status.reverse.ready)).toBeTruthy();
    expect(screen.getByText(text.dialog.entry.valuationValue.historical_cost)).toBeTruthy();
    expect(document.querySelector('[data-consequences]')?.textContent).toContain(text.dialog.consequences.reverse);
    const lines = Array.from(document.querySelectorAll('[data-entry-line]')) as HTMLElement[];
    expect(lines.map((l) => l.getAttribute('data-entry-line'))).toEqual(['debit', 'credit']);
    expect(lines[0].textContent).toContain(text.dialog.entry.account);
  });

  it('the reason is mandatory (3..500): nothing is sent until it is valid, then only reason is sent', async () => {
    mount(locale, 'reverse');
    await readyDialog();
    fireEvent.click(confirmButton() as HTMLElement);
    expect(writes()).toHaveLength(0);
    expect(screen.getByText(text.dialog.problem.reason_required)).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ab' } });
    fireEvent.click(confirmButton() as HTMLElement);
    expect(writes()).toHaveLength(0);
    expect(screen.getByText(text.dialog.problem.reason_too_short)).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  خطأ في التسجيل  ' } });
    fireEvent.click(confirmButton() as HTMLElement);
    await waitFor(() => expect(flow()).toBe('ok'));
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ path: REVERSE_PATH, method: 'POST', body: { reason: 'خطأ في التسجيل' } });
    expect(screen.getByText(text.dialog.outcome.ok.reverse)).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it('a blocked reversal (downstream link) shows its blockers and no confirm button', async () => {
    serve({ reversalPreview: reversalPreview({ status: 'blocked', blockers: ['downstream_link:invoiced_invoice_id', 'period_locked'], entry: null }) });
    mount(locale, 'reverse');
    await readyDialog();
    expect(screen.getByText(text.blocker.downstream_invoiced)).toBeTruthy();
    expect(screen.getByText(text.blocker.period_locked)).toBeTruthy();
    expect(confirmButton()).toBeNull();
  });

  it('a rejection (original entry invalid) and an unknown outcome follow the same honest model', async () => {
    serve({ reverse: () => new ApiError(422, 'x', { message: 'x', reason: 'original_entry_invalid' }) });
    mount(locale, 'reverse');
    await readyDialog();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'سبب العكس' } });
    fireEvent.click(confirmButton() as HTMLElement);
    await waitFor(() => expect(flow()).toBe('rejected'));
    expect(within(document.querySelector('[data-outcome="rejected"]') as HTMLElement).getByText(text.reason.original_entry_invalid)).toBeTruthy();
    cleanup();

    calls.length = 0;
    serve({ reverse: () => new TypeError('Failed to fetch'), detail: () => detail({ inventory_status: 'reversed' }, { posting: postingFacts({ status: 'reversed' }) }) });
    mount(locale, 'reverse');
    await readyDialog();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'سبب العكس' } });
    fireEvent.click(confirmButton() as HTMLElement);
    await waitFor(() => expect(flow()).toBe('unknown'));
    expect(confirmButton()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: text.dialog.outcome.verify }));
    await waitFor(() => expect(flow()).toBe('verified_done'));
    expect(screen.getByText(text.dialog.outcome.verifiedDone.reverse)).toBeTruthy();
    expect(writes()).toHaveLength(1);
  });

  it('a reversal whose re-read still shows the fill posted is "unchanged" and only then offers a retry', async () => {
    serve({ reverse: () => new ApiError(502, 'x', {}), detail: () => detail({ inventory_status: 'posted' }, { posting: postingFacts() }) });
    mount(locale, 'reverse');
    await readyDialog();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'سبب العكس' } });
    fireEvent.click(confirmButton() as HTMLElement);
    await waitFor(() => expect(flow()).toBe('unknown'));
    expect(document.querySelector('[data-retry]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: text.dialog.outcome.verify }));
    await waitFor(() => expect(flow()).toBe('verified_unchanged'));
    expect(document.querySelector('[data-retry]')).not.toBeNull();
    expect(writes()).toHaveLength(1);
  });

  it('without the reverse action it is a read-only preview', async () => {
    mount(locale, 'reverse', { reverse: false });
    await readyDialog();
    expect(document.querySelector('[data-no-permission]')).not.toBeNull();
    expect(confirmButton()).toBeNull();
  });
});
