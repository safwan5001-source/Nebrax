// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detailFixture } from './test-fixtures';
import { OrderDetailView } from './order-detail';
import { OrderStatusBadge } from './order-display';
import { classifyCancelError, validateCancelInput } from './cancel-order';
import { CANCELLATION_REASONS, lifecycleOf, type OrderDetail } from './contract';

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

const eligible = (over: Partial<OrderDetail> = {}) => detailFixture({ cancel_action: { available: true, blocked_reason: null }, ...over });
const cancelled = (): OrderDetail =>
  detailFixture({
    lifecycle_status: 'cancelled',
    cancellation: { cancelled: true, at: '2026-10-28T09:30:00+03:00', reason: 'out_of_stock', note: 'نفد الصنف', by: { id: 'u1', name: 'المشرف' } },
    payment: { ...detailFixture().payment, status: 'cancelled', cancelled_at: '2026-10-28T09:30:00+03:00' },
    cancel_action: { available: false, blocked_reason: 'already_cancelled' },
  });
const apiError = (status: number, body: unknown = {}) => Object.assign(new Error('x'), { status, body });

async function openDialog() {
  fireEvent.click(await screen.findByRole('button', { name: 'إلغاء الطلب' }));
  return await screen.findByRole('dialog');
}
const submit = () => screen.getByRole('button', { name: 'تأكيد الإلغاء' });

