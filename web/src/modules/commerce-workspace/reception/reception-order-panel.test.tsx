// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptedFixture, awaitingFixture, detailFixture } from '../orders/test-fixtures';

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
vi.mock('../orders/orders-api', async () => ({ ...(await vi.importActual<object>('../orders/orders-api')), fetchOrder: (...a: unknown[]) => fetchOrderMock(...a) }));
const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({ ...(await vi.importActual<object>('@/lib/api')), api: (...a: unknown[]) => apiMock(...a) }));

import { ReceptionOrderPanel } from './reception-order-panel';

const apiError = (status: number, body: unknown = {}) => Object.assign(new Error('x'), { status, body });
const ALL = ['commerce.orders.view', 'commerce.orders.manage', 'commerce.orders.cancel'];
const props = (over = {}) => ({ orderId: 'o1', alertPending: false, acking: false, ackFailed: false, onAcknowledge: vi.fn(), onClose: vi.fn(), onChanged: vi.fn(), ...over });
const accept = () => screen.queryByTestId('panel-accept');
const reject = () => screen.queryByTestId('panel-reject');
async function ready() { await screen.findByTestId('reception-panel'); await screen.findByText('CORD-100'); await act(async () => { await Promise.resolve(); }); }

describe('ReceptionOrderPanel (COPS-H3-5c)', () => {
  beforeEach(() => {
    locale.current = 'ar';
    perms.set = new Set(ALL);
    fetchOrderMock.mockReset();
    apiMock.mockReset();
  });
  afterEach(cleanup);

  it('إجراءا القبول والرفض من عقد القراءة والصلاحيتين فقط، بأزرار ≥ 44px', async () => {
    fetchOrderMock.mockResolvedValue(awaitingFixture());
    render(<ReceptionOrderPanel {...props()} />);
    await ready();
    expect(accept()).toBeTruthy();
    expect(reject()).toBeTruthy();
    expect(accept()!.className).toContain('min-h-11');
    expect(reject()!.className).toContain('min-h-11');
  });

  it.each([
    ['بلا صلاحية الإدارة', ['commerce.orders.view', 'commerce.orders.cancel']],
    ['بلا صلاحية الإلغاء: قبول فقط', ['commerce.orders.view', 'commerce.orders.manage']],
  ])('%s', async (name, granted) => {
    perms.set = new Set(granted);
    fetchOrderMock.mockResolvedValue(awaitingFixture());
    render(<ReceptionOrderPanel {...props()} />);
    await ready();
    expect(accept() !== null).toBe(name.includes('قبول فقط'));
    expect(reject()).toBeNull();
  });

  it('غياب العقد (بوابة مغلقة/خادم أقدم) ⇒ لا إجراء ولا استنتاج من الوضع أو الحالة', async () => {
    fetchOrderMock.mockResolvedValue(detailFixture({ acceptance: { mode: 'manual', effective_mode: 'manual', accepted_at: null }, operational_status: 'awaiting_acceptance' }));
    render(<ReceptionOrderPanel {...props()} />);
    await ready();
    expect(accept()).toBeNull();
    expect(reject()).toBeNull();
    expect(screen.queryByTestId('panel-decision')).toBeNull();
  });

  it('القبول: طلب واحد فقط رغم نقرتين متتاليتين، ثم تأكيد ونداء onChanged', async () => {
    fetchOrderMock.mockResolvedValue(awaitingFixture());
    let resolve: (v: unknown) => void = () => {};
    apiMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    const onChanged = vi.fn();
    render(<ReceptionOrderPanel {...props({ onChanged })} />);
    await ready();
    fireEvent.click(accept()!);
    fireEvent.click(accept()!);
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock.mock.calls[0][0]).toMatch(/\/commerce\/orders\/.+\/accept$/);
    await act(async () => { resolve({ data: acceptedFixture() }); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.getByText('تم قبول الطلب.')).toBeTruthy();
    expect(accept()).toBeNull(); // العقد الجديد لا يعرض القبول بعد القبول
  });

  it('409 ⇒ قفل حالة قديمة وتحديث من الخادم ولا إعادة محاولة على بيانات قديمة', async () => {
    fetchOrderMock.mockResolvedValue(awaitingFixture());
    apiMock.mockRejectedValue(apiError(409, { reason: 'already_cancelled' }));
    const onChanged = vi.fn();
    render(<ReceptionOrderPanel {...props({ onChanged })} />);
    await ready();
    fetchOrderMock.mockClear();
    fireEvent.click(accept()!);
    await waitFor(() => expect(screen.getByTestId('panel-stale')).toBeTruthy());
    expect(fetchOrderMock).toHaveBeenCalledTimes(1); // تحديث
    expect(onChanged).toHaveBeenCalled();
  });

  it('الرفض يفتح حوار التأكيد ولا يرسل شيئاً قبل التأكيد', async () => {
    fetchOrderMock.mockResolvedValue(awaitingFixture());
    render(<ReceptionOrderPanel {...props()} />);
    await ready();
    fireEvent.click(reject()!);
    expect(await screen.findByText('تأكيد الرفض')).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('إعادة فتح حوار الرفض بعد 409 تبدأ نظيفة: زر التأكيد غير مقفل (Codex P2)', async () => {
    fetchOrderMock.mockResolvedValue(awaitingFixture());
    apiMock.mockRejectedValue(apiError(409, { reason: 'already_accepted' }));
    render(<ReceptionOrderPanel {...props()} />);
    await ready();
    fireEvent.click(reject()!);
    fireEvent.click(await screen.findByText('تأكيد الرفض'));
    await waitFor(() => expect(screen.getByTestId('panel-stale')).toBeTruthy());
    await waitFor(() => expect(screen.queryByText('تأكيد الرفض')).toBeNull()); // أُغلق بعد القفل
    await waitFor(() => expect(screen.queryByTestId('panel-stale')).toBeNull()); // وصل التحديث فارتفع القفل
    fireEvent.click(reject()!);
    const confirm = (await screen.findByText('تأكيد الرفض')).closest('button') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
  });

  it('زر الإقرار يظهر فقط حين يقول مركز التنبيه إنه بانتظار انتباه، ويستدعي الإقرار المشترك', async () => {
    fetchOrderMock.mockResolvedValue(awaitingFixture());
    const onAcknowledge = vi.fn();
    const { rerender } = render(<ReceptionOrderPanel {...props({ onAcknowledge })} />);
    await ready();
    expect(screen.queryByTestId('panel-ack')).toBeNull();
    rerender(<ReceptionOrderPanel {...props({ onAcknowledge, alertPending: true })} />);
    fireEvent.click(screen.getByTestId('panel-ack'));
    expect(onAcknowledge).toHaveBeenCalledWith(awaitingFixture().id);
  });

  it('Escape يغلق اللوحة، وزر الإغلاق كذلك؛ ومع حوار آخر مفتوح لا تُغلق', async () => {
    fetchOrderMock.mockResolvedValue(awaitingFixture());
    const onClose = vi.fn();
    render(<ReceptionOrderPanel {...props({ onClose })} />);
    await ready();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('panel-close'));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(reject()!);
    await screen.findByText('تأكيد الرفض');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2); // الحوار الأعلى يستجيب وحده
  });

  it('طلب غير موجود ⇒ حالة خطأ بلا إجراءات؛ فشل شبكة أول مرة ⇒ إعادة محاولة', async () => {
    fetchOrderMock.mockRejectedValue(apiError(404));
    render(<ReceptionOrderPanel {...props()} />);
    await screen.findByText('الطلب غير موجود');
    expect(accept()).toBeNull();
    cleanup();
    fetchOrderMock.mockRejectedValueOnce(new Error('network'));
    fetchOrderMock.mockResolvedValue(awaitingFixture());
    render(<ReceptionOrderPanel {...props()} />);
    fireEvent.click(await screen.findByRole('button', { name: /retry|إعادة المحاولة/ }));
    await ready();
    expect(accept()).toBeTruthy();
  });

  it('تنفيذ الطلب: القسم المشترك بأزرار كبيرة حين يحضر عقد الإجراءات', async () => {
    fetchOrderMock.mockResolvedValue(
      detailFixture({
        operational_status: 'accepted',
        fulfillment_actions: [{ action: 'start', available: true, blocked_reason: null }],
      }),
    );
    render(<ReceptionOrderPanel {...props()} />);
    await ready();
    const start = await screen.findByRole('button', { name: 'بدء التحضير' });
    expect(start.className).toContain('min-h-11');
  });

  it('الإنجليزية: لا نص عربي في الرأس', async () => {
    locale.current = 'en';
    fetchOrderMock.mockResolvedValue(awaitingFixture());
    render(<ReceptionOrderPanel {...props()} />);
    await ready();
    expect(screen.getByText('Open order page')).toBeTruthy();
  });
});
