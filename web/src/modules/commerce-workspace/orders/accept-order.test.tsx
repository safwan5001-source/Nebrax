// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptedFixture, awaitingFixture, detailFixture, rejectedFixture } from './test-fixtures';
import { OrderDetailView } from './order-detail';

const locale = vi.hoisted(() => ({ current: 'ar' }));
const perms = vi.hoisted(() => ({ set: new Set<string>() }));
vi.mock('next-intl', () => {
  const t = (key: string) => key;
  t.rich = (key: string) => key;
  return { useLocale: () => locale.current, useTranslations: () => t };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ can: (p: string) => perms.set.has(p), hydrated: true }) }));
const fetchOrderMock = vi.hoisted(() => vi.fn());
vi.mock('./orders-api', async () => ({ ...(await vi.importActual<object>('./orders-api')), fetchOrder: (...a: unknown[]) => fetchOrderMock(...a) }));
const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({ ...(await vi.importActual<object>('@/lib/api')), api: (...a: unknown[]) => apiMock(...a) }));
vi.mock('@/modules/commerce-workspace/store-context', () => ({ useOptionalCommerceStoreContext: () => ({ selectedStoreId: 's1' }) }));

const apiError = (status: number, body: unknown = {}) => Object.assign(new Error('x'), { status, body });
const ALL = ['commerce.orders.view', 'commerce.orders.manage', 'commerce.orders.cancel'];
const ID = detailFixture().id;

const acceptButton = () => screen.queryByRole('button', { name: 'قبول الطلب' });
const rejectButton = () => screen.queryByRole('button', { name: 'رفض الطلب' });
const cancelButton = () => screen.queryByRole('button', { name: 'إلغاء الطلب' });
async function ready() {
  await screen.findByRole('heading', { name: 'CORD-100' });
}

