/* @vitest-environment jsdom */
import * as React from 'react';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_LOCALES } from '@/test-utils/intl';
import { NotificationBell } from './notification-bell';
import type { AppNotification } from '@/lib/notifications';

const { fetchUnreadCount, fetchNotifications, markNotificationRead, markAllNotificationsRead } = vi.hoisted(() => ({
  fetchUnreadCount: vi.fn(),
  fetchNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

vi.mock('@/lib/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifications')>();
  return {
    ...actual,
    fetchUnreadCount,
    fetchNotifications,
    markNotificationRead,
    markAllNotificationsRead,
  };
});

function notification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    category: 'alert',
    type: 'test.notification',
    severity: 'warning',
    title: 'مخزون منخفض',
    message: 'كمية الصنف اقتربت من حد إعادة الطلب.',
    source_type: null,
    source_id: null,
    action: null,
    data: null,
    read_at: null,
    created_at: '2026-09-06T10:00:00Z',
    ...overrides,
  };
}

async function openPanel() {
  const trigger = screen.getByRole('button', { name: /الإشعارات|Notifications/ });
  await act(async () => {
    fireEvent.click(trigger);
  });
}

beforeEach(() => {
  fetchUnreadCount.mockReset().mockResolvedValue(0);
  fetchNotifications.mockReset().mockResolvedValue({ data: [] });
  markNotificationRead.mockReset();
  markAllNotificationsRead.mockReset();
});

afterEach(cleanup);

describe('NotificationBell — unread badge', () => {
  it('shows no badge when unread count is zero', async () => {
    fetchUnreadCount.mockResolvedValue(0);
    renderIntl(<NotificationBell />);
    await waitFor(() => expect(fetchUnreadCount).toHaveBeenCalled());
    expect(screen.queryByTestId('notification-badge')).toBeNull();
  });

  it('shows the exact count for a normal unread count', async () => {
    fetchUnreadCount.mockResolvedValue(7);
    renderIntl(<NotificationBell />);
    await waitFor(() => expect(screen.getByTestId('notification-badge').textContent).toBe('7'));
  });

  it('caps the badge at 99+ for large counts', async () => {
    fetchUnreadCount.mockResolvedValue(150);
    renderIntl(<NotificationBell />);
    await waitFor(() => expect(screen.getByTestId('notification-badge').textContent).toBe('99+'));
  });
});

describe('NotificationBell — panel states', () => {
  it('loads and renders notifications when opened', async () => {
    fetchNotifications.mockResolvedValue({ data: [notification({ title: 'صنف منخفض المخزون' })] });
    renderIntl(<NotificationBell />);

    await openPanel();

    await waitFor(() => expect(fetchNotifications).toHaveBeenCalled());
    expect(await screen.findByText('صنف منخفض المخزون')).toBeTruthy();
  });

  it('shows an empty state when there are no notifications', async () => {
    fetchNotifications.mockResolvedValue({ data: [] });
    renderIntl(<NotificationBell />);

    await openPanel();

    expect(await screen.findByText('لا توجد إشعارات ضمن هذا التبويب.')).toBeTruthy();
  });

  it('shows an error state with a working retry action', async () => {
    fetchNotifications.mockRejectedValueOnce(new Error('network'));
    renderIntl(<NotificationBell />);

    await openPanel();

    expect(await screen.findByText('تعذّر تحميل الإشعارات.')).toBeTruthy();

    fetchNotifications.mockResolvedValueOnce({ data: [notification({ title: 'بعد إعادة المحاولة' })] });
    const retryButton = screen.getByRole('button', { name: 'إعادة المحاولة' });
    await act(async () => {
      fireEvent.click(retryButton);
    });

    expect(await screen.findByText('بعد إعادة المحاولة')).toBeTruthy();
  });

  it('refetches with the category filter when switching tabs', async () => {
    fetchNotifications.mockResolvedValue({ data: [] });
    renderIntl(<NotificationBell />);

    await openPanel();
    await waitFor(() => expect(fetchNotifications).toHaveBeenCalledWith({ category: undefined, per_page: 10 }));

    const alertsTab = screen.getByRole('tab', { name: 'تنبيهات' });
    await act(async () => {
      fireEvent.click(alertsTab);
    });

    await waitFor(() => expect(fetchNotifications).toHaveBeenCalledWith({ category: 'alert', per_page: 10 }));
  });
});

describe('NotificationBell — mark read actions', () => {
  it('marks a single unread notification as read on click', async () => {
    const unread = notification({ id: 'n1', read_at: null });
    fetchNotifications.mockResolvedValue({ data: [unread] });
    markNotificationRead.mockResolvedValue({ ...unread, read_at: '2026-09-06T11:00:00Z' });

    renderIntl(<NotificationBell />);
    await openPanel();
    const row = await screen.findByText(unread.title);

    await act(async () => {
      fireEvent.click(row);
    });

    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith('n1'));
  });

  it('disables mark-all-read when there is nothing unread, and calls the API otherwise', async () => {
    fetchUnreadCount.mockResolvedValue(0);
    renderIntl(<NotificationBell />);
    await waitFor(() => expect(fetchUnreadCount).toHaveBeenCalled());
    await openPanel();

    const markAllButton = screen.getByRole('button', { name: 'تحديد الكل كمقروء' });
    expect(markAllButton.hasAttribute('disabled')).toBe(true);

    cleanup();
    fetchUnreadCount.mockResolvedValue(2);
    markAllNotificationsRead.mockResolvedValue(2);
    fetchNotifications.mockResolvedValue({ data: [notification()] });

    renderIntl(<NotificationBell />);
    await waitFor(() => expect(screen.getByTestId('notification-badge').textContent).toBe('2'));
    await openPanel();

    const enabledButton = screen.getByRole('button', { name: 'تحديد الكل كمقروء' });
    expect(enabledButton.hasAttribute('disabled')).toBe(false);

    await act(async () => {
      fireEvent.click(enabledButton);
    });

    await waitFor(() => expect(markAllNotificationsRead).toHaveBeenCalled());
  });
});

describe('NotificationBell — source action safety', () => {
  it('does not render a source link when the notification carries an unregistered action', async () => {
    fetchNotifications.mockResolvedValue({
      data: [notification({ action: 'view_product', source_type: 'product', source_id: 'p1' })],
    });
    renderIntl(<NotificationBell />);

    await openPanel();
    await screen.findByText(notification().title);

    expect(screen.queryByText('عرض المصدر')).toBeNull();
  });
});

describe('NotificationBell — locale-sensitive rendering', () => {
  for (const locale of TEST_LOCALES) {
    it(`renders tab labels from the real ${locale} messages`, async () => {
      fetchUnreadCount.mockResolvedValue(0);
      const { container } = renderIntl(<NotificationBell />, locale);
      await waitFor(() => expect(fetchUnreadCount).toHaveBeenCalled());
      await openPanel();

      const expected = locale === 'ar' ? ['الكل', 'تنبيهات', 'تحديثات'] : ['All', 'Alerts', 'Updates'];
      for (const label of expected) {
        expect(within(container).getByRole('tab', { name: label })).toBeTruthy();
      }
    });
  }
});