describe('staff order cancellation UI (O3b)', () => {
  beforeEach(() => {
    locale.current = 'ar';
    perms.set = new Set(['commerce.orders.view', 'commerce.orders.cancel']);
    fetchOrderMock.mockReset();
    apiMock.mockReset();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  describe('permission and contract gated rendering', () => {
    it('shows the action only with the permission AND an available cancel_action', async () => {
      fetchOrderMock.mockResolvedValue(eligible());
      render(<OrderDetailView id="o1" />);
      expect(await screen.findByRole('button', { name: 'إلغاء الطلب' })).toBeTruthy();
    });

    it.each([
      ['the permission is missing', new Set(['commerce.orders.view']), eligible()],
      ['the contract is absent (gate closed or no capability — not revealed)', new Set(['commerce.orders.view', 'commerce.orders.cancel']), detailFixture()],
    ])('hides the action silently when %s', async (_name, granted, order) => {
      perms.set = granted as Set<string>;
      fetchOrderMock.mockResolvedValue(order);
      render(<OrderDetailView id="o1" />);
      await screen.findByRole('heading', { name: 'CORD-100' });
      expect(screen.queryByRole('button', { name: 'إلغاء الطلب' })).toBeNull();
      expect(screen.queryByText('لا يمكن إلغاء هذا الطلب')).toBeNull();
    });

    it.each([
      ['payment_collected', 'حُصِّل مبلغ الطلب'],
      ['payment_paid', 'الطلب مدفوع إلكترونياً'],
      ['payment_captured', 'التُقط مبلغ لهذا الطلب'],
      ['payment_authorized', 'مصرَّح به لدى مزوّد الدفع'],
      ['already_posted', 'رُحِّل الطلب محاسبياً'],
      ['not_confirmed', 'الطلب غير مؤكَّد'],
    ])('does not offer cancellation for %s and explains why (no silent disabled button)', async (reason, text) => {
      fetchOrderMock.mockResolvedValue(detailFixture({ cancel_action: { available: false, blocked_reason: reason } }));
      render(<OrderDetailView id="o1" />);
      await screen.findByRole('heading', { name: 'CORD-100' });
      expect(screen.queryByRole('button', { name: 'إلغاء الطلب' })).toBeNull();
      expect(screen.getAllByText('لا يمكن إلغاء هذا الطلب').length).toBeGreaterThan(0);
      expect(screen.getAllByText(new RegExp(text)).length).toBeGreaterThan(0);
    });

    it('never treats status=confirmed as eligibility: no contract, no button', async () => {
      fetchOrderMock.mockResolvedValue(detailFixture({ status: 'confirmed' }));
      render(<OrderDetailView id="o1" />);
      await screen.findByRole('heading', { name: 'CORD-100' });
      expect(screen.queryByRole('button', { name: 'إلغاء الطلب' })).toBeNull();
    });

    it('renders a cancelled order as cancelled with actor, reason, note and date, and no action', async () => {
      fetchOrderMock.mockResolvedValue(cancelled());
      render(<OrderDetailView id="o1" />);
      await screen.findByRole('heading', { name: 'CORD-100' });
      expect(screen.getAllByText('ملغى').length).toBeGreaterThan(0);
      expect(screen.getAllByText('نفاد المخزون').length).toBeGreaterThan(0);
      expect(screen.getAllByText('نفد الصنف').length).toBeGreaterThan(0);
      expect(screen.getAllByText('المشرف').length).toBeGreaterThan(0);
      expect(screen.getAllByText(/هذا الطلب ملغى/).length).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: 'إلغاء الطلب' })).toBeNull();
      expect(screen.queryByText('هذا الطلب لم يُرحَّل محاسبياً')).toBeNull(); // لا تحذير ترحيل لطلب ملغى
    });
  });

  describe('dialog', () => {
    it('offers the six approved reasons and validates before sending', async () => {
      fetchOrderMock.mockResolvedValue(eligible());
      render(<OrderDetailView id="o1" />);
      const dialog = await openDialog();
      const select = within(dialog).getByLabelText('سبب الإلغاء') as HTMLSelectElement;
      const values = Array.from(select.options).map((o) => o.value).filter(Boolean);
      expect(values).toEqual([...CANCELLATION_REASONS]);
      expect(values).toHaveLength(6);

      fireEvent.click(submit());
      expect(await within(dialog).findByText('اختر سبب الإلغاء.')).toBeTruthy();
      expect(select.getAttribute('aria-invalid')).toBe('true');
      expect(apiMock).not.toHaveBeenCalled();
    });

    it('requires a note for "other", caps the note at 500 characters and shows a counter', async () => {
      fetchOrderMock.mockResolvedValue(eligible());
      render(<OrderDetailView id="o1" />);
      const dialog = await openDialog();
      fireEvent.change(within(dialog).getByLabelText('سبب الإلغاء'), { target: { value: 'other' } });
      const note = within(dialog).getByLabelText(/ملاحظات/) as HTMLTextAreaElement;
      expect(note.getAttribute('aria-required')).toBe('true');
      expect(note.maxLength).toBe(500);

      fireEvent.change(note, { target: { value: '   ' } });
      fireEvent.click(submit());
      expect(await within(dialog).findByText('اكتب ملاحظة توضّح السبب.')).toBeTruthy();
      expect(apiMock).not.toHaveBeenCalled();

      fireEvent.change(note, { target: { value: 'x'.repeat(500) } });
      expect(within(dialog).getByText('500/500')).toBeTruthy();
    });

    it('the note is optional for the other reasons', async () => {
      fetchOrderMock.mockResolvedValue(eligible());
      apiMock.mockResolvedValue({ data: cancelled() });
      render(<OrderDetailView id="o1" />);
      const dialog = await openDialog();
      expect((within(dialog).getByLabelText(/ملاحظات/) as HTMLTextAreaElement).getAttribute('aria-required')).toBe('false');
      fireEvent.change(within(dialog).getByLabelText('سبب الإلغاء'), { target: { value: 'customer_request' } });
      fireEvent.click(submit());
      await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
      expect(apiMock.mock.calls[0][1].body).toEqual({ reason: 'customer_request' });
    });
  });

  describe('submission', () => {
    it('posts reason and trimmed note to the dedicated endpoint and shows the cancelled order from the server response', async () => {
      fetchOrderMock.mockResolvedValue(eligible());
      apiMock.mockResolvedValue({ data: cancelled() });
      render(<OrderDetailView id="o1" />);
      const dialog = await openDialog();
      fireEvent.change(within(dialog).getByLabelText('سبب الإلغاء'), { target: { value: 'out_of_stock' } });
      fireEvent.change(within(dialog).getByLabelText(/ملاحظات/), { target: { value: '  نفد الصنف  ' } });
      fireEvent.click(submit());

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      const [path, options] = apiMock.mock.calls[0];
      expect(path).toBe(`/commerce/orders/${detailFixture().id}/cancel`);
      expect(options).toMatchObject({ method: 'POST', body: { reason: 'out_of_stock', note: 'نفد الصنف' } });
      expect(screen.getByRole('status').textContent).toContain('تم إلغاء الطلب.');
      expect(screen.getAllByText('ملغى').length).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: 'إلغاء الطلب' })).toBeNull();
    });

    it('blocks double submission (two clicks and a form submit) while the request is slow and keeps the dialog open', async () => {
      fetchOrderMock.mockResolvedValue(eligible());
      let finish!: (value: unknown) => void;
      apiMock.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      render(<OrderDetailView id="o1" />);
      const dialog = await openDialog();
      fireEvent.change(within(dialog).getByLabelText('سبب الإلغاء'), { target: { value: 'payment_issue' } });

      const button = submit();
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.submit(dialog.querySelector('form')!);

      await waitFor(() => expect(screen.getByRole('button', { name: 'جارٍ الإلغاء…' })).toBeTruthy());
      expect(apiMock).toHaveBeenCalledTimes(1);
      expect(dialog.querySelector('form')!.getAttribute('aria-busy')).toBe('true');
      expect((screen.getByRole('button', { name: 'جارٍ الإلغاء…' }) as HTMLButtonElement).disabled).toBe(true);
      expect((within(dialog).getByLabelText('سبب الإلغاء') as HTMLSelectElement).disabled).toBe(true);
      // الإغلاق ممنوع أثناء الطلب (Escape).
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeTruthy();

      await act(async () => finish({ data: cancelled() }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(apiMock).toHaveBeenCalledTimes(1);
    });

    it('a 409 race shows the specific reason, refreshes the order from the server and locks the stale confirm', async () => {
      const collected = detailFixture({ cancel_action: { available: false, blocked_reason: 'payment_collected' } });
      fetchOrderMock.mockResolvedValueOnce(eligible()).mockResolvedValue(collected);
      apiMock.mockRejectedValue(apiError(409, { message: 'x', reason: 'payment_collected' }));
      render(<OrderDetailView id="o1" />);
      const dialog = await openDialog();
      fireEvent.change(within(dialog).getByLabelText('سبب الإلغاء'), { target: { value: 'customer_request' } });
      fireEvent.click(submit());

      expect(await within(dialog).findByText(/تغيّرت حالة الطلب ولم يعد قابلاً للإلغاء/)).toBeTruthy();
      expect(within(dialog).getByRole('alert').textContent).toContain('حُصِّل مبلغ الطلب');
      await waitFor(() => expect(fetchOrderMock).toHaveBeenCalledTimes(2));
      expect((screen.getByRole('button', { name: 'تأكيد الإلغاء' }) as HTMLButtonElement).disabled).toBe(true);
      // الحالة المحدَّثة تحت الحوار: الإجراء اختفى وظهر سببه.
      fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.queryByRole('button', { name: 'إلغاء الطلب' })).toBeNull();
      expect(screen.getAllByText('لا يمكن إلغاء هذا الطلب').length).toBeGreaterThan(0);
    });

    it.each([
      [apiError(403), /لا تملك صلاحية إلغاء الطلبات/, false],
      [apiError(401), /انتهت الجلسة/, false],
      [apiError(422, { message: 'bad' }), /رفض البيانات المدخلة/, false],
      [apiError(500), /تعذّر إلغاء الطلب/, false],
      [apiError(404), /الطلب غير موجود أو لا يخص هذه المؤسسة/, true],
      [new TypeError('Failed to fetch'), /لم يُؤكَّد الإلغاء/, true],
    ])('handles %j without assuming success', async (error, text, locks) => {
      fetchOrderMock.mockResolvedValue(eligible());
      apiMock.mockRejectedValue(error);
      render(<OrderDetailView id="o1" />);
      const dialog = await openDialog();
      fireEvent.change(within(dialog).getByLabelText('سبب الإلغاء'), { target: { value: 'customer_request' } });
      fireEvent.click(submit());

      expect(await within(dialog).findByText(text)).toBeTruthy();
      expect(screen.queryByText('تم إلغاء الطلب.')).toBeNull();
      expect(screen.queryAllByText('ملغى')).toHaveLength(0);
      expect((screen.getByRole('button', { name: 'تأكيد الإلغاء' }) as HTMLButtonElement).disabled).toBe(locks);
    });

    it('reopening after an inconclusive failure starts clean once a refresh confirms the order is still eligible (Codex P2)', async () => {
      fetchOrderMock.mockResolvedValue(eligible()); // التحديث بعد انقطاع الشبكة يؤكد أن الطلب ما زال مؤهلاً
      apiMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({ data: cancelled() });
      render(<OrderDetailView id="o1" />);
      let dialog = await openDialog();
      fireEvent.change(within(dialog).getByLabelText('سبب الإلغاء'), { target: { value: 'customer_request' } });
      fireEvent.click(submit());
      await within(dialog).findByText(/لم يُؤكَّد الإلغاء/);
      expect((screen.getByRole('button', { name: 'تأكيد الإلغاء' }) as HTMLButtonElement).disabled).toBe(true); // القفل لمحاولة قديمة
      await waitFor(() => expect(fetchOrderMock).toHaveBeenCalledTimes(2));

      fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      dialog = await openDialog();

      expect((within(dialog).getByLabelText('سبب الإلغاء') as HTMLSelectElement).disabled).toBe(false);
      expect((within(dialog).getByLabelText('سبب الإلغاء') as HTMLSelectElement).value).toBe('');
      expect((screen.getByRole('button', { name: 'تأكيد الإلغاء' }) as HTMLButtonElement).disabled).toBe(false);
      expect(within(dialog).queryByText(/لم يُؤكَّد الإلغاء/)).toBeNull();
      fireEvent.change(within(dialog).getByLabelText('سبب الإلغاء'), { target: { value: 'customer_request' } });
      fireEvent.click(submit());
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(apiMock).toHaveBeenCalledTimes(2);
    });

    it('allows a retry after a recoverable error and then succeeds', async () => {
      fetchOrderMock.mockResolvedValue(eligible());
      apiMock.mockRejectedValueOnce(apiError(500)).mockResolvedValue({ data: cancelled() });
      render(<OrderDetailView id="o1" />);
      const dialog = await openDialog();
      fireEvent.change(within(dialog).getByLabelText('سبب الإلغاء'), { target: { value: 'customer_request' } });
      fireEvent.click(submit());
      await within(dialog).findByText(/تعذّر إلغاء الطلب/);
      fireEvent.click(submit());
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(apiMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('locale, direction and accessibility', () => {
    it('renders the dialog and the cancelled order in English with LTR-safe numerics', async () => {
      locale.current = 'en';
      fetchOrderMock.mockResolvedValue(eligible());
      render(<OrderDetailView id="o1" />);
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel order' }));
      const dialog = await screen.findByRole('dialog');
      const select = within(dialog).getByLabelText('Cancellation reason') as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => o.textContent)).toContain('Out of stock');
      expect(within(dialog).getByText('0/500').getAttribute('dir')).toBe('ltr');
      expect(within(dialog).getByRole('button', { name: 'Keep order' })).toBeTruthy();
    });

    it('labels every control, announces errors, and tokens only (no hard-coded colors)', async () => {
      fetchOrderMock.mockResolvedValue(eligible());
      render(<OrderDetailView id="o1" />);
      const dialog = await openDialog();
      expect(within(dialog).getByLabelText('سبب الإلغاء')).toBeTruthy();
      expect(within(dialog).getByLabelText(/ملاحظات/)).toBeTruthy();
      fireEvent.click(submit());
      expect((await within(dialog).findByRole('alert')).textContent).toContain('اختر سبب الإلغاء.');
      expect(dialog.outerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
    });

    it('English and Arabic cancelled badges are the lifecycle label, not the raw status', () => {
      locale.current = 'en';
      render(<OrderStatusBadge status={lifecycleOf({ status: 'confirmed', lifecycle_status: 'cancelled' })} locale="en" />);
      expect(screen.getByText('Cancelled')).toBeTruthy();
    });
  });

  describe('pure helpers', () => {
    it('validates input like the server', () => {
      expect(validateCancelInput({ reason: '', note: '' })).toBe('reason_required');
      expect(validateCancelInput({ reason: 'other', note: '  ' })).toBe('note_required');
      expect(validateCancelInput({ reason: 'customer_request', note: 'x'.repeat(501) })).toBe('note_too_long');
      expect(validateCancelInput({ reason: 'other', note: 'ok' })).toBeNull();
      expect(validateCancelInput({ reason: 'fraud_suspected', note: '' })).toBeNull();
    });

    it('classifies every status the API can return', () => {
      expect(classifyCancelError({ status: 401 }).kind).toBe('session');
      expect(classifyCancelError({ status: 403 }).kind).toBe('forbidden');
      expect(classifyCancelError({ status: 404 }).kind).toBe('not_found');
      expect(classifyCancelError({ status: 409, body: { reason: 'payment_paid' } })).toEqual({ kind: 'conflict', reason: 'payment_paid' });
      expect(classifyCancelError({ status: 422 }).kind).toBe('validation');
      expect(classifyCancelError({ status: 500 }).kind).toBe('unknown');
      expect(classifyCancelError(new TypeError('Failed to fetch')).kind).toBe('network');
    });
  });
});
