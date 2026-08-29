import { describe, expect, it } from 'vitest';
import {
  buildEventDiff,
  buildEventSummaryRows,
  buildTechnicalEvidence,
  observedPayload,
  type AuditEventLike,
} from '../../modules/pos-audit/event-presentation';
import { isKnownRuleKey, resolveRuleLabel } from '../../modules/pos-audit/rule-labels';

function event(partial: Partial<AuditEventLike> & { type: string }): AuditEventLike {
  return {
    amount: null,
    reason_code: null,
    reason_note: null,
    created_at: '2026-08-29T10:00:00Z',
    cart_id: 'cart-1',
    correlation_id: 'corr-1',
    payload: {},
    ...partial,
  };
}

describe('rule labels', () => {
  const labels: Record<string, string> = {
    approval_replay: 'تكرار طلبات الموافقة',
    approval_required_rate: 'معدّل العمليات المحتاجة اعتماداً',
    approver_concentration: 'تركّز المعتمِد',
    override_approval_rate: 'معدّل الموافقة على الاستثناءات',
    performer_approver_pair_concentration: 'تركّز زوج المنفّذ والمعتمِد',
  };

  it.each([
    'approval_replay',
    'approval_required_rate',
    'approver_concentration',
    'override_approval_rate',
    'performer_approver_pair_concentration',
  ] as const)('maps known rule key %s', (key) => {
    expect(isKnownRuleKey(key)).toBe(true);
    expect(resolveRuleLabel(key, (k) => labels[k] ?? '')).toBe(labels[key]);
  });

  it('falls back to raw key for unknown rules', () => {
    expect(isKnownRuleKey('totally_unknown_rule')).toBe(false);
    expect(resolveRuleLabel('totally_unknown_rule', () => '')).toBe('totally_unknown_rule');
  });
});

describe('POS audit event presentation', () => {
  it('builds a human summary from available fields only', () => {
    const rows = buildEventSummaryRows(
      event({
        type: 'cart_cancelled',
        reason_note: 'سعر خاطئ',
        amount: '300.00',
        performed_by_user: { id: 'u1', name: 'أحمد' },
        session: { id: 's1', number: 'POS-12' },
        payload: {
          client_observed: {
            before: {
              item: { description: 'فطيرة الأجبان الثلاثة', quantity: 1, unit_price: 30000 },
              status: 'active',
            },
            after: { status: 'cancelled' },
          },
        },
      }),
      {
        formatAmount: (v) => `${v}`,
        formatMoneyMinor: (v) => `${Number(v) / 100}`,
        formatDate: () => '29 أغسطس 2026',
        statusLabel: (s) => (s === 'active' ? 'نشطة' : s === 'cancelled' ? 'ملغاة' : s),
      },
    );

    expect(rows.find((row) => row.field === 'product')?.value).toBe('فطيرة الأجبان الثلاثة');
    expect(rows.find((row) => row.field === 'quantity')?.value).toBe('1');
    expect(rows.find((row) => row.field === 'price')?.value).toBe('300');
    expect(rows.find((row) => row.field === 'reason')?.value).toBe('سعر خاطئ');
    expect(rows.find((row) => row.field === 'change')?.value).toBe('نشطة → ملغاة');
    expect(rows.every((row) => row.value !== undefined)).toBe(true);
  });

  it('diffs status, price, and quantity and ignores key order', () => {
    const status = buildEventDiff(
      { status: 'active' },
      { status: 'cancelled' },
      { formatStatus: (s) => (s === 'active' ? 'نشطة' : s === 'cancelled' ? 'ملغاة' : s) },
    );
    expect(status).toEqual([
      { path: 'status', field: 'status', before: 'نشطة', after: 'ملغاة' },
    ]);

    const price = buildEventDiff(
      { item: { unit_price: 2500, quantity: 1 } },
      { item: { quantity: 1, unit_price: 2000 } },
      { formatMoneyMinor: (v) => (Number(v) / 100).toFixed(2) },
    );
    expect(price).toContainEqual({
      path: 'item.unit_price',
      field: 'unit_price',
      before: '25.00',
      after: '20.00',
    });

    const quantity = buildEventDiff({ item: { quantity: 2 } }, { item: { quantity: 1 } });
    expect(quantity).toEqual([
      { path: 'item.quantity', field: 'quantity', before: '2', after: '1' },
    ]);
  });

  it('does not treat missing nested containers as field deletions', () => {
    const rows = buildEventDiff(
      { item: { description: 'فطيرة', quantity: 1 }, status: 'active' },
      { status: 'cancelled' },
    );
    expect(rows).toEqual([
      { path: 'status', field: 'status', before: 'active', after: 'cancelled' },
    ]);
  });

  it('returns no diff when values are equal despite key order', () => {
    expect(buildEventDiff({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
  });

  it('handles missing before/after safely', () => {
    expect(buildEventDiff(undefined, undefined)).toEqual([]);
    expect(buildEventDiff(null, { status: 'cancelled' })[0]?.after).toBe('cancelled');
  });

  it('preserves raw evidence in technical payload', () => {
    const payload = {
      client_observed: { before: { z: 1, a: 2 }, after: { status: 'cancelled' }, secret_marker: 'keep-me' },
    };
    const evidence = buildTechnicalEvidence(
      event({
        type: 'cart_cancelled',
        payload,
        source: 'client_observed',
        trust_level: 'secondary',
      }),
    );
    expect(evidence.payload).toEqual(payload);
    expect(evidence.correlation_id).toBe('corr-1');
    expect(evidence.cart_id).toBe('cart-1');
    expect(observedPayload(payload).secret_marker).toBe('keep-me');
  });
});
