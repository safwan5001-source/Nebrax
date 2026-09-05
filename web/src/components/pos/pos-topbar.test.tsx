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

describe('مصطلح الجلسة في شريط POS', () => {
  it('يسمّي إجراء إدارة الجلسة باسمها الصحيح لا «الوردية»، ويعرض رقم الجلسة بالتسمية ذاتها', () => {
    renderIntl(
      <PosTopbar
        cashier="كاشير"
        branch="الفرع الرئيسي"
        session={{ number: 'PS-1', pos_device: null }}
      />,
    );

    expect(screen.getByRole('button', { name: 'إدارة الجلسة' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'إدارة الوردية' })).toBeNull();
    expect(screen.getByTitle('الجلسة')).toBeTruthy();
  });
});

describe('فيض شريط POS على الجوال', () => {
  it('يستدعي نفس callbacks الفواتير الأخيرة والمعلّقة من قائمة الإجراءات الإضافية', () => {
    const onOpenRecentInvoices = vi.fn();
    const onOpenHeld = vi.fn();
    renderIntl(
      <PosTopbar
        cashier="كاشير"
        branch="الفرع الرئيسي"
        heldCount={2}
        onOpenRecentInvoices={onOpenRecentInvoices}
        onOpenHeld={onOpenHeld}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'إجراءات إضافية' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'آخر الفواتير' }));
    expect(onOpenRecentInvoices).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'إجراءات إضافية' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'المعلّقة (2)' }));
    expect(onOpenHeld).toHaveBeenCalledOnce();
  });
});
