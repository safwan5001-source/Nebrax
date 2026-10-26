import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** O1b قراءة فقط: لا طريقة كتابة ولا إجراء كتابة في وحدة الطلبات أو صفحاتها. */
const files = [
  ...readdirSync(__dirname).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|test-fixtures/.test(f)).map((f) => join(__dirname, f)),
  join(__dirname, '../../../app/(commerce)/commerce/orders/page.tsx'),
  join(__dirname, '../../../app/(commerce)/commerce/orders/[id]/page.tsx'),
];

describe('orders UI is read only', () => {
  const source = files.map((f) => readFileSync(f, 'utf8')).join('\n');

  it('never issues a mutating request', () => {
    expect(source).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
    expect(source).not.toMatch(/\bapi\([^)]*,\s*\{/);
  });

  it('exposes no write action wording or endpoints', () => {
    expect(source).not.toMatch(/\/collect|\/cancel|payment-intents|\/fulfil|ship\b/i);
    expect(source).not.toMatch(/قبول الطلب|إلغاء الطلب|تحصيل الدفعة|تجهيز الطلب|شحن الطلب/);
  });

  it('uses design tokens, not hard-coded hex colors', () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
