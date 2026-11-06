import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * حدّ مساحة الإدارة (FUEL-B4): قراءة بقائمة بيضاء + **كتابة واحدة** هي `PUT /fuel-stations/staff/{uuid}` من `admin-client.ts` وحده.
 * هذا الحارس لا يُضعف حدّ `write-boundary.test.ts` للوحدة الأم (التي ما زالت تمنع PUT وتمنع الإشارة إلى مسارات الموظفين)؛ بل يضيف حدّاً لمجلد جديد.
 */
const dir = fileURLToPath(new URL('.', import.meta.url));
const sources = readdirSync(dir)
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.startsWith('__'))
  .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
const CLIENT = 'admin-client.ts';

describe('admin writes only through admin-client.ts', () => {
  it('has sources to scan', () => expect(sources.length).toBeGreaterThan(8));

  it.each(sources)('$file has no POST/PATCH/DELETE', ({ text }) => {
    expect(code(text)).not.toMatch(/['"`](POST|PATCH|DELETE)['"`]/i);
  });

  it('PUT exists in the admin client exactly once and nowhere else', () => {
    for (const { file, text } of sources) {
      const count = [...code(text).matchAll(/['"`]PUT['"`]/gi)].length;
      expect(count, file).toBe(file === CLIENT ? 1 : 0);
    }
  });

  it('only admin-client.ts talks to api(), and nobody uses fetch/axios/XHR', () => {
    for (const { file, text } of sources) {
      expect(/\bapi\s*[<(]/.test(code(text)), file).toBe(file === CLIENT);
      expect(code(text), file).not.toMatch(/\bfetch\s*\(|axios|XMLHttpRequest|sendBeacon/);
    }
  });

  it('the read whitelist is exactly the five staff endpoints and the one write path is the uuid-validated staff path', () => {
    const client = code(sources.find((entry) => entry.file === CLIENT)!.text);
    expect([...client.matchAll(/^\s+\/\^\\\/fuel-stations\\\/staff[^\n]*\$\/,$/gm)]).toHaveLength(4);
    expect(client).toMatch(/new RegExp\(`\^\/fuel-stations\/staff\/\$\{UUID\}\$`\)/);
    expect([...client.matchAll(/staffPath\(/g)].length).toBeGreaterThanOrEqual(2);
    expect(client).toMatch(/api<unknown>\(path, \{ method: 'PUT'/);
  });

  it.each(sources)('$file reaches no other module’s endpoints (no second permission system, nothing financial or inventory)', ({ text }) => {
    // `@/modules/roles/risk` = خريطة تصنيف حساسية للعرض فقط (لا تخوّل ولا تُرسَل)، وهي الاستيراد الوحيد المسموح من وحدة الأدوار.
    expect(code(text).replace("@/modules/roles/risk", '')).not.toMatch(/\/roles\b|\/users\b|\/api\/roles|fuel-stations\/(sales|deliveries|supplier-invoices|reconciliations|readings|prices|shifts|corporate|fleet|fuel-cards|avi|settings)|\/payments|\/journal|\/ledger/);
  });

  it.each(sources)('$file never imports the shift write client, intents or drafts', ({ text }) => {
    expect(code(text)).not.toMatch(/from '\.\.\/(write-client|intents|drafts|entry)'/);
  });

  it('no auto-save: saveStaff is called only from explicit handlers, never from an effect', () => {
    for (const { file, text } of sources) {
      for (const effect of code(text).matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[/g)) expect(effect[1], file).not.toMatch(/saveStaff|confirmSave/);
    }
  });

  it('saveStaff is imported by the editor only', () => {
    const importers = sources.filter(({ text }) => /\bsaveStaff\b/.test(code(text))).map(({ file }) => file).sort();
    expect(importers).toEqual([CLIENT, 'staff-editor-screen.tsx']);
  });

  it.each(sources)('$file imports no fixtures/mock data and hard-codes no fuel catalogue, price or station', ({ text }) => {
    expect(code(text)).not.toMatch(/mock-data|demo-product-store|__fixtures__/);
    expect(code(text)).not.toMatch(/diesel|ديزل|بنزين|gasoline|petrol|\b91\b|\b95\b|ULP|Nebras|نبراس|نبراكس/i);
  });

  it('never sends a client-side grant of reserved permissions: the editor never builds `grant_all_fuel` or `template`', () => {
    for (const { file, text } of sources) expect(code(text), file).not.toMatch(/grant_all_fuel\s*:|\btemplate\s*:\s*['"`]/);
  });
});
