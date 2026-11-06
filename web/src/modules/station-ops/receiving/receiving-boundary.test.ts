import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * حدّ مساحة الاستلام (FUEL-B5/B5.1): قراءة بقائمة بيضاء + **كتابات محددة** من `receiving-client.ts` وحده عبر مرسِل واحد:
 * تسجيل قراءة خزان · إنشاء مسودة · اعتماد · تسجيل التكلفة · رفع مرفقات السند (POST) · حذف مرفق مسودة (DELETE وحيد).
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

  it.each(sources)('$file has no PUT/PATCH', ({ text }) => {
    expect(code(text)).not.toMatch(/['"`](PUT|PATCH)['"`]/i);
  });

  it('DELETE exists only in the client, only for an attachment of a draft, through the uuid-validated attachment path', () => {
    for (const { file, text } of sources) expect([...code(text).matchAll(/method: 'DELETE'/g)].length, file).toBe(file === CLIENT ? 1 : 0);
    expect(client()).toMatch(/send\(attachmentPath\(deliveryId, attachmentId\), undefined, \{ \.\.\.options, method: 'DELETE' \}\)/);
  });

  it('the single sender defaults to POST and only the client sets a method', () => {
    expect(client()).toMatch(/method: options\.method \?\? 'POST'/);
    for (const { file, text } of sources) expect([...code(text).matchAll(/['"`]POST['"`]/g)].length, file).toBe(file === CLIENT ? 2 : 0); // النوع + الافتراضي في المرسل
  });

  it('only the client talks to api(), and nobody uses fetch/axios/XHR (downloads go through the central file helpers)', () => {
    for (const { file, text } of sources) {
      expect(/\bapi\s*[<(]/.test(code(text)), file).toBe(file === CLIENT);
      expect(code(text), file).not.toMatch(/\bfetch\s*\(|axios|XMLHttpRequest|sendBeacon/);
    }
  });

  it('the read whitelist is exactly seven endpoints (list, report, one delivery, its document, its attachments, suppliers, readings)', () => {
    const c = client();
    expect([...c.matchAll(/^\s+(?:\/\^\\\/fuel-stations\\\/[^\n]*\$\/|new RegExp\(`\^\/fuel-stations\/deliveries\/\$\{UUID\}[^\n]*\$`\)),$/gm)]).toHaveLength(7);
    expect(c).toContain('delivery-suppliers');
    expect(c).toContain('deliveries\\/report');
    expect(c).toMatch(/api<unknown>\(path, \{ method: options\.method \?\? 'POST'/);
  });

  it('the write paths are fixed in the client: readings, deliveries, uuid-validated approve/cost/attachments (upload + delete)', () => {
    const c = client();
    expect(c).toContain("send('/fuel-stations/readings'");
    expect(c).toContain("send('/fuel-stations/deliveries'");
    expect(c).toMatch(/`\$\{deliveryPath\(id\)\}\/approve`/);
    expect(c).toMatch(/`\$\{deliveryPath\(id\)\}\/cost`/);
    expect(c).toMatch(/`\$\{deliveryPath\(id\)\}\/attachments`/);
    expect([...c.matchAll(/\bsend\(/g)].length).toBe(7); // تعريف + ست كتابات
    expect(c).not.toMatch(/\/reject|\/cancel|\/void|\/edit|\/reopen|\/unapprove|\/revert/);
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

  it('write functions are imported only by their owners (create flow, detail screen, cost card, attachments, wizard upload)', () => {
    const importers = (pattern: RegExp) => sources.filter(({ text }) => pattern.test(code(text))).map(({ file }) => file).sort();
    expect(importers(/import \{[^}]*\bapproveDelivery\b[^}]*\} from '\.\/receiving-client'/)).toEqual(['receiving-detail-screen.tsx']);
    expect(importers(/import \{[^}]*\brecordCost\b[^}]*\} from '\.\/receiving-client'/)).toEqual(['cost-card.tsx']);
    expect(importers(/import \{[^}]*\bdeleteAttachment\b[^}]*\} from '\.\/receiving-client'/)).toEqual(['attachments-panel.tsx']);
    expect(importers(/import \{[^}]*\buploadAttachments\b[^}]*\} from '\.\/receiving-client'/)).toEqual(['attachments-panel.tsx', 'receiving-new-screen.tsx']);
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

  it('the creation flow can never send a cost: no cost key in the create body, the form or the flow (B5.1)', () => {
    for (const file of ['logic.ts', 'create-flow.ts', 'receiving-new-screen.tsx', 'form-draft.ts']) {
      expect(code(sources.find((entry) => entry.file === file)!.text), file).not.toMatch(/received_total_cost_minor|costMinor|parseMoney/);
    }
    const body = client().slice(client().indexOf('export interface DeliveryBody'), client().indexOf('type Options'));
    expect(body).not.toMatch(/cost/);
  });

  it('documents are rendered from the server payload only: nothing in the module computes or defaults a price', () => {
    for (const { file, text } of sources) expect(code(text), file).not.toMatch(/unit_cost|avg_cost|purchase_price|sale_price/);
  });
});
