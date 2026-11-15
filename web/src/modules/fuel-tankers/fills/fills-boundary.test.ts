import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * حدّ PR-6B-5: مساحة عمل الدمج المخزني. نقطة الشبكة الوحيدة `client.ts` وفيها ست مسارات بيضاء (قراءتان + معاينتان + كتابتان POST)؛ لا PUT/PATCH/DELETE ولا `fetch` مباشر
 * ولا `tenant_id` ولا ساعة عميل ولا كمية/تكلفة/حساب في أي حمولة، ولا إعادة إرسال تلقائية ولا POST من `useEffect` ولا `setInterval`. ولا يصل التطبيق المستقل (جلسة PIN) ولا يستورده.
 */
const dir = __dirname;
const sources = readdirSync(dir).filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.startsWith('__'));
const read = (file: string) => readFileSync(join(dir, file), 'utf8');
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** يستخرج النص داخل أقواس `useEffect( … )` المتوازنة. */
function effectBodies(source: string): string[] {
  const bodies: string[] = [];
  for (const match of source.matchAll(/useEffect\(/g)) {
    let depth = 1;
    let i = (match.index ?? 0) + match[0].length;
    const start = i;
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') depth -= 1;
      i += 1;
    }
    bodies.push(source.slice(start, i));
  }
  return bodies;
}

describe('TANKER-PR6B-5 network boundary', () => {
  it('only client.ts calls api(); nothing uses fetch/XMLHttpRequest/axios', () => {
    for (const file of sources) {
      const body = code(file);
      if (file !== 'client.ts') expect(body, `${file} must not call api()`).not.toMatch(/\bapi\s*[<(]/);
      expect(body, `${file} must not use fetch/XMLHttpRequest/axios`).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|axios/);
    }
  });

  it('client.ts reaches exactly the six whitelisted routes through five api() call sites and one POST', () => {
    const client = code('client.ts');
    expect(client).toContain("const BASE = '/fuel-stations/tanker-fills'");
    expect(client).toContain('const WORKSPACE = `${BASE}/inventory-workspace`');
    expect([...client.matchAll(/\bapi\s*</g)]).toHaveLength(5); // قائمة · تفاصيل · معاينتان · الإرسال المشترك
    const suffixes = [...client.matchAll(/fillPath\(id,\s*'([^']+)'\)/g)].map((m) => m[1]).sort();
    expect(suffixes).toEqual(['inventory', 'inventory-posting', 'inventory-posting/preview', 'inventory-reversal', 'inventory-reversal/preview']);
    // الكتابتان الوحيدتان: POST واحد في الإرسال المشترك، يستدعيه ترحيل وعكس فقط.
    expect([...client.matchAll(/method:\s*'(\w+)'/g)].map((m) => m[1])).toEqual(['POST']);
    expect([...client.matchAll(/\bsubmit\(/g)].length).toBe(3); // التعريف + استدعاءان
    expect(client).not.toMatch(/\bPUT\b|\bPATCH\b|\bDELETE\b/);
  });

  it('every id in a path goes through assertId (UUID only)', () => {
    const client = code('client.ts');
    expect(client).toMatch(/const fillPath = \(id: string, suffix: string\) => `\$\{BASE\}\/\$\{assertId\(id\)\}\/\$\{suffix\}`/);
    expect(client).toMatch(/stationId \? assertId\(query\.stationId\)/);
    expect(client).not.toMatch(/\/\$\{id\}|\/\$\{fillId\}/);
  });

  it('no tenant, branch, client clock, quantity, cost or account in any payload', () => {
    for (const file of ['client.ts', 'logic.ts', 'outcome.ts']) {
      const body = code(file);
      expect(body, file).not.toMatch(/tenant_id|tenantId|branch_id/);
      expect(body, file).not.toMatch(/new Date\(|Date\.now\(/);
    }
    const client = code('client.ts');
    expect(client).toMatch(/interface PostBody \{ reason\?: string; confirm_historical\?: true \}/);
    expect(client).toMatch(/interface ReverseBody \{ reason: string \}/);
    const payloads = code('logic.ts').match(/export function postingPayload[\s\S]*?\n}\n/)?.[0] ?? '';
    expect(payloads).not.toMatch(/quantity|cost|account|amount|date/i);
  });

  it('the two writes are only reachable from the operation dialog, never from a useEffect', () => {
    for (const file of sources.filter((f) => f.endsWith('.tsx'))) {
      const body = code(file);
      if (file !== 'operation-dialog.tsx') expect(body, `${file} must not post or reverse`).not.toMatch(/\bpostInventory\b|\breverseInventory\b/);
      for (const effect of effectBodies(body)) {
        expect(effect, `${file}: a useEffect must not trigger a write`).not.toMatch(/\bpostInventory\b|\breverseInventory\b|\bconfirm\s*\(|\bsubmit\s*\(/);
      }
    }
  });

  it('no polling or automatic resend: no setInterval and no write inside a loop, retry or catch', () => {
    for (const file of sources) {
      const body = code(file);
      expect(body, file).not.toMatch(/setInterval|requestAnimationFrame\(/);
      expect(body, file).not.toMatch(/while\s*\(|for\s*\([^)]*\)\s*{[^}]*(postInventory|reverseInventory)/);
    }
    const dialog = code('operation-dialog.tsx');
    // كل استدعاء كتابة داخل دالة `confirm` وحدها (بقفل useRef)، ولا يوجد استدعاء في `catch` أو `finally`.
    expect([...dialog.matchAll(/\b(?:postInventory|reverseInventory)\(/g)]).toHaveLength(2);
    const confirmBody = dialog.match(/async function confirm\(\)[\s\S]*?\n  }\n/)?.[0] ?? '';
    expect(confirmBody).toContain('lock.current');
    expect(confirmBody).toMatch(/postInventory\(/);
    expect(confirmBody).toMatch(/reverseInventory\(/);
    expect(dialog.match(/async function verify\(\)[\s\S]*?\n  }\n/)?.[0] ?? '').not.toMatch(/postInventory|reverseInventory/);
  });

  it('keeps out of the station PIN app and never imports station-ops', () => {
    for (const file of sources) {
      const body = code(file);
      expect(body, file).not.toMatch(/station-ops|\/fuel-stations\/ops/);
    }
  });

  it('uses no browser storage and only logical (RTL-safe) spacing, with mobile touch targets on actions', () => {
    const physical = /\b(?:ml|mr|pl|pr|left|right|text-left|text-right|border-l|border-r|rounded-l|rounded-r|float-left|float-right)-/;
    for (const file of sources.filter((f) => f.endsWith('.tsx'))) {
      const body = code(file);
      expect(body, file).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
      const classNames = [...body.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2] ?? '').join(' ');
      expect(classNames, `${file} uses a physical direction class`).not.toMatch(physical);
    }
    expect(code('operation-dialog.tsx')).toMatch(/max-md:min-h-11/);
    expect(code('fill-detail-screen.tsx')).toMatch(/max-md:min-h-11/);
  });

  it('every formatter call in the screens receives the UI locale', () => {
    for (const file of ['fills-screen.tsx', 'fill-detail-screen.tsx', 'operation-dialog.tsx']) {
      for (const m of code(file).matchAll(/format(?:Date|DateTime)\(([^)]*)\)/g)) expect(m[1], `${file}: ${m[0]}`).toMatch(/\blocale\b/);
    }
  });
});
