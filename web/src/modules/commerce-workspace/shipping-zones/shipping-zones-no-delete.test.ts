import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * D-H4-09: حذف منطقة شحن يُسقط نوافذ التوصيل المقيَّدة بها (`commerce_delivery_slots.shipping_zone_id` ... cascadeOnDelete)، ولا قراءة تحسب
 * هذا الأثر اليوم. فلا يجوز لأي مصدر في هذه الوحدة استدعاء `DELETE` قبل قرار المالك وإضافة حساب الأثر في الخادم.
 */
describe('shipping zones editor never deletes (D-H4-09)', () => {
  const dir = __dirname;
  const sources = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));

  it('has sources to inspect', () => {
    expect(sources.length).toBeGreaterThan(3);
  });

  it.each(sources)('%s contains no DELETE request', (file) => {
    const code = readFileSync(join(dir, file), 'utf8');
    expect(code).not.toMatch(/method\s*:\s*['"`]DELETE['"`]/i);
    expect(code).not.toMatch(/\bdeleteShippingZone\b|\bdestroyShippingZone\b/);
  });
});