describe('merchant acceptance UI (COPS-H1-5)', () => {
  beforeEach(() => {
    locale.current = 'ar';
    perms.set = new Set(ALL);
    fetchOrderMock.mockReset();
    apiMock.mockReset();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  describe('eligibility, permission and gate-driven visibility', () => {
    it('offers accept and reject (and not the plain cancel) for an eligible awaiting order', async () => {
      fetchOrderMock.mockResolvedValue(awaitingFixture());
      render(<OrderDetailView id="o1" />);
      await ready();
      expect(acceptButton()).toBeTruthy();
      expect(rejectButton()).toBeTruthy();
      expect(cancelButton()).toBeNull(); // الرفض يستبدل الإلغاء أثناء انتظار القبول: لا زرّان لإجراء واحد.
      expect(screen.getAllByText('بانتظار القبول').length).toBeGreaterThan(0);
      expect(screen.getAllByText(/بانتظار قبولك قبل البدء بتجهيزه/).length).toBeGreaterThan(0);
    });

    it.each([
      ['the manage permission is missing', ['commerce.orders.view', 'commerce.orders.cancel']],
      ['the user has neither action permission', ['commerce.orders.view']],
    ])('hides accept AND reject when %s', async (_name, granted) => {
      perms.set = new Set(granted);
      fetchOrderMock.mockResolvedValue(awaitingFixture());
      render(<OrderDetailView id="o1" />);
      await ready();
      expect(acceptButton()).toBeNull();
      expect(rejectButton()).toBeNull();
    });

    it('requires BOTH manage and cancel for rejection; manage alone gets accept only (and then the regular cancel is not offered either)', async () => {
      perms.set = new Set(['commerce.orders.view', 'commerce.orders.manage']);
      fetchOrderMock.mockResolvedValue(awaitingFixture());
      render(<OrderDetailView id="o1" />);
      await ready();
      expect(acceptButton()).toBeTruthy();
      expect(rejectButton()).toBeNull();
      expect(cancelButton()).toBeNull();
    });

    it('cancel permission alone does not unlock accept or reject; it keeps the regular cancel', async () => {
      perms.set = new Set(['commerce.orders.view', 'commerce.orders.cancel']);
      fetchOrderMock.mockResolvedValue(awaitingFixture());
      render(<OrderDetailView id="o1" />);
      await ready();
      expect(acceptButton()).toBeNull();
      expect(rejectButton()).toBeNull();
      expect(cancelButton()).toBeTruthy();
    });

    it('shows no acceptance action when the contract is absent (closed gate or older server) — never inferred from status or mode', async () => {
      fetchOrderMock.mockResolvedValue(detailFixture({ acceptance: { mode: 'manual', effective_mode: 'manual', accepted_at: null }, operational_status: 'awaiting_acceptance' }));
      render(<OrderDetailView id="o1" />);
      await ready();
      expect(acceptButton()).toBeNull();
      expect(rejectButton()).toBeNull();
      expect(screen.queryByText('لا يمكن قبول هذا الطلب بعد')).toBeNull();
    });

    it('explains an unpaid online order instead of showing a dead button, without conflating it with the payment badge', async () => {
      fetchOrderMock.mockResolvedValue(
        awaitingFixture({
          operational_status: 'awaiting_payment',
          accept_action: { available: false, blocked_reason: 'payment_pending' },
          payment: { ...detailFixture().payment, method: 'online', status: 'pending', attempts: [], collection_note: null },
        }),
      );
      render(<OrderDetailView id="o1" />);
      await ready();
      expect(acceptButton()).toBeNull();
      expect(screen.getAllByText('لا يمكن قبول هذا الطلب بعد').length).toBeGreaterThan(0);
      expect(screen.getAllByText(/لم يكتمل الدفع الإلكتروني بعد/).length).toBeGreaterThan(0);
      expect(screen.queryByText('بانتظار القبول')).toBeNull(); // لا شارة «بانتظار القبول» قبل جاهزية الدفع
    });

    it.each([
      ['an accepted order', acceptedFixture(), 'مقبول'],
      ['an automatically accepted order', detailFixture({ operational_status: 'accepted', acceptance: { mode: 'auto', effective_mode: 'auto', accepted_at: null } }), 'قبول تلقائي'],
    ])('offers no accept/reject for %s and shows its state', async (_name, order, badge) => {
      fetchOrderMock.mockResolvedValue(order);
      render(<OrderDetailView id="o1" />);
      await ready();
      expect(acceptButton()).toBeNull();
      expect(rejectButton()).toBeNull();
      expect(screen.getAllByText(badge).length).toBeGreaterThan(0);
    });

    it('lists the acceptance facts (mode, actor, time) and keeps the regular cancel for an accepted order', async () => {
      fetchOrderMock.mockResolvedValue(acceptedFixture());
      render(<OrderDetailView id="o1" />);
      await ready();
      expect(screen.getAllByText('وضع القبول عند الطلب').length).toBeGreaterThan(0);
      expect(screen.getAllByText('يدوي').length).toBeGreaterThan(0);
      expect(screen.getAllByText('المشرف').length).toBeGreaterThan(0);
      expect(cancelButton()).toBeTruthy();
    });

    it('shows the effective mode only when it differs from the snapshot (closed gate after creation)', async () => {
      fetchOrderMock.mockResolvedValue(detailFixture({ operational_status: 'accepted', acceptance: { mode: 'manual', effective_mode: 'auto', accepted_at: null } }));
      render(<OrderDetailView id="o1" />);
      await ready();
      expect(screen.getAllByText('الوضع الفعّال الآن').length).toBeGreaterThan(0);
      expect(acceptButton()).toBeNull();
    });

    it('renders a rejected order as rejected with reason, note and actor and no action', async () => {
      fetchOrderMock.mockResolvedValue(rejectedFixture());
      render(<OrderDetailView id="o1" />);
      await ready();
      expect(screen.getAllByText('مرفوض').length).toBeGreaterThan(0);
      expect(screen.getAllByText('رفض التاجر').length).toBeGreaterThan(0);
      expect(screen.getAllByText('خارج نطاق التوصيل').length).toBeGreaterThan(0);
      expect(acceptButton()).toBeNull();
      expect(rejectButton()).toBeNull();
      expect(cancelButton()).toBeNull();
    });
  });

  describe('accepting', () => {
    it('posts to the dedicated endpoint with no body and renders the order the server returned', async () => {
      fetchOrderMock.mockResolvedValue(awaitingFixture());
      apiMock.mockResolvedValue({ data: acceptedFixture() });
      render(<OrderDetailView id="o1" />);
      await ready();
      fireEvent.click(acceptButton()!);

      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('تم قبول الطلب.'));
      expect(apiMock).toHaveBeenCalledTimes(1);
      expect(apiMock.mock.calls[0][0]).toBe(`/commerce/orders/${ID}/accept`);
      expect(apiMock.mock.calls[0][1]).toEqual({ method: 'POST' });
      expect(acceptButton()).toBeNull();
      expect(screen.getAllByText('مقبول').length).toBeGreaterThan(0);
      expect(cancelButton()).toBeTruthy();
    });

    it('is double-submit safe: two clicks in one frame send one request and the button is disabled while pending', async () => {
      fetchOrderMock.mockResolvedValue(awaitingFixture());
      let finish!: (value: unknown) => void;
      apiMock.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      render(<OrderDetailView id="o1" />);
      await ready();

      const button = acceptButton()!;
      fireEvent.click(button);
      fireEvent.click(button);

      await waitFor(() => expect(screen.getByRole('button', { name: 'جارٍ القبول…' })).toBeTruthy());
      expect(apiMock).toHaveBeenCalledTimes(1);
      const pending = screen.getByRole('button', { name: 'جارٍ القبول…' }) as HTMLButtonElement;
      expect(pending.disabled).toBe(true);
      expect(pending.getAttribute('aria-busy')).toBe('true');
      expect((rejectButton() as HTMLButtonElement).disabled).toBe(true);

      await act(async () => finish({ data: acceptedFixture() }));
      await waitFor(() => expect(acceptButton()).toBeNull());
      expect(apiMock).toHaveBeenCalledTimes(1);
    });

    it('a 409 race shows the specific reason, refreshes from the server and does not offer a stale retry', async () => {
      const cancelledByOther = rejectedFixture({ cancellation: { cancelled: true, at: 'x', reason: 'out_of_stock' } });
      fetchOrderMock.mockResolvedValueOnce(awaitingFixture()).mockResolvedValue(cancelledByOther);
      apiMock.mockRejectedValue(apiError(409, { message: 'x', reason: 'already_cancelled' }));
      render(<OrderDetailView id="o1" />);
      await ready();
      fireEvent.click(acceptButton()!);

      const alert = await screen.findByText(/تغيّرت حالة الطلب ولم يعد هذا الإجراء متاحاً/);
      expect(alert).toBeTruthy();
      await waitFor(() => expect(fetchOrderMock).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(acceptButton()).toBeNull());
      expect(apiMock).toHaveBeenCalledTimes(1);
    });

    it('an unconfirmed network failure refreshes the state and says the outcome was not confirmed', async () => {
      fetchOrderMock.mockResolvedValueOnce(awaitingFixture()).mockResolvedValue(acceptedFixture());
      apiMock.mockRejectedValue(Object.assign(new Error('offline'), {}));
      render(<OrderDetailView id="o1" />);
      await ready();
      fireEvent.click(acceptButton()!);

      expect(await screen.findByText(/لم يُؤكَّد الإجراء/)).toBeTruthy();
      await waitFor(() => expect(fetchOrderMock).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(acceptButton()).toBeNull()); // ظهرت الحالة الحقيقية: قُبل فعلاً
    });

    it.each([
      [apiError(403), /لا تملك صلاحية إدارة الطلبات/, 1],
      [apiError(401), /انتهت الجلسة/, 1],
      [apiError(500), /تعذّر تنفيذ الإجراء/, 1],
      [apiError(404), /الطلب غير موجود أو لا يخص هذه المؤسسة/, 2],
    ])('surfaces %s without pretending success', async (error, text, fetches) => {
      fetchOrderMock.mockResolvedValue(awaitingFixture());
      apiMock.mockRejectedValue(error);
      render(<OrderDetailView id="o1" />);
      await ready();
      fireEvent.click(acceptButton()!);

      expect(await screen.findByText(text)).toBeTruthy();
      expect(screen.queryByText('تم قبول الطلب.')).toBeNull();
      await waitFor(() => expect(fetchOrderMock.mock.calls.length).toBeGreaterThanOrEqual(fetches));
    });

    it('lets the merchant retry after a non-stale failure (the button returns)', async () => {
      fetchOrderMock.mockResolvedValue(awaitingFixture());
      apiMock.mockRejectedValueOnce(apiError(500)).mockResolvedValue({ data: acceptedFixture() });
      render(<OrderDetailView id="o1" />);
      await ready();
      fireEvent.click(acceptButton()!);
      await screen.findByText(/تعذّر تنفيذ الإجراء/);
      expect((acceptButton() as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(acceptButton()!);
      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('تم قبول الطلب.'));
      expect(apiMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('rejecting', () => {
    const openReject = async () => {
      fireEvent.click(rejectButton()!);
      return await screen.findByRole('dialog');
    };
    const confirm = () => screen.getByRole('button', { name: 'تأكيد الرفض' });

    it('explains the consequences and sends an optional trimmed note to the dedicated endpoint', async () => {
      fetchOrderMock.mockResolvedValue(awaitingFixture());
      apiMock.mockResolvedValue({ data: rejectedFixture() });
      render(<OrderDetailView id="o1" />);
      await ready();
      const dialog = await openReject();
      expect(dialog.textContent).toContain('رفض التاجر');
      expect(dialog.textContent).toContain('لا يُنشأ قيد محاسبي');
      fireEvent.change(within(dialog).getByLabelText(/ملاحظة للرفض/), { target: { value: '  خارج نطاق التوصيل  ' } });
      fireEvent.click(confirm());

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(apiMock.mock.calls[0][0]).toBe(`/commerce/orders/${ID}/reject`);
      expect(apiMock.mock.calls[0][1]).toEqual({ method: 'POST', body: { note: 'خارج نطاق التوصيل' } });
      expect(screen.getByRole('status').textContent).toContain('تم رفض الطلب.');
      expect(screen.getAllByText('مرفوض').length).toBeGreaterThan(0);
      expect(rejectButton()).toBeNull();
    });

    it('sends an empty body when no note is given and caps the note at 500 characters with a counter', async () => {
      fetchOrderMock.mockResolvedValue(awaitingFixture());
      apiMock.mockResolvedValue({ data: rejectedFixture() });
      render(<OrderDetailView id="o1" />);
      await ready();
      const dialog = await openReject();
      const note = within(dialog).getByLabelText(/ملاحظة للرفض/) as HTMLTextAreaElement;
      expect(note.maxLength).toBe(500);
      fireEvent.change(note, { target: { value: 'x'.repeat(500) } });
      expect(within(dialog).getByText('500/500')).toBeTruthy();
      fireEvent.change(note, { target: { value: '' } });
      fireEvent.click(confirm());
      await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
      expect(apiMock.mock.calls[0][1]).toEqual({ method: 'POST', body: {} });
    });

    it('is double-submit safe and cannot be dismissed while the request is in flight', async () => {
      fetchOrderMock.mockResolvedValue(awaitingFixture());
      let finish!: (value: unknown) => void;
      apiMock.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      render(<OrderDetailView id="o1" />);
      await ready();
      const dialog = await openReject();

      const button = confirm();
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.submit(dialog.querySelector('form')!);

      await waitFor(() => expect(screen.getByRole('button', { name: 'جارٍ الرفض…' })).toBeTruthy());
      expect(apiMock).toHaveBeenCalledTimes(1);
      expect(dialog.querySelector('form')!.getAttribute('aria-busy')).toBe('true');
      expect((screen.getByRole('button', { name: 'جارٍ الرفض…' }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeTruthy();

      await act(async () => finish({ data: rejectedFixture() }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(apiMock).toHaveBeenCalledTimes(1);
    });

    it('a 409 (accepted or paid meanwhile) shows the reason, refreshes the order, locks the stale confirm and hides the rejected action', async () => {
      fetchOrderMock.mockResolvedValueOnce(awaitingFixture()).mockResolvedValue(acceptedFixture());
      apiMock.mockRejectedValue(apiError(409, { message: 'x', reason: 'already_accepted' }));
      render(<OrderDetailView id="o1" />);
      await ready();
      const dialog = await openReject();
      fireEvent.click(confirm());

      expect(await within(dialog).findByText(/تغيّرت حالة الطلب ولم يعد هذا الإجراء متاحاً/)).toBeTruthy();
      expect(within(dialog).getByRole('alert').textContent).toContain('قُبل هذا الطلب بالفعل');
      await waitFor(() => expect(fetchOrderMock).toHaveBeenCalledTimes(2));
      expect((screen.getByRole('button', { name: 'تأكيد الرفض' }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(rejectButton()).toBeNull();
      expect(screen.getAllByText('مقبول').length).toBeGreaterThan(0);
    });

    it('a payment-matrix 409 explains why a paid or collected order cannot be rejected', async () => {
      fetchOrderMock.mockResolvedValueOnce(awaitingFixture()).mockResolvedValue(awaitingFixture({ reject_action: { available: false, blocked_reason: 'payment_collected' } }));
      apiMock.mockRejectedValue(apiError(409, { message: 'x', reason: 'payment_collected' }));
      render(<OrderDetailView id="o1" />);
      await ready();
      const dialog = await openReject();
      fireEvent.click(confirm());
      expect((await within(dialog).findByRole('alert')).textContent).toContain('حُصِّل مبلغ الطلب');
    });

    it('keeps the dialog correctable after a validation error and not locked', async () => {
      fetchOrderMock.mockResolvedValue(awaitingFixture());
      apiMock.mockRejectedValue(apiError(422));
      render(<OrderDetailView id="o1" />);
      await ready();
      const dialog = await openReject();
      fireEvent.click(confirm());
      expect(await within(dialog).findByText(/رفض البيانات المدخلة/)).toBeTruthy();
      expect((screen.getByRole('button', { name: 'تأكيد الرفض' }) as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe('localization', () => {
    it('renders the English LTR experience with the same eligibility rules', async () => {
      locale.current = 'en';
      fetchOrderMock.mockResolvedValue(awaitingFixture());
      apiMock.mockResolvedValue({ data: acceptedFixture() });
      render(<OrderDetailView id="o1" />);
      await screen.findByRole('heading', { name: 'CORD-100' });
      expect(screen.getByRole('button', { name: 'Accept order' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Reject order' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
      expect(screen.getAllByText('Awaiting acceptance').length).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole('button', { name: 'Accept order' }));
      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('The order was accepted.'));
      expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0);
    });

    it('translates the rejection reason and the acceptance blockers in English', async () => {
      locale.current = 'en';
      fetchOrderMock.mockResolvedValue(rejectedFixture());
      render(<OrderDetailView id="o1" />);
      await screen.findByRole('heading', { name: 'CORD-100' });
      expect(screen.getAllByText('Merchant rejected').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Rejected').length).toBeGreaterThan(0);
    });
  });
});
