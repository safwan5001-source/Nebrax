import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * D-H4-07 (خيار ب): مفتاح واحد فقط قابل للتحرير من هذه الوحدة (`commerce_payment_hold_minutes`)؛ المفاتيح المحاسبية/الضريبية للقراءة. حارس ساكن على المصدر.
 */
describe('order policies module writes only the hold time (D-H4-07)', () => {
  const dir = __dirname;
  const sources = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
  const code = (f: string) => readFileSync(join(dir, f), 'utf8');

  it('has sources to inspect', () => {
    expect(sources.length).toBeGreaterThan(3);
  });

  it.each(['commerce_invoice_trigger', 'commerce_price_tax_mode', 'commerce_partner_policy'])('%s is never sent in a request body', (key) => {
    for (const file of sources) {
      const lines = code(file).split('\n').filter((line) => line.includes(key) && !/^\s*(\*|\/\/|\/\*)/.test(line));
      for (const line of lines) {
        // الظهور المسموح الوحيد: قراءة الحقل من الاستجابة (`data.<key>`) في `api.ts`.
        expect(line, `${file}: ${line.trim()}`).toMatch(/data\.commerce_|typeof data\./);
      }
    }
  });

  it('the only write is a PUT to /sales-settings and there is no DELETE/POST/PATCH', () => {
    const all = sources.map(code).join('\n');
    expect([...all.matchAll(/method:\s*'(\w+)'/g)].map((m) => m[1])).toEqual(['PUT']);
  });
});
