import { describe, expect, it } from 'vitest';
import { buildWholesaleOrdersQuery, parseWholesaleOrdersState } from './query';

const CHANNEL = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('wholesale orders query', () => {
  it('locks the request to the wholesale channel with server sort and pagination', () => {
    const q = buildWholesaleOrdersQuery(parseWholesaleOrdersState(new URLSearchParams('payment_status=collected&page=2&sort=-total')), CHANNEL);
    expect(q.get('sales_channel_id')).toBe(CHANNEL);
    expect(q.get('payment_status')).toBe('collected');
    expect(q.get('sort')).toBe('total');
    expect(q.get('direction')).toBe('desc');
    expect(q.get('page')).toBe('2');
    expect(q.get('per_page')).toBe('20');
  });

  it('cannot be widened or redirected through the URL (channel, scope, storefront)', () => {
    const state = parseWholesaleOrdersState(new URLSearchParams(`channel=${OTHER}&scope=all&storefront_id=${OTHER}&store=${OTHER}`));
    const q = buildWholesaleOrdersQuery(state, CHANNEL);
    expect(q.get('sales_channel_id')).toBe(CHANNEL);
    expect(q.has('storefront_id')).toBe(false);
    expect(q.toString()).not.toContain(OTHER);
  });

  it('drops invalid filter values and never sends a tenant', () => {
    const q = buildWholesaleOrdersQuery(
      parseWholesaleOrdersState(new URLSearchParams('payment_method=bitcoin&from=bad&sort=hack&tenant_id=x&q=a')),
      CHANNEL,
    );
    expect(q.has('payment_method')).toBe(false);
    expect(q.has('from')).toBe(false);
    expect(q.get('sort')).toBe('created_at');
    expect(q.has('tenant_id')).toBe(false);
    expect(q.has('q')).toBe(false); // below the 2-char minimum
  });
});
