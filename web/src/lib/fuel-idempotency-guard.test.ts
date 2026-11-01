import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FS-08 حارس معماري: مفتاح idempotency/evidence للنوايا المالية لا يُولَّد داخل جسم الطلب
 * (`crypto.randomUUID()` عند كل إرسال)، بل عبر `useIntentKeys` فيثبت عند إعادة محاولة الحمولة نفسها.
 */
const PAGES = ['sales', 'shifts', 'avi-rfid', 'receiving'];

describe('fuel pages idempotency keys', () => {
  it.each(PAGES)('%s does not mint a fresh key inside the request body', (page) => {
    const source = readFileSync(join(__dirname, '..', 'app', '(fuel)', 'fuel-stations', page, 'page.tsx'), 'utf8');
    expect(source).not.toMatch(/(idempotency_key|evidence_key)\s*:\s*[`'"]?[^,\n]*crypto\.randomUUID\(\)/);
    expect(source).toContain('useIntentKeys');
  });
});
