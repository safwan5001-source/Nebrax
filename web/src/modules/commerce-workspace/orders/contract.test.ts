import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORDERS_STATE,
  buildOrdersQuery,
  classifyOrdersError,
  parseOrdersState,
  serializeOrdersState,
} from './contract';

const params = (qs: string) => new URLSearchParams(qs);

describe('orders list state', () => {
  it('defaults to newest first, page 1, 20 per page', () => {
    expect(parseOrdersState(params(''))).toEqual(DEFAULT_ORDERS_STATE);
  });

  it('drops values outside the server whitelists instead of forwarding them', () => {
    const state = parseOrdersState(
      params('sort=tenant_id&payment_status=hacked&payment_method=x&delivery_method=drone&channel=nope&from=2026-1-1&per_page=1000&page=-3'),
    );
    expect(state.sort).toBe('-created_at');
    expect(state).toMatchObject({ paymentStatus: '', paymentMethod: '', deliveryMethod: '', salesChannelId: '', from: '', perPage: 20, page: 1 });
  });

  it('round-trips a valid state through the URL', () => {
    const channel = '22222222-2222-4222-8222-222222222222';
    const state = parseOrdersState(
      params(`q=سارة&scope=all&channel=${channel}&payment_status=paid&payment_method=online&delivery_method=pickup&from=2026-10-01&to=2026-10-31&sort=-total&page=3&per_page=50`),
    );
    expect(parseOrdersState(serializeOrdersState(state))).toEqual(state);
    expect(state.scopeAll).toBe(true);
  });

  it('never serializes the store (owned by the store context)', () => {
    expect(serializeOrdersState({ ...DEFAULT_ORDERS_STATE, scopeAll: false }).has('store')).toBe(false);
  });
});

describe('buildOrdersQuery', () => {
  it('sends storefront_id and sales_channel_id as independent keys', () => {
    const q = buildOrdersQuery({ ...DEFAULT_ORDERS_STATE, salesChannelId: '22222222-2222-4222-8222-222222222222' }, 'store-1');
    expect(q.get('storefront_id')).toBe('store-1');
    expect(q.get('sales_channel_id')).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('omits storefront_id for all-stores scope and when no store is resolved', () => {
    expect(buildOrdersQuery({ ...DEFAULT_ORDERS_STATE, scopeAll: true }, 'store-1').has('storefront_id')).toBe(false);
    expect(buildOrdersQuery(DEFAULT_ORDERS_STATE, null).has('storefront_id')).toBe(false);
  });

  it('maps sort to server sort + direction and caps per_page at 50', () => {
    const q = buildOrdersQuery({ ...DEFAULT_ORDERS_STATE, sort: 'total', perPage: 500 }, null);
    expect(q.get('sort')).toBe('total');
    expect(q.get('direction')).toBe('asc');
    expect(q.get('per_page')).toBe('50');
    expect(buildOrdersQuery(DEFAULT_ORDERS_STATE, null).get('direction')).toBe('desc');
  });

  it('does not send a search shorter than 2 characters and trims', () => {
    expect(buildOrdersQuery({ ...DEFAULT_ORDERS_STATE, q: 'a' }, null).has('q')).toBe(false);
    expect(buildOrdersQuery({ ...DEFAULT_ORDERS_STATE, q: '  سارة ' }, null).get('q')).toBe('سارة');
  });

  it('never sends an inverted date range', () => {
    const q = buildOrdersQuery({ ...DEFAULT_ORDERS_STATE, from: '2026-10-10', to: '2026-10-01' }, null);
    expect(q.has('to')).toBe(false);
  });
});

describe('classifyOrdersError', () => {
  it('maps HTTP statuses and network failures', () => {
    expect(classifyOrdersError({ status: 403 })).toBe('forbidden');
    expect(classifyOrdersError({ status: 404 })).toBe('not_found');
    expect(classifyOrdersError({ status: 422 })).toBe('validation');
    expect(classifyOrdersError({ status: 500 })).toBe('unknown');
    expect(classifyOrdersError(new TypeError('Failed to fetch'))).toBe('network');
  });
});
