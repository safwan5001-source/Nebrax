// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentMethodVisual, clearPaymentMethodLogoCache } from './PaymentMethodVisual';

const { fetchImageUrl } = vi.hoisted(() => ({ fetchImageUrl: vi.fn() }));
vi.mock('@/lib/api', () => ({ fetchImageUrl }));

describe('PaymentMethodVisual — العارض المشترك', () => {
  beforeEach(() => { fetchImageUrl.mockReset(); clearPaymentMethodLogoCache(); });
  afterEach(() => cleanup());

  it('طريقة قديمة بلا حقول بصرية تعرض الأيقونة الافتراضية بلا لون مخصص', () => {
    render(<PaymentMethodVisual method={{ id: 'a', settlement_type: 'cash' }} />);
    const icon = screen.getByTestId('payment-method-visual-default');
    expect(icon.getAttribute('style')).toBeNull();
    expect(fetchImageUrl).not.toHaveBeenCalled();
  });

  it('أيقونة بلون صالح تُلوَّن بخاصية color فقط', () => {
    render(<PaymentMethodVisual method={{ id: 'a', visual_mode: 'icon', icon_key: 'wallet', icon_color: '#12AB34' }} />);
    expect(screen.getByTestId('payment-method-visual-icon').getAttribute('style')).toContain('color');
  });

  it('لون غير صالح أو مفتاح غير معروف لا يُحقن ويسقط للافتراضي', () => {
    const { rerender } = render(<PaymentMethodVisual method={{ id: 'a', visual_mode: 'icon', icon_key: 'wallet', icon_color: 'red;background:url(x)' }} />);
    expect(screen.getByTestId('payment-method-visual-icon').getAttribute('style')).toBeNull();
    rerender(<PaymentMethodVisual method={{ id: 'a', visual_mode: 'icon', icon_key: 'evil' }} />);
    expect(screen.getByTestId('payment-method-visual-default')).toBeTruthy();
  });

  it('الشعار يُجلب مصادَقاً ويُعرض بلا تلوين', async () => {
    fetchImageUrl.mockResolvedValue('blob:logo-1');
    render(<PaymentMethodVisual method={{ id: 'img1', visual_mode: 'image', has_logo: true, updated_at: 'v1' }} />);
    await waitFor(() => expect(screen.getByTestId('payment-method-visual-image').querySelector('img')?.getAttribute('src')).toBe('blob:logo-1'));
    expect(fetchImageUrl).toHaveBeenCalledWith('/payment-methods/img1/logo?v=v1');
  });

  it('تعذّر جلب الشعار يسقط إلى الأيقونة الافتراضية', async () => {
    fetchImageUrl.mockResolvedValue(null);
    render(<PaymentMethodVisual method={{ id: 'img2', settlement_type: 'bank', visual_mode: 'image', has_logo: true, updated_at: 'v1' }} />);
    await waitFor(() => expect(screen.getByTestId('payment-method-visual-default')).toBeTruthy());
  });
});
