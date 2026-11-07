import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * حدّ مساحة «مستويات الخزانات» (FUEL-B6): قراءة بقائمة بيضاء من أربعة مسارات + **كتابتان فقط من `actions-client.ts` وحده**: قرار طلب قراءة متأخرة (POST
 * بمسارين ثابتين approve/reject) وسياسة التأريخ الرجعي للمحطة (PUT واحد لإعدادات المحطة). تسجيل القراءة نفسها (وطلب القراءة المتأخرة) يمرّ حصراً عبر `recordReading`
 * القائم في `../receiving/receiving-client` (الكاتب الوحيد لـ`POST /fuel-stations/readings` في التطبيق) ويستعمله نموذج التسجيل وحده — فلا نظام قراءات موازٍ.
 * لا يُضعف هذا الحارس حدّ `write-boundary.test.ts` ولا `receiving-boundary.test.ts` ولا `admin/`.
 */
const dir = fileURLToPath(new URL('.', import.meta.url));
const sources = readdirSync(dir)
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.startsWith('__'))
  .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
const CLIENT = 'levels-client.ts';
const ACTIONS = 'actions-client.ts';

describe('tank levels writes only through the shared reading writer and the one actions client', () => {
  it('has sources to scan', () => expect(sources.length).toBeGreaterThan(8));

  it.each(sources)('$file has no PATCH/DELETE, and POST/PUT only in the actions client', ({ file, text }) => {
    expect(code(text)).not.toMatch(/['"`](PATCH|DELETE)['"`]/i);
    if (file !== ACTIONS) {
      expect(code(text)).not.toMatch(/['"`](POST|PUT)['"`]/i);
      expect(code(text)).not.toMatch(/method\s*:\s*['"`](?!GET)/i);
    }
  });

  it('the actions client sends exactly one decision POST and one policy PUT, to uuid-validated fixed paths', () => {
    const client = code(sources.find((entry) => entry.file === ACTIONS)!.text);
    expect([...client.matchAll(/send\((?:[^()]|\([^()]*\))+, 'POST'/g)]).toHaveLength(1);
    expect([...client.matchAll(/send\((?:[^()]|\([^()]*\))+, 'PUT'/g)]).toHaveLength(1);
    expect(client).toContain('/fuel-stations/reading-requests/${id}/${decision}');
    expect(client).toContain('/fuel-stations/stations/${stationId}/settings');
    expect(client).toMatch(/UUID\.test\(id\)/);
    expect(client).toMatch(/UUID\.test\(stationId\)/);
    // لا مسار آخر ولا أي مفتاح غير مفاتيح السياسة الثلاثة في جسم الإعدادات
    expect(client).not.toMatch(/\/reconciliations|\/deliveries|\/sales|\/payments|\/staff|\/prices|\/shifts/);
    for (const key of ['tank_reading_backdating_policy', 'tank_reading_backdating_max_hours', 'tank_reading_backdating_reason_required']) expect(client).toContain(key);
  });

  it('only the levels client and the actions client talk to api(), and nobody uses fetch/axios/XHR', () => {
    for (const { file, text } of sources) {
      expect(/\bapi\s*[<(]/.test(code(text)), file).toBe(file === CLIENT || file === ACTIONS);
      expect(code(text), file).not.toMatch(/\bfetch\s*\(|axios|XMLHttpRequest|sendBeacon/);
    }
  });

  it('the read whitelist is exactly the monitor, the reading log, the late-request list and the station settings', () => {
    const client = code(sources.find((entry) => entry.file === CLIENT)!.text);
    expect([...client.matchAll(/^const READ_PATHS: RegExp\[\] = \[/gm)]).toHaveLength(1);
    expect([...client.matchAll(/^\s+\/\^\\\/fuel-stations\\\/[^\n]*\$\/,$/gm)]).toHaveLength(4);
    for (const fragment of ['tank-levels', 'readings', 'reading-requests', 'settings']) expect(client).toContain(fragment);
  });

  it('writes a reading only through the shared recordReading, imported by the record form alone', () => {
    const importers = sources.filter(({ text }) => /import \{[^}]*\brecordReading\b[^}]*\} from '\.\.\/receiving\/receiving-client'/.test(code(text))).map(({ file }) => file);
    expect(importers).toEqual(['record-form.tsx']);
  });

  it('request decisions and policy saves are started only from their owners (requests screen, policy screen)', () => {
    const importers = (name: string) => sources.filter(({ text }) => new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '\\./actions-client'`).test(code(text))).map(({ file }) => file);
    expect(importers('decideRequest')).toEqual(['requests-screen.tsx']);
    expect(importers('saveBackdatingPolicy')).toEqual(['policy-screen.tsx']);
  });

  it.each(sources)('$file reaches no financial, stock, sales, reconciliation or other module endpoints', ({ text }) => {
    expect(code(text)).not.toMatch(/\/reconciliations|\/deliveries|\/supplier-invoices|\/sales|\/payments|\/journal|\/ledger|\/stock|\/products\b|\/warehouses|\/partners|\/roles\b|\/users\b|fuel-stations\/(shifts|prices|staff)/);
  });

  it.each(sources)('$file never imports the shift write client, draft stores or the shift entry logic', ({ text }) => {
    expect(code(text)).not.toMatch(/from '\.\.\/(write-client|drafts|entry)'/);
  });

  // وقت القياس لا يُرسَل أبداً تلقائياً: الاستثناء الوحيد إدخال المستخدم الصريح لقراءة متأخرة في نموذج التسجيل (`measured_at: lateIso` من وقت اختاره بنفسه).
  it.each(sources)('$file never sends a client clock — only the explicit user-chosen late time, from the record form', ({ file, text }) => {
    if (file === 'schemas.ts') return; // يصف حقول الاستجابة فقط
    const matches = [...code(text).matchAll(/measured_at\s*:[^,}]*/g)].map((m) => m[0].replace(/\s+/g, ' ').trim());
    if (file === 'record-form.tsx') expect(matches).toEqual(['measured_at: lateIso']);
    else expect(matches).toEqual([]);
    expect(code(text)).not.toMatch(/recorded_at\s*:/);
    // لا ساعة جهاز في بناء الحمولة: Date.now/new Date تُستعمل للتقييم الإرشادي فقط (logic.ts) لا في النماذج التي ترسل
    if (file === 'record-form.tsx') expect(code(text).replace(/evaluateLateTime\([^)]*Date\.now\(\)\)/, '')).not.toMatch(/new Date\(|Date\.now\(/);
  });

  it.each(sources)('$file hard-codes no fuel catalogue, price or station', ({ text }) => {
    const c = code(text);
    expect(c).not.toMatch(/diesel|ديزل|بنزين|gasoline|petrol|\b91\b|\b95\b|ULP|Nebras|نبراس|نبراكس/i);
    expect(c).not.toMatch(/mock-data|demo-product-store|__fixtures__/);
  });

  it('a write never starts from an effect (no auto-save, no auto-resend, no auto-decide)', () => {
    for (const { file, text } of sources) {
      for (const effect of code(text).matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[/g)) expect(effect[1], file).not.toMatch(/recordReading|decideRequest|saveBackdatingPolicy|submit\(|check\(|decide\(/);
    }
  });

  it('keeps the review-before-save step and the single-flight lock in the record form, the decision dialog and the policy editor', () => {
    const form = code(sources.find((entry) => entry.file === 'record-form.tsx')!.text);
    expect(form).toContain("setPhase('review')");
    expect(form).toMatch(/if \(sending\.current \|\|/);
    expect(form).toContain('intents.markUncertain(INTENT)');
    expect(code(sources.find((entry) => entry.file === 'requests-screen.tsx')!.text)).toMatch(/if \(sending\.current \|\| dialog === null\) return;/);
    expect(code(sources.find((entry) => entry.file === 'policy-screen.tsx')!.text)).toMatch(/if \(sending\.current \|\| dialog === null\) return;/);
  });
});
