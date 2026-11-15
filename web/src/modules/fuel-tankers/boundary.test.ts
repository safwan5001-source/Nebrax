import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * حدّ PR-2: واجهة بيانات رئيسية فقط. نقطة الشبكة الوحيدة `client.ts`، ومساراتها قائمة بيضاء حرفية لـPR-1 + قراءة العملاء؛
 * لا تعبئة ولا سند ولا مخزون ولا فاتورة ولا قبض ولا عمولة ولا تسوية، ولا `tenant_id` ولا `partner_id` للملف في أي حمولة.
 */
const dir = __dirname;
const sources = readdirSync(dir).filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file));
const read = (file: string) => readFileSync(join(dir, file), 'utf8');
/** الكود دون التعليقات والسلاسل الوصفية: حتى لا يفشل الاختبار بسبب شرح «لا فاتورة…» في تعليق. */
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('TANKER-PR2 network boundary', () => {
  it('only client.ts touches the network, and only through api()', () => {
    for (const file of sources) {
      const body = code(file);
      if (file === 'client.ts' || file === 'settings-client.ts') continue; // الثاني له قائمة بيضاء خاصة (اختبار PR-3 أدناه).
      if (file === 'use-permissions.ts') {
        // الاستثناء الوحيد المعلن: هوية المستخدم (`/me`) لا بيانات الميزة.
        expect([...body.matchAll(/api\s*<[^>]*>\(\s*'([^']+)'/g)].map((m) => m[1])).toEqual(['/me']);
        continue;
      }
      expect(body, `${file} must not call api() directly`).not.toMatch(/\bapi\s*[<(]/);
      expect(body, `${file} must not use fetch/XMLHttpRequest`).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|axios/);
    }
  });

  it('client.ts reaches exactly the PR-1 master-data routes and the customer lookup', () => {
    const paths = [...code('client.ts').matchAll(/(['`])(\/[A-Za-z0-9_\-/${}.]+)\1/g)].map((m) => m[2]);
    const allowed = new Set([
      '/fuel-stations/tanker-owners', '/fuel-stations/tankers', '/partners',
      '${OWNERS}/${assertId(id)}', '${TANKERS}/${assertId(id)}',
    ]);
    for (const path of paths) {
      expect([...allowed].some((a) => path === a) || /^\/(fuel-stations\/tanker-owners|fuel-stations\/tankers|partners)$/.test(path), `unexpected path ${path}`).toBe(true);
    }
    const src = code('client.ts');
    expect(src).toContain("const OWNERS = '/fuel-stations/tanker-owners'");
    expect(src).toContain("const TANKERS = '/fuel-stations/tankers'");
    // كل مسار مركّب يمرّ بـassertId (UUID فقط).
    for (const m of src.matchAll(/\$\{(?:OWNERS|TANKERS)\}\/\$\{([^}]+)\}/g)) expect(m[1]).toMatch(/^assertId\(/);
  });

  it('settings-client.ts (PR-3) reaches exactly the existing fuel settings, stations and nozzles routes, with no tenant_id and nothing but allowed_operations on a nozzle', () => {
    const src = code('settings-client.ts');
    expect(src).toContain("const SETTINGS = '/fuel-stations/settings'");
    expect(src).toContain("const STATIONS = '/fuel-stations/stations'");
    expect(src).toContain("const NOZZLES = '/fuel-stations/nozzles'");
    const paths = [...src.matchAll(/(['`])(\/[A-Za-z0-9_\-/${}.]+)\1/g)].map((m) => m[2]);
    for (const path of paths) expect(['/fuel-stations/settings', '/fuel-stations/stations', '/fuel-stations/nozzles', '${STATIONS}/${assertId(stationId)}/settings', '${NOZZLES}/${assertId(id)}']).toContain(path);
    expect(src).not.toMatch(/tenant_id|tenantId|\bDELETE\b|\bPOST\b/);
    // الفوهة: جسم الطلب الوحيد `allowed_operations`.
    expect(src).toMatch(/body:\s*{\s*allowed_operations:\s*allowed\s*}/);
    expect([...src.matchAll(/method:\s*'PUT'/g)]).toHaveLength(2);
  });

  it('the module never reaches out of scope domains (fills, vouchers, stock, invoices, payments, commission, settlement)', () => {
    const forbidden = /(fills?|vouchers?|delivery-notes?|stock|inventory|invoices?|payments?|receipts?|commissions?|settlements?|journal|ledger|zatca|sales)\b/i;
    for (const file of sources) {
      const urls = [...code(file).matchAll(/(['`])(\/[A-Za-z0-9_\-/${}.?=&]*)\1/g)].map((m) => m[2]);
      for (const url of urls) expect(url, `${file}: ${url}`).not.toMatch(forbidden);
    }
    expect(code('client.ts')).not.toMatch(/\bDELETE\b/);
  });

  it('no payload builder or client call names a tenant or a partner on the owner profile', () => {
    for (const file of ['client.ts', 'form-logic.ts']) {
      expect(code(file), file).not.toMatch(/tenant_id|tenantId/);
    }
    // الوحيد في المنطق: ربط الشركة بالطرف المختار من القائمة (حمولة الربط)، لا حقل في ملف صاحب الصهريج.
    expect([...code('form-logic.ts').matchAll(/partner_id/g)]).toHaveLength(1);
    expect(code('form-logic.ts')).toMatch(/partner_id:\s*form\.partnerId/);
    const types = code('client.ts');
    expect(types).toMatch(/OwnerPayload\s*{[^}]*}/);
    expect(types.match(/OwnerPayload\s*{([^}]*)}/)?.[1]).not.toMatch(/partner_id/);
  });

  it('no client clock enters a payload (dates come from the user or the server default)', () => {
    for (const file of ['client.ts', 'form-logic.ts']) {
      const body = code(file).replace(/export function localToday[\s\S]*?\n}\n/, '');
      expect(body, file).not.toMatch(/new Date\(|Date\.now\(/);
    }
  });

  it('screens are plain (no direct storage, no window.fetch) and use logical (RTL-safe) spacing only', () => {
    const physical = /\b(?:ml|mr|pl|pr|left|right|text-left|text-right|border-l|border-r|rounded-l|rounded-r|float-left|float-right)-/;
    for (const file of sources.filter((f) => f.endsWith('.tsx'))) {
      const body = code(file);
      expect(body, `${file} uses browser storage`).not.toMatch(/localStorage|sessionStorage/);
      const classNames = [...body.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2] ?? '').join(' ');
      expect(classNames, `${file} uses a physical direction class`).not.toMatch(physical);
    }
  });
});
