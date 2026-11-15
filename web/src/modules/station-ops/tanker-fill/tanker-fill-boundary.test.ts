import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import { KNOWN_REASONS } from './logic';

/**
 * حدّ TANKER-PR7 لتطبيق المحطات: قراءة بقائمة بيضاء من أربعة مسارات + **كتابة واحدة** (`POST fuel-stations/tanker-fills`) من `client.ts` وحده؛ لا إلغاء ولا ترحيل ولا عكس ولا مرفوقات ولا تقارير
 * ولا PUT/PATCH/DELETE ولا `tenant_id` ولا ساعة عميل ولا مبالغ، ولا استطلاع، ولا كتابة من `useEffect`، ولا إعادة إرسال تلقائية. ويتطابق مع قائمة جلسة PIN في الخادم (`StationSessionBoundary`).
 */
const dir = fileURLToPath(new URL('.', import.meta.url));
const sources = readdirSync(dir)
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.startsWith('__'))
  .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
const CLIENT = 'client.ts';
const clientCode = () => code(sources.find((s) => s.file === CLIENT)!.text);
const source = (file: string) => code(sources.find((s) => s.file === file)!.text);

function effectBodies(text: string): string[] {
  const bodies: string[] = [];
  for (const match of text.matchAll(/useEffect\(/g)) {
    let depth = 1;
    let i = (match.index ?? 0) + match[0].length;
    const start = i;
    while (i < text.length && depth > 0) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') depth -= 1;
      i += 1;
    }
    bodies.push(text.slice(start, i));
  }
  return bodies;
}

