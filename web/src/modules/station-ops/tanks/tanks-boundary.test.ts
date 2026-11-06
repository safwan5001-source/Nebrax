import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * حدّ مساحة «مستويات الخزانات» (FUEL-B6): قراءة بقائمة بيضاء من مسارين **وبلا أي كتابة خاصة بها**. تسجيل القراءة يمرّ حصراً عبر `recordReading` القائم في
 * `../receiving/receiving-client` (الكاتب الوحيد لـ`POST /fuel-stations/readings` في التطبيق) ويستعمله نموذج التسجيل وحده — فلا نظام قراءات موازٍ.
 * لا يُضعف هذا الحارس حدّ `write-boundary.test.ts` ولا `receiving-boundary.test.ts` ولا `admin/`.
 */
const dir = fileURLToPath(new URL('.', import.meta.url));
const sources = readdirSync(dir)
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.startsWith('__'))
  .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
const CLIENT = 'levels-client.ts';

describe('tank levels is read-only apart from the single shared reading writer', () => {
  it('has sources to scan', () => expect(sources.length).toBeGreaterThan(6));

  it.each(sources)('$file has no HTTP write verbs of its own', ({ text }) => {
    expect(code(text)).not.toMatch(/['"`](POST|PUT|PATCH|DELETE)['"`]/i);
    expect(code(text)).not.toMatch(/method\s*:\s*['"`](?!GET)/i);
  });

  it('only the levels client talks to api(), and nobody uses fetch/axios/XHR', () => {
    for (const { file, text } of sources) {
      expect(/\bapi\s*[<(]/.test(code(text)), file).toBe(file === CLIENT);
      expect(code(text), file).not.toMatch(/\bfetch\s*\(|axios|XMLHttpRequest|sendBeacon/);
    }
  });

  it('the read whitelist is exactly the monitor and the reading log', () => {
    const client = code(sources.find((entry) => entry.file === CLIENT)!.text);
    expect([...client.matchAll(/^const READ_PATHS: RegExp\[\] = \[(.*)\];$/gm)]).toHaveLength(1);
    expect(client).toContain('tank-levels');
    expect(client).toContain('readings');
    expect([...client.matchAll(/\\\/fuel-stations\\\/([a-z-]+)\$/g)].map((m) => m[1]).sort()).toEqual(['readings', 'tank-levels']);
  });

  it('writes a reading only through the shared recordReading, imported by the record form alone', () => {
    const importers = sources.filter(({ text }) => /import \{[^}]*\brecordReading\b[^}]*\} from '\.\.\/receiving\/receiving-client'/.test(code(text))).map(({ file }) => file);
    expect(importers).toEqual(['record-form.tsx']);
  });

  it.each(sources)('$file reaches no financial, stock, sales, reconciliation or other module endpoints', ({ text }) => {
    expect(code(text)).not.toMatch(/\/reconciliations|\/deliveries|\/supplier-invoices|\/sales|\/payments|\/journal|\/ledger|\/stock|\/products\b|\/warehouses|\/partners|\/roles\b|\/users\b|fuel-stations\/(shifts|prices|staff|settings)/);
  });

  it.each(sources)('$file never imports the shift write client, draft stores or the shift entry logic', ({ text }) => {
    expect(code(text)).not.toMatch(/from '\.\.\/(write-client|drafts|entry)'/);
  });

  it.each(sources)('$file never sends a client clock — the server stamps the measurement time', ({ file, text }) => {
    if (file === 'schemas.ts') return; // يصف حقول الاستجابة فقط
    expect(code(text)).not.toMatch(/measured_at\s*:|recorded_at\s*:/);
  });

  it.each(sources)('$file hard-codes no fuel catalogue, price or station', ({ text }) => {
    const c = code(text);
    expect(c).not.toMatch(/diesel|ديزل|بنزين|gasoline|petrol|\b91\b|\b95\b|ULP|Nebras|نبراس|نبراكس/i);
    expect(c).not.toMatch(/mock-data|demo-product-store|__fixtures__/);
  });

  it('a write never starts from an effect (no auto-save, no auto-resend)', () => {
    for (const { file, text } of sources) {
      for (const effect of code(text).matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[/g)) expect(effect[1], file).not.toMatch(/recordReading|submit\(|check\(/);
    }
  });

  it('keeps the review-before-save step and the single-flight lock in the record form', () => {
    const form = code(sources.find((entry) => entry.file === 'record-form.tsx')!.text);
    expect(form).toContain("setPhase('review')");
    expect(form).toMatch(/if \(sending\.current \|\|/);
    expect(form).toContain('intents.markUncertain(INTENT)');
  });
});
