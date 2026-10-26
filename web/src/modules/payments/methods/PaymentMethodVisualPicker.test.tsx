// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentMethodVisualPicker, EMPTY_VISUAL, type VisualFormState } from './PaymentMethodVisualPicker';

const { fetchImageUrl } = vi.hoisted(() => ({ fetchImageUrl: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ fetchImageUrl }));

const revoke = vi.fn();
const create = vi.fn();
const saved = (id: string, updated_at = 'v1') => ({ id, updated_at });
const withLogo: VisualFormState = { ...EMPTY_VISUAL, mode: 'image', hasLogo: true };
const preview = () => screen.getByTestId('payment-method-logo-preview').querySelector('img')?.getAttribute('src');

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('PaymentMethodVisualPicker — إدارة Blob Object URLs', () => {
  beforeEach(() => {
    fetchImageUrl.mockReset(); revoke.mockReset(); create.mockReset();
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revoke;
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = create;
  });
  afterEach(() => cleanup());

  it('معاينة الشعار المحفوظ تُعرض ثم يُحرَّر URL عند إغلاق الحوار (unmount)', async () => {
    fetchImageUrl.mockResolvedValue('blob:saved-1');
    const { unmount } = render(<PaymentMethodVisualPicker value={withLogo} onChange={vi.fn()} saved={saved('m1')} />);
    await waitFor(() => expect(preview()).toBe('blob:saved-1'));
    expect(revoke).not.toHaveBeenCalled();
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:saved-1');
  });

  it('تغيير الطريقة المعروضة يحرّر URL السابقة ويعرض الجديدة', async () => {
    fetchImageUrl.mockResolvedValueOnce('blob:m1').mockResolvedValueOnce('blob:m2');
    const { rerender } = render(<PaymentMethodVisualPicker value={withLogo} onChange={vi.fn()} saved={saved('m1')} />);
    await waitFor(() => expect(preview()).toBe('blob:m1'));
    rerender(<PaymentMethodVisualPicker value={withLogo} onChange={vi.fn()} saved={saved('m2')} />);
    await waitFor(() => expect(preview()).toBe('blob:m2'));
    expect(revoke).toHaveBeenCalledWith('blob:m1');
    expect(revoke).not.toHaveBeenCalledWith('blob:m2');
  });

  it('استبدال الصورة بملف جديد يحرّر URL المحفوظة، ويحرّر URL الملف عند استبداله مجدداً', async () => {
    fetchImageUrl.mockResolvedValue('blob:saved');
    create.mockReturnValueOnce('blob:file-1').mockReturnValueOnce('blob:file-2');
    const f1 = new File(['a'], 'a.png', { type: 'image/png' });
    const f2 = new File(['b'], 'b.png', { type: 'image/png' });
    const { rerender } = render(<PaymentMethodVisualPicker value={withLogo} onChange={vi.fn()} saved={saved('m1')} />);
    await waitFor(() => expect(preview()).toBe('blob:saved'));
    rerender(<PaymentMethodVisualPicker value={{ ...withLogo, logoFile: f1 }} onChange={vi.fn()} saved={saved('m1')} />);
    expect(preview()).toBe('blob:file-1');
    expect(revoke).toHaveBeenCalledWith('blob:saved');
    rerender(<PaymentMethodVisualPicker value={{ ...withLogo, logoFile: f2 }} onChange={vi.fn()} saved={saved('m1')} />);
    expect(preview()).toBe('blob:file-2');
    expect(revoke).toHaveBeenCalledWith('blob:file-1');
  });

  it('سباق: الإغلاق قبل انتهاء الطلب ⇒ URL الواصل متأخراً يُحرَّر فوراً ولا يُعرض', async () => {
    const pending = deferred<string | null>();
    fetchImageUrl.mockReturnValue(pending.promise);
    const { unmount } = render(<PaymentMethodVisualPicker value={withLogo} onChange={vi.fn()} saved={saved('m1')} />);
    unmount();
    expect(revoke).not.toHaveBeenCalled();
    await act(async () => { pending.resolve('blob:late'); await pending.promise; });
    expect(revoke).toHaveBeenCalledWith('blob:late');
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('سباق: طلبان متداخلان ⇒ القديم المتأخر يُحرَّر والجديد وحده يُعرض', async () => {
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    fetchImageUrl.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerender } = render(<PaymentMethodVisualPicker value={withLogo} onChange={vi.fn()} saved={saved('m1')} />);
    rerender(<PaymentMethodVisualPicker value={withLogo} onChange={vi.fn()} saved={saved('m2')} />);
    await act(async () => { second.resolve('blob:new'); await second.promise; });
    await waitFor(() => expect(preview()).toBe('blob:new'));
    await act(async () => { first.resolve('blob:stale'); await first.promise; });
    expect(revoke).toHaveBeenCalledWith('blob:stale');
    expect(preview()).toBe('blob:new');
    expect(revoke).not.toHaveBeenCalledWith('blob:new');
  });

  it('سباق: الإزالة (hasLogo=false) أثناء الجلب تُلغيه وتحرّر الواصل لاحقاً', async () => {
    const pending = deferred<string | null>();
    fetchImageUrl.mockReturnValue(pending.promise);
    const { rerender } = render(<PaymentMethodVisualPicker value={withLogo} onChange={vi.fn()} saved={saved('m1')} />);
    rerender(<PaymentMethodVisualPicker value={{ ...withLogo, hasLogo: false }} onChange={vi.fn()} saved={saved('m1')} />);
    await act(async () => { pending.resolve('blob:gone'); await pending.promise; });
    expect(revoke).toHaveBeenCalledWith('blob:gone');
    expect(preview()).toBeUndefined();
  });

  it('فشل الجلب (null أو رفض) لا يحرّر شيئاً ولا يكسر المعاينة', async () => {
    fetchImageUrl.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('net'));
    const { rerender, unmount } = render(<PaymentMethodVisualPicker value={withLogo} onChange={vi.fn()} saved={saved('m1')} />);
    await waitFor(() => expect(fetchImageUrl).toHaveBeenCalledTimes(1));
    rerender(<PaymentMethodVisualPicker value={withLogo} onChange={vi.fn()} saved={saved('m2')} />);
    await waitFor(() => expect(fetchImageUrl).toHaveBeenCalledTimes(2));
    expect(preview()).toBeUndefined();
    unmount();
    expect(revoke).not.toHaveBeenCalled();
  });
});
