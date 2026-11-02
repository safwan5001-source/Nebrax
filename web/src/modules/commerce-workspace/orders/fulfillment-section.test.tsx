// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detailFixture, failedFixture, notStartedFixture, outForDeliveryFixture, preparingFixture, fulfillmentBlock } from './test-fixtures';
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
const MANAGE = ['commerce.orders.view', 'commerce.orders.manage'];
const btn = (name: string) => screen.queryByRole('button', { name });
async function ready() {
  await screen.findByRole('heading', { name: 'CORD-100' });
}
const section = () => screen.getByTestId('fulfillment-section');

describe('fulfillment section (COPS-H2-3)', () => {
  beforeEach(() => {
    locale.current = 'ar';
    perms.set = new Set(MANAGE);
    fetchOrderMock.mockReset();
    apiMock.mockReset();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  describe('visibility comes from the read contract and the permission only', () => {
    it('offers exactly the available actions of the contract', async () => {
      fetchOrderMock.mockResolvedValue(notStartedFixture());
      render(<OrderDetailView id="o1" />);
      await ready();
      expect(btn('بدء التحضير')).toBeTruthy();
      expect(btn('جاهز')).toBeTruthy();
      expect(btn('إرسال للتوصيل')).toBeNull();
      expect(btn('تم التسليم')).toBeNull();
      expect(screen.getByText(/تنفيذ تشغيلي: لا يُنشئ قيداً/)).toBeTruthy();
    });

    it('shows no action without the manage permission, and no action when the contract is absent (closed gate) — facts still shown', async () => {
      perms.set = new Set(['commerce.orders.view']);
      fetchOrderMock.mockResolvedValue(preparingFixture());
      render(<OrderDetailView id="o1" />);
      await ready();
      expect(btn('جاهز')).toBeNull();
      expect(within(section()).getAllByText('قيد التحضير').length).toBeGreaterThan(0);
      expect(within(section()).getByText(/عرض فقط/)).toBeTruthy();

      cleanup();
      perms.set = new Set(MANAGE);
      fetchOrderMock.mockResolvedValue(preparingFixture({ fulfillment_actions: undefined }));
      render(<OrderDetailView id="o1" />);
      await ready();
      expect(btn('جاهز')).toBeNull();
      expect(within(section()).getAllByText('قيد التحضير').length).toBeGreaterThan(0);
      expect(within(section()).getByText('مخزن الدمام')).toBeTruthy();
    });

    it('has no fulfillment section for an order with neither a block nor a contract (legacy responses)', async () => {
      fetchOrderMock.mockResolvedValue(detailFixture());
      render(<OrderDetailView id="o1" />);
      await ready();
      expect(screen.queryByTestId('fulfillment-section')).toBeNull();
    });

    it('explains a blocked start instead of showing a dead button', async () => {
      fetchOrderMock.mockResolvedValue(
        notStartedFixture({ fulfillment_actions: [{ action: 'start', available: false, blocked_reason: 'awaiting_acceptance' }, { action: 'mark_ready', available: false, blocked_reason: 'awaiting_acceptance' }] }),
      );
      render(<OrderDetailView id="o1" />);
      await ready();
      expect(btn('بدء التحضير')).toBeNull();
      expect(within(section()).getByText(/بانتظار قبول التاجر/)).toBeTruthy();
    });

    it('hides all actions and shows no dialogs for a completed order', async () => {
      fetchOrderMock.mockResolvedValue(detailFixture({ fulfillment: fulfillmentBlock({ status: 'delivered', version: 5 }), fulfillment_actions: [] }));
      render(<OrderDetailView id="o1" />);
      await ready();
      expect(within(section()).queryAllByRole('button')).toHaveLength(0);
      expect(within(section()).getAllByText('سُلِّم').length).toBeGreaterThan(0);
      expect(within(section()).getByText(/سُلِّم الطلب ولم يُحصَّل المبلغ بعد/)).toBeTruthy();
    });

    it('names the pickup ready state "ready for pickup"', async () => {
      fetchOrderMock.mockResolvedValue(
        detailFixture({
          delivery_method: 'pickup',
          fulfillment: fulfillmentBlock({ status: 'ready', type: 'pickup', version: 2 }),
          fulfillment_actions: [{ action: 'pickup', available: true, blocked_reason: null }],
        }),
      );
      render(<OrderDetailView id="o1" />);
      await ready();
      expect(within(section()).getAllByText('جاهز للاستلام').length).toBeGreaterThan(0);
      expect(btn('استلمه العميل')).toBeTruthy();
    });
  });

  describe('single-click actions', () => {
    it('sends the displayed version, shows the updated state and a status message', async () => {
      fetchOrderMock.mockResolvedValue(notStartedFixture());
      apiMock.mockResolvedValue({ data: preparingFixture() });
      render(<OrderDetailView id="o1" />);
      await ready();
      fireEvent.click(btn('بدء التحضير')!);
      await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
      expect(apiMock.mock.calls[0][0]).toMatch(/\/fulfillment\/start$/);
      expect(apiMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: { expected_version: 0 } });
      expect(await screen.findByText('تم تحديث حالة التنفيذ.')).toBeTruthy();
      expect(within(section()).getAllByText('قيد التحضير').length).toBeGreaterThan(0);
    });

    it('two synchronous clicks send exactly one request', async () => {
      fetchOrderMock.mockResolvedValue(notStartedFixture());
      let resolve!: (v: unknown) => void;
      apiMock.mockReturnValue(new Promise((r) => (resolve = r)));
      render(<OrderDetailView id="o1" />);
      await ready();
      const start = btn('بدء التحضير')!;
      fireEvent.click(start);
      fireEvent.click(start);
      expect(apiMock).toHaveBeenCalledTimes(1);
      resolve({ data: preparingFixture() });
      await screen.findByText('تم تحديث حالة التنفيذ.');
      expect(apiMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('dialogs', () => {
    it('failure dialog requires a reason from the list, sends reason + note, and never closes while pending', async () => {
      fetchOrderMock.mockResolvedValue(outForDeliveryFixture());
      apiMock.mockResolvedValue({ data: failedFixture() });
      render(<OrderDetailView id="o1" />);
      await ready();
      fireEvent.click(btn('تعذّر التسليم')!);
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'تسجيل تعذّر التسليم' }));
      expect(within(dialog).getByText('اختر سبب تعذّر التسليم.')).toBeTruthy();
      expect(apiMock).not.toHaveBeenCalled();

      fireEvent.change(within(dialog).getByLabelText('سبب تعذّر التسليم'), { target: { value: 'address_issue' } });
      fireEvent.change(within(dialog).getByLabelText('ملاحظة داخلية'), { target: { value: 'العنوان غير صحيح' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'تسجيل تعذّر التسليم' }));
      await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
      expect(apiMock.mock.calls[0][0]).toMatch(/\/fulfillment\/fail$/);
      expect(apiMock.mock.calls[0][1].body).toEqual({ expected_version: 3, reason: 'address_issue', note: 'العنوان غير صحيح' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(within(section()).getAllByText('تعذّر التسليم').length).toBeGreaterThan(0);
    });

    it('deliver asks for confirmation first and says delivery is not collection', async () => {
      fetchOrderMock.mockResolvedValue(outForDeliveryFixture());
      apiMock.mockResolvedValue({ data: detailFixture({ fulfillment: fulfillmentBlock({ status: 'delivered', version: 4 }), fulfillment_actions: [] }) });
      render(<OrderDetailView id="o1" />);
      await ready();
      fireEvent.click(btn('تم التسليم')!);
      const dialog = await screen.findByRole('dialog');
      expect(apiMock).not.toHaveBeenCalled();
      expect(within(dialog).getByText(/التسليم لا يعني تحصيل المبلغ/)).toBeTruthy();
      fireEvent.click(within(dialog).getByRole('button', { name: 'تأكيد التسليم' }));
      await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
      expect(apiMock.mock.calls[0][0]).toMatch(/\/fulfillment\/deliver$/);
    });

    it('a carrier dispatch requires the carrier name before any request', async () => {
      fetchOrderMock.mockResolvedValue(
        detailFixture({ fulfillment: fulfillmentBlock({ status: 'ready', type: 'carrier', version: 2 }), fulfillment_actions: [{ action: 'dispatch', available: true, blocked_reason: null }] }),
      );
      render(<OrderDetailView id="o1" />);
      await ready();
      fireEvent.click(btn('إرسال للتوصيل')!);
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'إرسال' }));
      expect(within(dialog).getByText('اسم الناقل مطلوب لإرسال شحنة ناقل.')).toBeTruthy();
      expect(apiMock).not.toHaveBeenCalled();
    });
  });

  describe('failure and stale-state handling', () => {
    it('a 409 conflict refreshes from the server and locks every action until the fresh state arrives', async () => {
      fetchOrderMock.mockResolvedValueOnce(preparingFixture());
      apiMock.mockRejectedValue(apiError(409, { reason: 'fulfillment_version_conflict', current_version: 2, current_status: 'ready' }));
      let release!: (o: unknown) => void;
      fetchOrderMock.mockReturnValueOnce(new Promise((r) => (release = r)));
      render(<OrderDetailView id="o1" />);
      await ready();
      fireEvent.click(btn('جاهز')!);
      await waitFor(() => expect(fetchOrderMock).toHaveBeenCalledTimes(2));
      expect(await screen.findByText(/تغيّرت حالة التنفيذ منذ آخر قراءة/)).toBeTruthy();
      expect((btn('جاهز') as HTMLButtonElement).disabled).toBe(true);
      release(detailFixture({ fulfillment: fulfillmentBlock({ status: 'ready', version: 2 }), fulfillment_actions: [{ action: 'dispatch', available: true, blocked_reason: null }] }));
      await waitFor(() => expect(btn('إرسال للتوصيل')).toBeTruthy());
      expect(btn('جاهز')).toBeNull();
    });

    it('clearing a prefilled tracking field in the dispatch dialog sends an explicit empty value so the old one is not silently kept (review P2)', async () => {
      const readyCarrier = detailFixture({
        fulfillment: fulfillmentBlock({ status: 'ready', type: 'carrier', version: 2, carrier: { name: 'سمسا', tracking_number: 'T-OLD', tracking_url: 'https://track.example.test/OLD' }, courier: { name: null, phone: null } }),
        fulfillment_actions: [{ action: 'dispatch', available: true, blocked_reason: null }],
      });
      fetchOrderMock.mockResolvedValue(readyCarrier);
      apiMock.mockResolvedValue({ data: readyCarrier });
      render(<OrderDetailView id="o1" />);
      await ready();
      fireEvent.click(btn('إرسال للتوصيل')!);
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText(/رقم التتبع/), { target: { value: '' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'إرسال' }));
      await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
      expect(apiMock.mock.calls[0][1].body).toMatchObject({ expected_version: 2, carrier_name: 'سمسا', tracking_number: '' });
    });

    it('a 409 while a dispatch dialog is open closes it for good: the stale values are never resubmitted against the new version (review P2)', async () => {
      const ready = (over = {}) => detailFixture({ fulfillment: fulfillmentBlock({ status: 'ready', type: 'carrier', version: 2, carrier: { name: 'قديم', tracking_number: null, tracking_url: null }, ...over }), fulfillment_actions: [{ action: 'dispatch', available: true, blocked_reason: null }] });
      fetchOrderMock.mockResolvedValueOnce(ready());
      apiMock.mockRejectedValueOnce(apiError(409, { reason: 'fulfillment_version_conflict', current_version: 3, current_status: 'ready' }));
      // الموظف الآخر غيّر الناقل فصارت النسخة 3
      fetchOrderMock.mockResolvedValueOnce(ready({ version: 3, carrier: { name: 'جديد-من-موظف-آخر', tracking_number: null, tracking_url: null } }));
      render(<OrderDetailView id="o1" />);
      await screen.findByRole('heading', { name: 'CORD-100' });
      fireEvent.click(btn('إرسال للتوصيل')!);
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText(/اسم الناقل/), { target: { value: 'قيمة-قديمة-أدخلها-المستخدم' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'إرسال' }));

      // الحوار يُغلق نهائياً بعد 409 ويبقى الخطأ ظاهراً في القسم
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(await screen.findByText(/تغيّرت حالة التنفيذ منذ آخر قراءة/)).toBeTruthy();
      await waitFor(() => expect(fetchOrderMock).toHaveBeenCalledTimes(2));
      await waitFor(() => expect((btn('إرسال للتوصيل') as HTMLButtonElement | null)?.disabled).toBe(false));
      expect(apiMock).toHaveBeenCalledTimes(1); // لا إعادة إرسال تلقائي

      // إعادة الفتح تعرض التفاصيل المحدَّثة لا القيم القديمة
      fireEvent.click(btn('إرسال للتوصيل')!);
      const reopened = await screen.findByRole('dialog');
      expect((within(reopened).getByLabelText(/اسم الناقل/) as HTMLInputElement).value).toBe('جديد-من-موظف-آخر');
    });

    it('a network failure treats the outcome as unconfirmed and refreshes', async () => {
      fetchOrderMock.mockResolvedValueOnce(preparingFixture()).mockResolvedValueOnce(preparingFixture());
      apiMock.mockRejectedValue(new Error('offline'));
      render(<OrderDetailView id="o1" />);
      await ready();
      fireEvent.click(btn('جاهز')!);
      expect(await screen.findByText(/نتيجة الإجراء غير مؤكَّدة/)).toBeTruthy();
      await waitFor(() => expect(fetchOrderMock).toHaveBeenCalledTimes(2));
    });
  });

  describe('details form', () => {
    it('sends only the changed fields with the displayed version', async () => {
      fetchOrderMock.mockResolvedValue(preparingFixture());
      apiMock.mockResolvedValue({ data: preparingFixture({ fulfillment: fulfillmentBlock({ version: 2, carrier: { name: 'سمسا', tracking_number: null, tracking_url: null } }) }) });
      render(<OrderDetailView id="o1" />);
      await ready();
      const save = within(section()).getByRole('button', { name: 'حفظ التفاصيل' }) as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      fireEvent.change(within(section()).getByLabelText('اسم الناقل'), { target: { value: 'سمسا' } });
      expect(save.disabled).toBe(false);
      fireEvent.click(save);
      await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
      expect(apiMock.mock.calls[0][0]).toMatch(/\/fulfillment$/);
      expect(apiMock.mock.calls[0][1]).toMatchObject({ method: 'PATCH', body: { expected_version: 1, carrier_name: 'سمسا' } });
      expect(await screen.findByText('تم حفظ تفاصيل التنفيذ.')).toBeTruthy();
    });

    it('validates the tracking link locally (https only) and never sends an invalid one', async () => {
      fetchOrderMock.mockResolvedValue(preparingFixture());
      render(<OrderDetailView id="o1" />);
      await ready();
      fireEvent.change(within(section()).getByLabelText('رابط التتبع (https)'), { target: { value: 'http://insecure.test' } });
      fireEvent.click(within(section()).getByRole('button', { name: 'حفظ التفاصيل' }));
      expect(within(section()).getByText('رابط التتبع يجب أن يكون https صالحاً.')).toBeTruthy();
      expect(apiMock).not.toHaveBeenCalled();
    });

    it('labels courier fields as internal and renders the tracking link safely', async () => {
      fetchOrderMock.mockResolvedValue(outForDeliveryFixture());
      render(<OrderDetailView id="o1" />);
      await ready();
      expect(within(section()).getByText('بيانات الساعي داخلية ولا تظهر للعميل.')).toBeTruthy();
      const link = within(section()).getByRole('link', { name: 'https://track.example.test/T-1' });
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link.getAttribute('target')).toBe('_blank');
    });
  });

  describe('AR-1: a failed delivery offers no close, cancel or refund', () => {
    it('shows the fixed explanation, the attempts and the reason, and only retry/return actions', async () => {
      fetchOrderMock.mockResolvedValue(failedFixture());
      render(<OrderDetailView id="o1" />);
      await ready();
      expect(within(section()).getByText(/لا يتوفر في هذه النسخة إغلاق أو إلغاء أو استرداد لهذه الحالة/)).toBeTruthy();
      expect(within(section()).getByText(/مشكلة في العنوان/)).toBeTruthy();
      expect(within(section()).getAllByText('العنوان غير صحيح').length).toBeGreaterThan(0);
      const actionNames = within(section()).getAllByRole('button').map((b) => b.textContent);
      expect(actionNames).toEqual(expect.arrayContaining(['إرسال للتوصيل', 'عاد للمتجر']));
      for (const forbidden of [/إغلاق الطلب/, /شطب/, /استرداد الآن/, /إلغاء الطلب/]) {
        expect(actionNames.some((n) => forbidden.test(n ?? ''))).toBe(false);
      }
      // الإلغاء العادي ممنوع من الخادم أثناء النقل: يعرض سبب المنع لا زراً.
      expect(btn('إلغاء الطلب')).toBeNull();
    });
  });

  describe('English / LTR', () => {
    it('renders English labels and keeps tracking values left-to-right', async () => {
      locale.current = 'en';
      fetchOrderMock.mockResolvedValue(outForDeliveryFixture());
      render(<OrderDetailView id="o1" />);
      await screen.findByRole('heading', { name: 'CORD-100' });
      expect(btn('Mark delivered')).toBeTruthy();
      expect(btn('Delivery failed')).toBeTruthy();
      expect(within(section()).getAllByText('Out for delivery').length).toBeGreaterThan(0);
      const tracking = within(section()).getByText('T-1');
      expect(tracking.closest('dd')?.getAttribute('dir')).toBe('ltr');
    });
  });
});
