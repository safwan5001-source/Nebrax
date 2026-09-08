import { api } from './api';

export type NotificationCategory = 'alert' | 'update';
export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  type: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  source_type: string | null;
  source_id: string | null;
  action: string | null;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

export interface PaginatedNotifications {
  data: AppNotification[];
  meta?: { current_page: number; last_page: number; per_page: number; total: number };
}

export interface NotificationListParams {
  category?: NotificationCategory;
  read?: 'read' | 'unread';
  per_page?: number;
  page?: number;
}

function toQuery(params: NotificationListParams): string {
  const search = new URLSearchParams();
  if (params.category) search.set('category', params.category);
  if (params.read) search.set('read', params.read);
  if (params.per_page) search.set('per_page', String(params.per_page));
  if (params.page) search.set('page', String(params.page));
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function fetchNotifications(params: NotificationListParams = {}): Promise<PaginatedNotifications> {
  return api<PaginatedNotifications>(`/notifications${toQuery(params)}`);
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await api<{ data: { count: number } }>('/notifications/unread-count');
  return res.data.count;
}

export async function markNotificationRead(id: string): Promise<AppNotification> {
  const res = await api<{ data: AppNotification }>(`/notifications/${id}/read`, { method: 'POST' });
  return res.data;
}

export async function markAllNotificationsRead(): Promise<number> {
  const res = await api<{ data: { updated: number } }>('/notifications/mark-all-read', { method: 'POST' });
  return res.data.updated;
}

const ACTION_PATHS: Record<string, (sourceId: string) => string> = {
  view_product: (id) => `/products/${id}`,
  view_financial_alert: () => '/financial-alerts',
  view_zatca_submission: (invoiceId) => `/invoices/${invoiceId}`,
  // PR-NOTIF-5
  view_receivable_invoice: (invoiceId) => `/invoices/${invoiceId}`,
  view_pos_session: (sessionId) => `/pos/sessions/${sessionId}`,
};

export function notificationHref(notification: AppNotification): string | null {
  if (!notification.action || !notification.source_id) return null;
  const builder = ACTION_PATHS[notification.action];
  return builder ? builder(notification.source_id) : null;
}

export function formatUnreadBadge(count: number): string {
  return count > 99 ? '99+' : String(count);
}
