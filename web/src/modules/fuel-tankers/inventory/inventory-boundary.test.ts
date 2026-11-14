import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * حدّ PR-6A: شاشة مراجعة الدمج المخزني **قراءة فقط**. نقطة الشبكة الوحيدة `client.ts` وفيها GET واحد على مسار المراجعة؛ لا POST/PUT/PATCH/DELETE ولا ترحيل ولا خصم ولا تخزين متصفح
 * ولا ساعة عميل. (القرار: «لا خصم الآن» — أي كتابة هنا خرقٌ للقرار.)
 */
const dir = __dirname;
const sources = readdirSync(dir).filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file));
const read = (file: string) => readFileSync(join(dir, file), 'utf8');
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('TANKER-PR6A inventory review boundary', () => {
  it('only client.ts calls api(), exactly twice, as plain GETs on the review and reconciliation routes', () => {
    for (const file of sources) {
      const body = code(file);
      if (file !== 'client.ts') expect(body, `${file} must not call api()`).not.toMatch(/\bapi\s*[<(]/);
      expect(body, `${file} must not use fetch/XMLHttpRequest/axios`).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|axios/);
    }
    const client = code('client.ts');
    expect([...client.matchAll(/\bapi\s*</g)]).toHaveLength(2);
    expect(client).toContain("const REVIEW = '/fuel-stations/tanker-fills/inventory-review'");
    expect(client).toContain("const RECONCILIATION = '/fuel-stations/tanker-fills/inventory-review/reconciliation'");
    expect(client).not.toMatch(/method\s*:|\bPOST\b|\bPUT\b|\bPATCH\b|\bDELETE\b|body\s*:/);
    expect(client).not.toMatch(/tenant_id|tenantId|branch_id/);
  });

  it('no module file can write: no mutation verbs, no posting/approval/deduction wording in code', () => {
    for (const file of sources) {
      const body = code(file);
      expect(body, file).not.toMatch(/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/);
      expect(body, file).not.toMatch(/\b(?:postFill|approveFill|deduct|executePosting|reverseFill)\b/i);
    }
  });

  it('the reconciliation panel is display-only: no button, form, write verb or adjustment wording', () => {
    const panel = code('reconciliation-panel.tsx');
    expect(panel).not.toMatch(/<Button\b|<form\b|type="submit"|onClick/);
    expect(panel).not.toMatch(/\b(?:settle|adjust|correct|repost|fix)\w*\(/i);
  });

  it('the screen renders no write action (only pagination and retry buttons)', () => {
    const screen = code('inventory-review-screen.tsx');
    const buttons = [...screen.matchAll(/<Button\b[^>]*>([\s\S]*?)<\/Button>/g)].map((m) => m[1]);
    for (const label of buttons) expect(label).toMatch(/t\('(previous|next)'\)/);
    expect(screen).not.toMatch(/<form\b|type="submit"/);
  });

  it('uses no browser storage and only logical (RTL-safe) spacing', () => {
    const physical = /\b(?:ml|mr|pl|pr|left|right|text-left|text-right|border-l|border-r|rounded-l|rounded-r|float-left|float-right)-/;
    for (const file of sources.filter((f) => f.endsWith('.tsx'))) {
      const body = code(file);
      expect(body, file).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
      const classNames = [...body.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2] ?? '').join(' ');
      expect(classNames, `${file} uses a physical direction class`).not.toMatch(physical);
    }
  });
});
