import { describe, expect, it } from 'vitest';
import { notificationHref, type AppNotification } from './notifications';

const base: AppNotification = {
  id: 'n1', category: 'alert', type: 'x', severity: 'warning', title: 'x', message: 'x',
  source_type: 'invoice', source_id: 'source-1', action: null, data: null, read_at: null, created_at: '2026-09-08T00:00:00Z',
};

describe('PR-NOTIF-5 notification actions', () => {
  it('routes receivables to the existing invoice workspace', () => {
    expect(notificationHref({ ...base, action: 'view_receivable_invoice' })).toBe('/invoices/source-1');
  });

  it('routes POS alerts to the existing session workspace', () => {
    expect(notificationHref({ ...base, source_type: 'pos_session', action: 'view_pos_session' })).toBe('/pos/sessions/source-1');
  });
});
