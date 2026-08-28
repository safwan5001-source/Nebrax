// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

import { PosTopbar } from './pos-topbar';

afterEach(() => {
  cleanup();
  router.push.mockReset();
  router.replace.mockReset();
  router.refresh.mockReset();
});

describe('العودة للنظام في شريط POS', () => {
  it('يستدعي حارس الصفحة ولا ينتقل مباشرة عند توفير onReturnToSystem', () => {
    const onReturnToSystem = vi.fn();
    renderIntl(
      <PosTopbar cashier="كاشير" branch="الفرع الرئيسي" onReturnToSystem={onReturnToSystem} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'العودة للنظام' }));
    expect(onReturnToSystem).toHaveBeenCalledOnce();
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'العودة للنظام' })).toBeNull();
  });

  it('ينتقل إلى لوحة التحكم مباشرة إن لم يُمرَّر حارس', () => {
    renderIntl(<PosTopbar cashier="كاشير" branch="الفرع الرئيسي" />);

    fireEvent.click(screen.getByRole('button', { name: 'العودة للنظام' }));
    expect(router.push).toHaveBeenCalledWith('/dashboard');
  });
});
