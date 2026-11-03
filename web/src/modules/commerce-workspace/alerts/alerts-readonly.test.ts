import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('alerts-api: قراءة فقط', () => {
  it('لا طريقة كتابة ولا مسار إقرار في ملف الاستعلام', () => {
    const src = readFileSync(join(__dirname, 'alerts-api.ts'), 'utf8');
    expect(/method:\s*['"](POST|PUT|PATCH|DELETE)/i.test(src)).toBe(false);
    expect(/acknowledge/i.test(src.replace(/\/\*[\s\S]*?\*\//g, ''))).toBe(false);
    expect((src.match(/api</g) ?? []).length).toBeGreaterThanOrEqual(4);
    // Codex: الحالة تُصفّى في الخادم قبل السقف كي لا يحجبها 100 طلب معالَج.
    expect(src).toContain('/commerce/orders/attention?limit=100&pending=1');
  });

  it('لا أحد يخلق Audio خارج المحرّكين المعتمدين (يحرسه alert-sound.test أيضاً)', () => {
    for (const file of ['use-order-alerts.ts', 'order-alert-center.tsx', 'alert-engine.ts', 'tab-coordinator.ts']) {
      expect(readFileSync(join(__dirname, file), 'utf8').includes('new Audio(')).toBe(false);
    }
  });
});
