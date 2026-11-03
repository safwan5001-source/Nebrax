import { describe, expect, it } from 'vitest';
import { notificationHref, type AppNotification } from './notifications';

const base: AppNotification = {
  id: 'n1', category: 'alert', type: 'commerce.order_placed', severity: 'info', title: 'طلب جديد من المتجر', message: 'وصل طلب جديد رقم CORD-1.',
  source_type: 'commerce_order', source_id: 'order-1', action: 'view_commerce_order', data: { order_number: 'CORD-1' }, read_at: null, created_at: '2026-11-03T00:00:00Z',
};

describe('COPS-H3-1 commerce order notification action', () => {
  it('opens the order in the Commerce workspace', () => {
    expect(notificationHref(base)).toBe('/commerce/orders/order-1');
  });

  it('has no link without a source or with an unknown action', () => {
    expect(notificationHref({ ...base, source_id: null })).toBeNull();
    expect(notificationHref({ ...base, action: 'view_something_else' })).toBeNull();
  });
});
