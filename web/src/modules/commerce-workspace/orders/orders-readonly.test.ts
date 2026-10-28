import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * O1b قراءة فقط ثم O3b: الكتابة الوحيدة المسموحة في وحدة الطلبات هي إلغاء الطلب، معزولة في `cancel-order.ts` (POST …/cancel).
 * لا تحصيل ولا شحن ولا تغيير حالة دفع ولا مسار نية دفع من هذه الوحدة.
 */
const CANCEL_FILE = 'cancel-order.ts';
const all = readdirSync(__dirname).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|test-fixtures/.test(f));
const readFile = (f: string) => readFileSync(join(__dirname, f), 'utf8');
const pages = [
  join(__dirname, '../../../app/(commerce)/commerce/orders/page.tsx'),
  join(__dirname, '../../../app/(commerce)/commerce/orders/[id]/page.tsx'),
].map((f) => readFileSync(f, 'utf8'));
const readOnlySource = [...all.filter((f) => f !== CANCEL_FILE).map(readFile), ...pages].join('\n');
const everything = [...all.map(readFile), ...pages].join('\n');

describe('orders UI writes nothing except the staff cancellation', () => {
  it('never issues a mutating request outside cancel-order.ts', () => {
    expect(readOnlySource).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
    expect(readOnlySource).not.toMatch(/\bapi\([^)]*,\s*\{/);
  });

  it('cancel-order.ts has exactly one mutation: POST …/cancel', () => {
    const src = readFile(CANCEL_FILE);
    expect(src.match(/method:\s*['"][A-Z]+['"]/g)).toEqual(["method: 'POST'"]);
    expect(src).toMatch(/\/cancel`/);
    expect(src.match(/\bapi</g)).toHaveLength(1);
  });

  it('exposes no other write action wording or endpoints', () => {
    expect(everything).not.toMatch(/\/collect|payment-intents|\/fulfil|ship\b/i);
    expect(everything).not.toMatch(/قبول الطلب|تحصيل الدفعة|تجهيز الطلب|شحن الطلب/);
    // مسار الإلغاء مذكور في ملف الإلغاء وحده.
    expect(readOnlySource).not.toMatch(/\}\/cancel|orders\/[^'"`]*\/cancel/);
  });

  it('never reads a build-time/env flag in the browser for the deployment gate', () => {
    expect(everything).not.toMatch(/NEXT_PUBLIC_[A-Z_]*CANCEL|order_cancellation_enabled|process\.env/);
  });

  it('uses design tokens, not hard-coded hex colors', () => {
    expect(everything).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
