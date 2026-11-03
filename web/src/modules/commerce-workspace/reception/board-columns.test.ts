import { describe, expect, it } from 'vitest';
import { columnOf, elapsedMinutes, groupOrders } from './board-columns';
import { summaryFixture } from '../orders/test-fixtures';

const o = (id: string, status: string, created = '2026-11-03T10:00:00Z') => summaryFixture({ id, operational_status: status, created_at: created });
const none: ReadonlySet<string> = new Set();

describe('تصنيف أعمدة اللوحة (عرض فقط)', () => {
  it.each([
    ['awaiting_acceptance', 'new'],
    ['accepted', 'accepted'],
    ['preparing', 'accepted'],
    ['ready', 'ready'],
    ['out_for_delivery', 'dispatch'],
    ['delivery_failed', 'dispatch'],
    ['returned_to_store', 'dispatch'],
    ['delivered', 'done'],
    ['picked_up', 'done'],
  ])('%s ⇒ %s', (status, column) => {
    expect(columnOf(o('x', status), none)).toBe(column);
  });

  it.each(['awaiting_payment', 'payment_cancelled', 'draft', 'cancelled', 'future_state', undefined])('%s خارج اللوحة', (status) => {
    expect(columnOf({ id: 'x', operational_status: status as string | undefined }, none)).toBeNull();
  });

  it('مقبول وتنبيهه قائم (الخادم) ⇒ «جديد»، وبعد الإقرار ⇒ «مقبول»', () => {
    expect(columnOf(o('a', 'accepted'), new Set(['a']))).toBe('new');
    expect(columnOf(o('a', 'accepted'), none)).toBe('accepted');
  });

  it('التوزيع يحفظ ترتيب الخادم ويقدّم الطلبات المنتظِرة داخل «جديد»', () => {
    const groups = groupOrders([o('1', 'awaiting_acceptance'), o('2', 'accepted'), o('3', 'ready'), o('4', 'cancelled')], new Set(['2']));
    expect(groups.new.map((x) => x.id)).toEqual(['2', '1']);
    expect(groups.ready.map((x) => x.id)).toEqual(['3']);
    expect(Object.values(groups).flat().map((x) => x.id)).not.toContain('4');
  });

  it('لا منطق حالة محلي: الملف لا يذكر انتقالات ولا أهلية إجراء', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(`${__dirname}/board-columns.ts`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(/accept_action|reject_action|fulfillment_actions|can\(/.test(src)).toBe(false);
  });

  it('elapsedMinutes: دقائق كاملة، لا سالب، وnull عند الفساد', () => {
    const now = Date.parse('2026-11-03T10:10:30Z');
    expect(elapsedMinutes('2026-11-03T10:00:00Z', now)).toBe(10);
    expect(elapsedMinutes('2026-11-03T10:30:00Z', now)).toBe(0);
    expect(elapsedMinutes(null, now)).toBeNull();
    expect(elapsedMinutes('nope', now)).toBeNull();
  });
});
