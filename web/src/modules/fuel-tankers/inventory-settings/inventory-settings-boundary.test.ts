import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * حدّ PR-6B-1: بطاقة إعدادات الدمج المخزني **تخزين وتحقق وعرض فقط**. نقطة الشبكة الوحيدة `client.ts`: أربع استدعاءات (ثلاث قراءات + PUT إعدادات الوقود القائم).
 * لا ترحيل ولا خصم ولا قيد ولا فاتورة ولا تحصيل، ولا مسار POST/DELETE، ولا `tenant_id`، ولا تخزين متصفح.
 */
const dir = __dirname;
const sources = readdirSync(dir).filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file));
const read = (file: string) => readFileSync(join(dir, file), 'utf8');
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('TANKER-PR6B-1 inventory settings boundary', () => {
  it('only client.ts calls api(): three GETs on the known routes and one PUT on the existing fuel settings routes', () => {
    for (const file of sources) {
      const body = code(file);
      if (file !== 'client.ts') expect(body, `${file} must not call api()`).not.toMatch(/\bapi\s*[<(]/);
      expect(body, `${file} must not use fetch/XMLHttpRequest/axios`).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|axios/);
    }
    const client = code('client.ts');
    expect([...client.matchAll(/\bapi\s*</g)]).toHaveLength(4);
    expect(client).toContain("const SETTINGS = '/fuel-stations/settings'");
    expect(client).toContain("const STATIONS = '/fuel-stations/stations'");
    expect(client).toContain("const EVALUATION = '/fuel-stations/tanker-fills/inventory-settings'");
    expect(client).toContain("const ACCOUNTS = '/accounts'");
    expect([...client.matchAll(/method\s*:\s*'(\w+)'/g)].map((m) => m[1])).toEqual(['PUT']);
    expect(client).not.toMatch(/\bPOST\b|\bPATCH\b|\bDELETE\b/);
    expect(client).not.toMatch(/tenant_id|tenantId|branch_id/);
  });

  it('no file can post, reverse, deduct or invoice', () => {
    for (const file of sources) {
      const body = code(file);
      expect(body, file).not.toMatch(/method\s*:\s*['"](?:POST|PATCH|DELETE)/);
      expect(body, file).not.toMatch(/\b(?:postFill|approveFill|deduct|executePosting|reverseFill|createInvoice|journalEntry|stockMovement)\b/i);
      expect(body, file).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    }
  });

  it('shows no monetary amount or balance and never creates an account', () => {
    for (const file of sources.filter((f) => f.endsWith('.tsx'))) {
      const body = code(file);
      expect(body, file).not.toMatch(/formatMoney|toRiyal|_minor|balance|createAccount|POST/);
    }
  });

  it('uses only logical (RTL-safe) spacing classes', () => {
    const physical = /\b(?:ml|mr|pl|pr|left|right|text-left|text-right|border-l|border-r|rounded-l|rounded-r|float-left|float-right)-/;
    for (const file of sources.filter((f) => f.endsWith('.tsx'))) {
      const body = code(file);
      const classNames = [...body.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2] ?? '').join(' ');
      expect(classNames, `${file} uses a physical direction class`).not.toMatch(physical);
    }
  });
});
