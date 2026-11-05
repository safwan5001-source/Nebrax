import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * حدّ الكتابة لمساحة «تشغيل المحطات» (UI-0/UI-1 كانت قراءة فقط؛ UI-2 تفتح الكتابة **من نقطة واحدة** وبقائمة بيضاء حرفية).
 * حارس ساكن على مصدر الوحدة (باستثناء الاختبارات و`__fixtures__`):
 *  - `POST` لا يظهر إلا في `write-client.ts`؛ ولا `PUT/PATCH/DELETE` في أي مكان.
 *  - `api(` لا يُستدعى إلا من `read-client.ts` و`write-client.ts`؛ ولا `fetch` مباشر.
 *  - سبعة مسارات كتابة فقط (فتح، إسناد، قراءة عدّاد، قراءة خزان، حركة نقد، إغلاق، **إقرار تحصيل الوردية** `…/collection` التشغيلي): لا اعتماد/مراجعة فرق/تصحيح، ولا مبيعات/تحصيل رسمي/أسعار/استلام.
 *  - مفاتيح idempotency والمسودات لا تُستورد إلا في شاشات الكتابة.
 *  - لا أسماء وقود/أسعار/محطات مكتوبة، ولا بيانات اختبار في الإنتاج.
 */
const dir = fileURLToPath(new URL('.', import.meta.url));
const sources = readdirSync(dir)
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.startsWith('__'))
  .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));

const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
const WRITE_CLIENT = 'write-client.ts';
const WRITE_SCREENS = ['open-shift-screen.tsx', 'readings-entry-screen.tsx', 'handover-screen.tsx', 'collection-section.tsx'];

describe('station-ops writes only through write-client.ts', () => {
  it('has module sources to scan', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it.each(sources)('$file has no PUT/PATCH/DELETE', ({ text }) => {
    expect(code(text)).not.toMatch(/['"`](PUT|PATCH|DELETE)['"`]/i);
  });

  it.each(sources)('$file mentions POST only if it is the write client', ({ file, text }) => {
    const hasPost = /['"`]POST['"`]/i.test(code(text));
    expect(hasPost, file).toBe(file === WRITE_CLIENT);
    if (file !== WRITE_CLIENT) expect(code(text)).not.toMatch(/method\s*:\s*['"`](?!GET)/i);
  });

  it.each(sources)('$file does not call fetch/axios/XHR directly', ({ text }) => {
    expect(code(text)).not.toMatch(/\bfetch\s*\(|axios|XMLHttpRequest|sendBeacon/);
  });

  it('only read-client.ts and write-client.ts talk to api()', () => {
    for (const { file, text } of sources) {
      const calls = /\bapi\s*[<(]/.test(code(text));
      expect(calls, file).toBe(file === 'read-client.ts' || file === WRITE_CLIENT);
    }
  });

  it('the write client exposes exactly seven actions and builds its own paths (callers never pass a path)', () => {
    const client = code(sources.find((entry) => entry.file === WRITE_CLIENT)!.text);
    const actions = [...client.matchAll(/action: '([a-z_]+)'/g)].map((m) => m[1]);
    expect([...new Set(actions)].sort()).toEqual(['assign_staff', 'cash_movement', 'close', 'collection', 'meter_reading', 'open', 'tank_reading']);
    const paths = [...client.matchAll(/`?['"`]?(\/fuel-stations\/[^'"`$]*|\$\{base\}\/[a-z-]+)/g)].map((m) => m[1]);
    expect([...new Set(paths)].sort()).toEqual(['${base}/cash-movements', '${base}/close', '${base}/collection', '${base}/meter-readings', '${base}/staff', '${base}/tank-readings', '/fuel-stations/shifts/', '/fuel-stations/shifts/open'].sort());
  });

  it.each(sources)('$file never reaches approval, variance review, corrections, sales, payments, prices or receiving', ({ text }) => {
    expect(code(text)).not.toMatch(/\/approve['"`]|cash-variance|\/corrections|fuel-stations\/(sales|deliveries|supplier-invoices|reconciliations|readings|corporate|fleet|fuel-cards|avi)|sale-payment-methods|sales\/\$\{|\/payments/);
  });

  it('keeps idempotency/draft helpers out of everything but the write screens', () => {
    for (const { file, text } of sources) {
      const uses = /from '\.\/(intents|drafts)'/.test(code(text));
      const allowed = WRITE_SCREENS.includes(file) || file === 'entry.ts' || file === 'drafts.ts' || file === 'intents.ts';
      if (uses) expect(allowed, file).toBe(true);
    }
  });

  it.each(sources)('$file hard-codes no fuel catalogue, price or station', ({ text }) => {
    const source = code(text);
    expect(source).not.toMatch(/diesel|ديزل|بنزين|gasoline|petrol|\b91\b|\b95\b|ULP|Nebras|نبراس|نبراكس/i);
    expect(source).not.toMatch(/price_per_liter_minor\s*[:=]\s*\d/);
  });

  it.each(sources)('$file imports no mock/demo data or test fixtures', ({ text }) => {
    expect(code(text)).not.toMatch(/mock-data|demo-product-store|__fixtures__/);
  });

  // schemas.ts يصف حقول **الاستجابة** (measured_at/recorded_at) فقط؛ لا يكتب شيئاً.
  it.each(sources.filter(({ file }) => file !== 'schemas.ts'))('$file never sends a client clock (measured_at / recorded_at) — the server stamps the time', ({ text }) => {
    expect(code(text)).not.toMatch(/measured_at\s*:|recorded_at\s*:/);
  });

  it('no auto-save: write calls live only in explicit handlers of the write screens (no effect-driven POST)', () => {
    for (const file of WRITE_SCREENS) {
      const source = code(sources.find((entry) => entry.file === file)!.text);
      for (const effect of source.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[/g)) expect(effect[1], file).not.toMatch(/opsWrite/);
    }
  });
});