describe('tanker-fill network boundary', () => {
  it('has sources to scan', () => expect(sources.length).toBeGreaterThan(8));

  it('only client.ts calls api(); nobody uses fetch/axios/XHR', () => {
    for (const { file, text } of sources) {
      expect(/\bapi\s*[<(]/.test(code(text)), file).toBe(file === CLIENT);
      expect(code(text), file).not.toMatch(/\bfetch\s*\(|axios|XMLHttpRequest|sendBeacon/);
    }
  });

  it('no PUT/PATCH/DELETE anywhere, and exactly one POST (the sender) in the client', () => {
    for (const { file, text } of sources) expect(code(text), file).not.toMatch(/['"`](PUT|PATCH|DELETE)['"`]/i);
    for (const { file, text } of sources) expect([...code(text).matchAll(/method\s*:\s*['"`]POST['"`]/g)].length, file).toBe(file === CLIENT ? 1 : 0);
    expect(clientCode()).toContain("const WRITE_PATH = '/fuel-stations/tanker-fills'");
    expect([...clientCode().matchAll(/\bapi\s*</g)]).toHaveLength(2); // قراءة مشتركة + الكتابة الوحيدة
  });

  it('the read whitelist is exactly four paths', () => {
    const c = clientCode();
    const block = c.slice(c.indexOf('const READ_PATHS'), c.indexOf('];', c.indexOf('const READ_PATHS')));
    expect([...block.matchAll(/^\s+(?:\/\^|new RegExp)/gm)]).toHaveLength(4);
    for (const fragment of ['tanker-owners$', 'tankers$', 'tanker-fills$', 'tanker-fills/${UUID}$']) expect(block).toContain(fragment);
  });

  it('never reaches posting, reversal, void, inventory review, attachments, reports, owner profile or company links', () => {
    for (const { file, text } of sources) {
      expect(code(text), file).not.toMatch(/fuel-stations\/[^'"`\s]*(void|inventory|attachments|company-links|tanker-fill-reports|reverse|posting)/);
    }
  });

  it('never sends tenant/branch in a body, a client clock, an amount or derived assets', () => {
    expect(source('logic.ts')).not.toMatch(/tenant_id|branch_id|recorded_at|measured_at|Date\.now|new Date\(|price|amount|cost|fuel_product_id|fuel_tank_id|fuel_pump_id/);
    expect(clientCode()).not.toMatch(/tenant_id|Date\.now|new Date\(/);
    for (const { file, text } of sources) expect(code(text), file).not.toMatch(/\btenant_id\b/);
  });

  it('has no polling and no timers other than the abort timeout and the search debounce', () => {
    for (const { file, text } of sources) expect(code(text), file).not.toMatch(/setInterval|requestAnimationFrame/);
    for (const { file, text } of sources.filter((s) => s.file !== CLIENT && s.file !== 'new-screen.tsx')) expect(code(text), file).not.toMatch(/setTimeout/);
  });

  it('never writes from an effect and never resends on its own: recordFill is only called in submit and the explicit resend', () => {
    for (const { file, text } of sources) for (const body of effectBodies(code(text))) expect(body, file).not.toMatch(/recordFill|submit\(|resendPending|checkPending/);
    const screen = source('new-screen.tsx');
    expect([...screen.matchAll(/\brecordFill\(/g)]).toHaveLength(2);
    expect(screen).toMatch(/const resendPending = useCallback/);
    for (const m of screen.matchAll(/resendPending/g)) {
      const context = screen.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 40);
      expect(context).toMatch(/const resendPending|onClick=\{\(\) => void resendPending\(\)\}/);
    }
    expect(screen).not.toMatch(/retry\(|setInterval|while\s*\(/);
  });

  it('shows the no-stock-deduction notice on the review, success, list and detail screens', () => {
    for (const file of ['new-screen.tsx', 'list-screen.tsx', 'detail-screen.tsx']) expect(source(file), file).toContain('<NoStockNote />');
  });

  it('never imports the ERP tanker module except the reusable attachments component in the detail screen', () => {
    for (const { file, text } of sources) {
      const imports = [...code(text).matchAll(/from '(@\/modules\/fuel-tankers[^']*)'/g)].map((m) => m[1]);
      expect(imports, file).toEqual(file === 'detail-screen.tsx' ? ['@/modules/fuel-tankers/attachments/tanker-fill-attachments'] : []);
    }
  });
});

describe('parity with the server-side PIN session whitelist (StationSessionBoundary.php)', () => {
  const php = readFileSync(resolve(dir, '../../../../../app/Support/StationSessionBoundary.php'), 'utf8');
  const toJs = (raw: string) => new RegExp(raw.replace(/\\\\/g, '\\').slice(1, -1));
  const block = (name: string) => php.slice(php.indexOf(`const ${name} = [`), php.indexOf('];', php.indexOf(`const ${name} = [`)));
  const readRules = [...block('READ_RULES').matchAll(/'(#[^']+#)'/g)].map((m) => toJs(m[1]));
  const writeRules = [...block('WRITE_RULES').matchAll(/\['(POST|PUT|PATCH|DELETE)', '(#[^']+#)'\]/g)].map((m) => ({ method: m[1], pattern: toJs(m[2]) }));

  it('the server allows exactly four tanker reads and one tanker write', () => {
    expect(readRules).toHaveLength(4);
    expect(writeRules.filter((r) => r.pattern.source.includes('tanker'))).toEqual([{ method: 'POST', pattern: expect.any(RegExp) }]);
    expect(writeRules.filter((r) => r.pattern.source.includes('tanker'))[0].pattern.test('api/fuel-stations/tanker-fills')).toBe(true);
  });

  it('every read path of the client is allowed by a server rule, as a registered URI', () => {
    const uris = ['api/fuel-stations/tanker-owners', 'api/fuel-stations/tankers', 'api/fuel-stations/tanker-fills', 'api/fuel-stations/tanker-fills/{id}'];
    for (const uri of uris) expect(readRules.some((rule) => rule.test(uri)), uri).toBe(true);
    // وعكسياً: لا قاعدة قراءة خادمية تسمح بما لا يستعمله العميل (أقل امتياز).
    for (const rule of readRules) expect(uris.some((uri) => rule.test(uri)), String(rule)).toBe(true);
  });

  it('the server keeps every dangerous tanker route outside the whitelist', () => {
    for (const uri of [
      'api/fuel-stations/tanker-fills/{id}/void', 'api/fuel-stations/tanker-fills/{id}/inventory-posting', 'api/fuel-stations/tanker-fills/{id}/inventory-reversal', 'api/fuel-stations/tanker-fills/inventory-review',
      'api/fuel-stations/tanker-fills/{id}/attachments', 'api/fuel-stations/tanker-fills/{id}/attachments/{attachmentId}/download', 'api/fuel-stations/tanker-fill-reports/{key}', 'api/fuel-stations/tanker-owners/{id}',
    ]) {
      expect(readRules.some((rule) => rule.test(uri)), uri).toBe(false);
      expect(writeRules.some((rule) => rule.pattern.test(uri)), uri).toBe(false);
    }
  });
});

describe('tankerFill messages', () => {
  type Tree = { [key: string]: string | Tree };
  const flat = (tree: Tree, prefix = ''): Record<string, string> => Object.entries(tree).reduce<Record<string, string>>((acc, [k, v]) => (typeof v === 'string' ? { ...acc, [`${prefix}${k}`]: v } : { ...acc, ...flat(v, `${prefix}${k}.`) }), {});
  const arFlat = flat((ar as unknown as { stationOps: { tankerFill: Tree } }).stationOps.tankerFill);
  const enFlat = flat((en as unknown as { stationOps: { tankerFill: Tree } }).stationOps.tankerFill);
  const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

  it('has identical keys and ICU parameters in Arabic and English, and no empty text', () => {
    expect(Object.keys(arFlat).sort()).toEqual(Object.keys(enFlat).sort());
    for (const key of Object.keys(arFlat)) { expect(params(arFlat[key]), key).toBe(params(enFlat[key])); expect(arFlat[key].trim(), key).not.toBe(''); expect(enFlat[key].trim(), key).not.toBe(''); }
  });

  it('covers every dynamic key the screens build', () => {
    const need = [
      ...KNOWN_REASONS.map((r) => `reject.${r}`), ...['unauthorized', 'forbidden', 'not_found', 'conflict', 'rate_limited', 'validation'].map((r) => `reject.${r}`),
      ...['timeout', 'network', 'server'].map((r) => `unknown.${r}`), ...['offline', 'demo'].map((r) => `notSent.${r}`), 'unverified',
      ...['station_inactive', 'nozzle_inactive', 'pump_missing', 'pump_inactive', 'tank_missing', 'tank_inactive', 'product_missing', 'product_inactive', 'product_tank_mismatch', 'operation_not_allowed'].map((r) => `nozzle.blocked.${r}`),
      ...['owner_required', 'tanker_required', 'nozzle_required', 'nozzle_not_eligible', 'capacity_blocked', 'capacity_confirmation_required'].map((r) => `problem.${r}`),
      ...['empty', 'invalid', 'negative', 'zero', 'too_many_decimals', 'too_large'].map((r) => `problem.quantity_${r}`), ...['empty', 'too_long'].map((r) => `problem.voucher_${r}`),
      ...['pending_integration', 'posted', 'reversed', 'other', 'voided'].map((r) => `status.${r}`), ...['label', 'owner', 'nozzle', 'quantity', 'review'].map((r) => `steps.${r}`),
    ];
    for (const key of need) { expect(arFlat[key], `ar ${key}`).toBeTruthy(); expect(enFlat[key], `en ${key}`).toBeTruthy(); }
  });

  it('states plainly that recording does not deduct stock and stays awaiting integration', () => {
    expect(arFlat.noStockNote).toMatch(/لا يخصم/);
    expect(arFlat.noStockNote).toMatch(/بانتظار الدمج المخزني/);
    expect(enFlat.noStockNote).toMatch(/does not deduct/i);
    expect(enFlat.noStockNote).toMatch(/Awaiting stock integration/);
    expect(arFlat['status.pending_integration']).toBe('بانتظار الدمج المخزني');
  });

  it('is honest about what is not available: attachments are not enabled for PIN sessions', () => {
    expect(arFlat['attachments.pinNote']).toMatch(/غير مفعّل/);
    expect(enFlat['attachments.pinNote']).toMatch(/not enabled/i);
  });
});
