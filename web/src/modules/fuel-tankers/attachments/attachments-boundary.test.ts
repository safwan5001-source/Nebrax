import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * حدّ PR-5: مرفقات سند التعبئة. نقطة الشبكة الوحيدة `client.ts` ومساراتها قائمة بيضاء حرفية؛ التنزيل والمعاينة عبر مساعدَي `@/lib/api` (ترويسة المصادقة، رابط محلي)
 * لا `fetch` مباشر ولا رابط تخزين عام. دليل فقط: لا مخزون ولا قيد ولا فاتورة ولا تحصيل ولا عمولة ولا تسوية.
 */
const dir = __dirname;
const sources = readdirSync(dir).filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file));
const read = (file: string) => readFileSync(join(dir, file), 'utf8');
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('TANKER-PR5 attachments boundary', () => {
  it('only client.ts touches the network', () => {
    for (const file of sources) {
      const body = code(file);
      if (file !== 'client.ts') expect(body, `${file} must not call api()/downloadFile()/fetchPrivateFileUrl()`).not.toMatch(/\bapi\s*[<(]|\bdownloadFile\s*\(|\bfetchPrivateFileUrl\s*\(/);
      expect(body, `${file} must not use fetch/XMLHttpRequest/axios`).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|axios/);
    }
  });

  it('client.ts reaches exactly the attachment routes of a fill, with UUID-validated ids and no tenant id', () => {
    const src = code('client.ts');
    expect(src).toContain('/fuel-stations/tanker-fills/${assertId(fillId)}/attachments');
    const paths = [...src.matchAll(/(['`])(\/[A-Za-z0-9_\-/${}().]+)\1/g)].map((m) => m[2]);
    for (const path of paths) expect(path).toBe('/fuel-stations/tanker-fills/${assertId(fillId)}/attachments');
    // كل مسار فرعي يمرّ بـassertId.
    for (const m of src.matchAll(/\$\{base\(fillId\)\}\/\$\{([^}]+)\}/g)) expect(m[1]).toMatch(/^assertId\(/);
    expect(src).not.toMatch(/tenant_id|tenantId|branch_id/);
    // لا PUT/PATCH ولا حذف فعلي لغير المرفق: POST للرفع والاستبدال، DELETE لإزالة المرفق بسبب.
    expect([...src.matchAll(/method:\s*'(\w+)'/g)].map((m) => m[1]).sort()).toEqual(['DELETE', 'POST', 'POST']);
  });

  it('the removal request carries only a reason (the server keeps the row and the file)', () => {
    expect(code('client.ts')).toMatch(/body:\s*{\s*reason:\s*reason\.trim\(\)\s*}/);
  });

  it('never leaves the attachments domain (no stock, ledger, invoices, payments, commission, settlement)', () => {
    const forbidden = /(stock|inventory|invoices?|payments?|receipts?|commissions?|settlements?|journal|ledger|zatca|sales)\b/i;
    for (const file of sources) {
      for (const m of code(file).matchAll(/(['`])(\/[A-Za-z0-9_\-/${}.?=&]*)\1/g)) expect(m[2], `${file}: ${m[2]}`).not.toMatch(forbidden);
    }
  });

  it('screens use no browser storage, no inline physical-direction classes and keep touch targets for mobile', () => {
    const physical = /\b(?:ml|mr|pl|pr|left|right|text-left|text-right|border-l|border-r|rounded-l|rounded-r|float-left|float-right)-/;
    for (const file of sources.filter((f) => f.endsWith('.tsx'))) {
      const body = code(file);
      expect(body, `${file} uses browser storage`).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
      const classNames = [...body.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2] ?? '').join(' ');
      expect(classNames, `${file} uses a physical direction class`).not.toMatch(physical);
    }
    expect(code('tanker-fill-attachments.tsx')).toMatch(/capture="environment"/);
    expect(code('tanker-fill-attachments.tsx')).toMatch(/min-h-12/);
  });

  it('the component never reveals a storage path or a public link', () => {
    const body = code('tanker-fill-attachments.tsx');
    expect(body).not.toMatch(/\.path\b|\.disk\b|presigned|https?:\/\//);
    expect(body).toMatch(/URL\.revokeObjectURL/);
  });
});
