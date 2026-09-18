import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const locale = { current: 'ar' };

vi.mock('next-intl', () => ({
  useLocale: () => locale.current,
}));

vi.mock('@/modules/commerce-workspace/store-context', () => ({
  useCommerceStoreContext: () => ({
    catalog: {
      status: 'ready',
      stores: [{ id: 's1', name: 'متجر النور', salesChannelId: 'c1', isActive: true, previewUrl: null, defaultLocale: 'ar' }],
    },
    selectedStoreId: 's1',
    setSelectedStoreId: vi.fn(),
    viewStoreUrl: null,
    refresh: vi.fn(),
  }),
}));

import CommerceAppearancePage from './page';

describe('commerce appearance — STORE-UI-6', () => {
  afterEach(() => {
    cleanup();
    locale.current = 'ar';
  });

  it('replaces the destination placeholder with the Experience Builder', () => {
    render(<CommerceAppearancePage />);
    expect(screen.getByText('بناء تجربة المتجر')).toBeTruthy();
    expect(screen.getByLabelText('معاينة المتجر')).toBeTruthy();
    expect(screen.queryByText('هذه الشاشة جزء من مساحة العمل وستنمو لاحقاً دون تكرار وحدات أَوْج.')).toBeNull();
  });

  it('uses the live store name as the typographic identity fallback', () => {
    render(<CommerceAppearancePage />);
    expect(screen.getAllByText('متجر النور').length).toBeGreaterThan(0);
  });

  it('does not report a fake save or publish', async () => {
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await user.click(screen.getByRole('button', { name: 'حفظ المسودة' }));
    expect(screen.getByRole('status').textContent).toMatch(/لم يُحفظ شيء/);
    await user.click(screen.getByRole('button', { name: 'نشر' }));
    expect(screen.getByRole('status').textContent).toMatch(/النشر غير مفعّل/);
    expect(screen.queryByText(/تم الحفظ/)).toBeNull();
  });
});
