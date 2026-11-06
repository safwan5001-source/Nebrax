import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * حدّ مساحة الاستلام (FUEL-B5): قراءة بقائمة بيضاء + **ثلاث كتابات POST فقط** من `receiving-client.ts` وحده (تسجيل قراءة خزان · إنشاء مسودة · اعتماد).
 * لا يُضعف هذا الحارس حدّ `write-boundary.test.ts` للوحدة الأم (التي تمنع مسارات الاستلام من خارج هذا المجلد) ولا حدّ `admin/`.
 */
const dir = fileURLToPath(new URL('.', import.meta.url));
const sources = readdirSync(dir)
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.startsWith('__'))
  .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
const CLIENT = 'receiving-client.ts';
const client = () => code(sources.find((entry) => entry.file === CLIENT)!.text);

describe('receiving writes only through receiving-client.ts', () => {
  it('has sources to scan', () => expect(sources.length).toBeGreaterThan(8));

  it.each(sources)('$file has no PUT/PATCH/DELETE', ({ text }) => {
    expect(code(text)).not.toMatch(/['"`](PUT|PATCH|DELETE)['"`]/i);
  });

  it('POST exists in the client exactly once (one shared sender) and nowhere else', () => {
    for (const { file, text } of sources) expect([...code(text).matchAll(/['"`]POST['"`]/gi)].length, file).toBe(file === CLIENT ? 1 : 0);
  });

  it('only the client talks to api(), and nobody uses fetch/axios/XHR', () => {
    for (const { file, text } of sources) {
      expect(/\bapi\s*[<(]/.test(code(text)), file).toBe(file === CLIENT);
      expect(code(text), file).not.toMatch(/\bfetch\s*\(|axios|XMLHttpRequest|sendBeacon/);
    }
  });

  it('the read whitelist is exactly four endpoints (deliveries, one delivery by uuid, suppliers, readings)', () => {
    const c = client();
    expect([...c.matchAll(/^\s+(?:\/\^\\\/fuel-stations\\\/[^\n]*\$\/|new RegExp\(`\^\/fuel-stations\/deliveries\/\$\{UUID\}\$`\)),$/gm)]).toHaveLength(4);
    expect(c).toContain('delivery-suppliers');
    expect(c).toMatch(/api<unknown>\(path, \{ method: 'POST'/);
  });

  it('the three write paths are fixed in the client: readings, deliveries and the uuid-validated approve', () => {
    const c = client();
    expect(c).toContain("send('/fuel-stations/readings'");
    expect(c).toContain("send('/fuel-stations/deliveries'");
    expect(c).toMatch(/`\$\{deliveryPath\(id\)\}\/approve`/);
    expect([...c.matchAll(/\bsend\(/g)].length).toBe(4); // تعريف + ثلاثة استدعاءات
    expect(c).not.toMatch(/\/reject|\/cancel|\/void|\/edit|\/delete|\/reopen/);
  });

  it.each(sources)('$file reaches no other module’s endpoints (no second permission system; nothing financial, sales or other fuel flows)', ({ text }) => {
    expect(code(text)).not.toMatch(/\/roles\b|\/users\b|fuel-stations\/(sales|supplier-invoices|reconciliations|prices|shifts|corporate|fleet|fuel-cards|avi|staff|settings|stations\/)|\/payments|\/journal|\/ledger|\/products\b|\/warehouses|\/partners/);
  });

  it.each(sources)('$file never imports the shift write client, intents-of-shifts helpers or drafts', ({ text }) => {
    expect(code(text)).not.toMatch(/from '\.\.\/(write-client|drafts|entry)'/);
  });

  it('writes are never started from an effect (no auto-save, no auto-resubmit)', () => {
    for (const { file, text } of sources) {
      for (const effect of code(text).matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[/g)) expect(effect[1], file).not.toMatch(/runCreate|approveDelivery|recordReading|createDelivery|submit\(|confirm\(/);
    }
  });

  it('only the create flow and the detail screen import the write functions', () => {
    const importers = (pattern: RegExp) => sources.filter(({ text }) => pattern.test(code(text))).map(({ file }) => file).sort();
    expect(importers(/import \{[^}]*\bapproveDelivery\b[^}]*\} from '\.\/receiving-client'/)).toEqual(['receiving-detail-screen.tsx']);
    expect(importers(/import \{[^}]*\b(createDelivery|recordReading)\b[^}]*\} from '\.\/receiving-client'/)).toEqual(['create-flow.ts']);
    expect(importers(/import \{[^}]*\brunCreate\b[^}]*\} from '\.\/create-flow'/)).toEqual(['receiving-new-screen.tsx']);
  });

  it.each(sources)('$file imports no fixtures/mock data, hard-codes no fuel catalogue, and never sends a client clock', ({ file, text }) => {
    const c = code(text);
    expect(c).not.toMatch(/mock-data|demo-product-store|__fixtures__/);
    expect(c).not.toMatch(/diesel|ديزل|بنزين|gasoline|petrol|\b91\b|\b95\b|ULP|Nebras|نبراس|نبراكس/i);
    // schemas.ts يصف حقول **الاستجابة** فقط؛ لا يكتب شيئاً.
    if (file !== 'schemas.ts') expect(c).not.toMatch(/\breceived_at\s*:|\bmeasured_at\s*:/);
  });

  it('cost is shown only when the server returned it (never defaulted), and never invented client-side', () => {
    for (const { file, text } of sources) expect(code(text), file).not.toMatch(/received_total_cost_minor\s*\?\?\s*0|received_total_cost_minor\s*\|\|\s*0/);
  });
});
