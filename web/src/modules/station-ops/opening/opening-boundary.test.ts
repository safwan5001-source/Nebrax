import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';

/**
 * حدّ معالج الرصيد الافتتاحي (PR-2): قراءة بقائمة بيضاء + **أربع كتابات** من `opening-client.ts` وحده عبر مرسِل واحد
 * (إنشاء مسودة · استبدال مسودة · ترحيل · حفظ حساب الأرصدة الافتتاحية). لا يُضعف حدود `write-boundary.test.ts` ولا `receiving/` ولا `admin/`.
 */
const dir = fileURLToPath(new URL('.', import.meta.url));
const sources = readdirSync(dir)
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.startsWith('__'))
  .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
const CLIENT = 'opening-client.ts';
const client = () => code(sources.find((entry) => entry.file === CLIENT)!.text);

describe('opening wizard writes only through opening-client.ts', () => {
  it('has sources to scan', () => expect(sources.length).toBeGreaterThan(6));

  it.each(sources)('$file has no PATCH/DELETE, no fetch/axios/XHR', ({ text }) => {
    expect(code(text)).not.toMatch(/['"`](PATCH|DELETE)['"`]/i);
    expect(code(text)).not.toMatch(/\bfetch\s*\(|axios|XMLHttpRequest|sendBeacon/);
  });

  it('only the client talks to api() and only it names a method', () => {
    for (const { file, text } of sources) {
      expect(/\bapi\s*[<(]/.test(code(text)), file).toBe(file === CLIENT);
      if (file !== CLIENT) expect(code(text), file).not.toMatch(/['"`](POST|PUT)['"`]|method\s*:/);
    }
  });

  it('the single sender is the only call site of send(); exactly four writes use it', () => {
    const c = client();
    expect([...c.matchAll(/\bsend\(/g)].length).toBe(5); // تعريف + أربع كتابات
    expect(c).toContain("send('/fuel-stations/opening-balances', 'POST'");
    expect(c).toMatch(/send\(docPath\(id\), 'PUT'/);
    expect(c).toMatch(/send\(`\$\{docPath\(id\)\}\/post`, 'POST'/);
    expect(c).toMatch(/send\(path, 'PUT', \{ fuel_opening_balance_account_id: accountId, reason: 'fuel_opening_balance_wizard' \}/);
  });

  it('the read whitelist is exactly six endpoints', () => {
    const block = client().slice(client().indexOf('const READ_PATHS'), client().indexOf('];', client().indexOf('const READ_PATHS')));
    expect([...block.matchAll(/^\s+(?:\/\^|new RegExp)/gm)]).toHaveLength(6);
  });

  it('the only setting key the wizard can write is the opening balance account', () => {
    expect(client()).not.toMatch(/PUT[^\n]*fuel_distinct_approver_required|fuel_distinct_approver_required:/); // سياسة الحوكمة تُقرأ فقط
    for (const { file, text } of sources) {
      const keys = [...code(text).matchAll(/['"`]?\b(fuel_[a-z_]*account_id|[a-z_]+_account_id|shift_[a-z_]+|fuel_price_tax_mode|fuel_distinct_approver_required)\b/g)].map((m) => m[1]);
      // القراءة وحدها: سياسة فصل المعتمِد تُقرأ في schemas.ts والعميل (لا تُكتب أبداً — مفتاح حوكمة).
      const allowed = ['schemas.ts', 'opening-client.ts'].includes(file) ? ['fuel_opening_balance_account_id', 'fuel_distinct_approver_required'] : ['fuel_opening_balance_account_id'];
      for (const key of keys) expect(allowed, `${file}:${key}`).toContain(key);
    }
  });

  it.each(sources)('$file reaches no unrelated endpoint (no shifts, sales, prices, deliveries, journals, staff)', ({ text }) => {
    expect(code(text)).not.toMatch(/fuel-stations\/(shifts|sales|prices|deliveries|supplier-invoices|reconciliations|readings|corporate|fleet|fuel-cards|avi|staff|stock-counts|corrections)|\/journal|\/ledger|\/payments|\/users\b|\/roles\b/);
  });

  it('never sends a client clock, a hard-coded fuel catalogue, account number or cost', () => {
    for (const { file, text } of sources) {
      const c = code(text);
      expect(c, file).not.toMatch(/diesel|ديزل|بنزين|gasoline|petrol|\b91\b|\b95\b|ULP|Nebras|نبراس|نبراكس/i);
      expect(c, file).not.toMatch(/__fixtures__|mock-data/);
      expect(c, file).not.toMatch(/['"`]3130['"`]|['"`]1140['"`]|code === ['"`]\d{4}['"`]/);
      // schemas.ts يصف حقول **الاستجابة** فقط؛ لا يكتب شيئاً.
      if (file !== 'schemas.ts') expect(c, file).not.toMatch(/\bposted_at\s*:|\bmeasured_at\s*:/);
    }
  });

  it('writes are never started from an effect (no auto-save, no auto-post)', () => {
    for (const { file, text } of sources) {
      for (const effect of code(text).matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[/g)) expect(effect[1], file).not.toMatch(/runSave|runPost|postOpening|createOpeningDraft|updateOpeningDraft|saveOpeningAccount/);
    }
  });

  it('write functions are imported only by the wizard screen', () => {
    const importers = sources.filter(({ text }) => /import \{[^}]*\b(postOpening|createOpeningDraft|updateOpeningDraft|saveOpeningAccount)\b[^}]*\} from '\.\/opening-client'/.test(code(text))).map(({ file }) => file);
    expect(importers).toEqual(['opening-wizard-screen.tsx']);
  });

  it('there is no way to approve twice: the approve button is locked while posting, after an unconfirmed result, and without a ready preview', () => {
    const screen = code(sources.find((entry) => entry.file === 'opening-wizard-screen.tsx')!.text);
    expect(screen).toMatch(/const canApprove = access\.post && !creatorBlocked && !!previewData\?\.ready && !postUnsure && !busy && !!doc/);
    expect(screen).toMatch(/if \(inFlight\.current \|\| !doc \|\| postUnsure\) return/);
    expect(screen).toMatch(/if \(failed\.kind === 'unknown' \|\| failed\.kind === 'unverified'\) setPostUnsure\(true\)/);
  });

  it('keeps the module out of the shift write client, drafts and intents of shifts', () => {
    for (const { file, text } of sources) expect(code(text), file).not.toMatch(/from '\.\.\/(write-client|drafts|entry)'/);
  });
});

describe('opening wizard copy', () => {
  type Tree = { [key: string]: string | Tree };
  const flatten = (tree: Tree, prefix = ''): string[] => Object.entries(tree).flatMap(([key, value]) => (typeof value === 'string' ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`)));
  const arKeys = flatten((ar as unknown as { stationOpsOpening: Tree }).stationOpsOpening).sort();
  const enKeys = flatten((en as unknown as { stationOpsOpening: Tree }).stationOpsOpening).sort();

  it('Arabic and English define exactly the same keys', () => {
    expect(arKeys).toEqual(enKeys);
    expect(arKeys.length).toBeGreaterThan(100);
  });

  it('every literal t("…") key used by the module exists', () => {
    const used = new Set<string>();
    for (const { text } of sources) for (const match of code(text).matchAll(/\bt\(\s*'([\w.]+)'/g)) used.add(match[1]);
    const known = new Set(arKeys);
    expect([...used].filter((key) => !known.has(key)).sort()).toEqual([]);
    expect(used.size).toBeGreaterThan(40);
  });

  it('every dynamic key family is fully defined (failures, blockers, issues, steps)', () => {
    const known = new Set(arKeys);
    const families: Array<[string, readonly string[]]> = [
      ['steps', ['tanks', 'cost', 'review']],
      ['tanks.issue', ['invalid', 'zero', 'exceeds_capacity', 'tank_inactive']],
      ['cost.issue', ['invalid', 'zero_needs_approval', 'required']],
      ['cost.account', ['source_station', 'source_org', 'source_none']],
      ['review', ['debit', 'credit']],
      ['fail', ['blocked', 'date_future', 'date_invalid', 'lines_invalid', 'quantity_invalid', 'cost_invalid', 'cost_authority', 'idempotency_conflict', 'not_draft', 'account_required', 'account_invalid', 'distinct_approver', 'period_locked', 'station_outside_scope', 'mismatch', 'unauthorized', 'forbidden', 'not_found', 'conflict', 'rate_limited', 'validation', 'unverified', 'unknown_timeout', 'unknown_network', 'unknown_server', 'not_sent_offline', 'not_sent_demo', 'checkedPosted', 'checkedDraft', 'checkedSaved', 'checkedNotSaved']],
      ['blocker', ['FUEL_OPENING_ACCOUNT_REQUIRED', 'FUEL_OPENING_INVENTORY_ACCOUNT_INVALID', 'FUEL_OPENING_POOL_NOT_EMPTY', 'FUEL_OPENING_POOL_HAS_HISTORY', 'FUEL_OPENING_COST_MISSING', 'FUEL_OPENING_ZERO_COST_NOT_ALLOWED', 'FUEL_OPENING_EXCEEDS_CAPACITY', 'FUEL_OPENING_TANK_INACTIVE', 'FUEL_OPENING_TANK_INVALID', 'FUEL_OPENING_TANK_PRODUCT_CHANGED', 'FUEL_OPENING_PRODUCT_UNAVAILABLE', 'FUEL_OPENING_PRODUCT_UNIT_INVALID', 'FUEL_OPENING_VALUE_INVALID', 'FUEL_OPENING_STATION_UNAVAILABLE', 'FUEL_OPENING_STATION_CHANGED', 'FUEL_OPENING_WAREHOUSE_UNAVAILABLE', 'FUEL_OPENING_NO_LINES', 'FUEL_OPENING_ABOVE_SAFE_CAPACITY']],
    ];
    const missing = families.flatMap(([prefix, names]) => names.map((name) => `${prefix}.${name}`)).filter((key) => !known.has(key));
    expect(missing).toEqual([]);
  });

  it('every server rejection code the client can emit has copy', () => {
    const codes = [...client().matchAll(/\[\/[^\]]*?\/, '(\w+)'\]/g)].map((m) => m[1]);
    const known = new Set(arKeys);
    expect(codes.length).toBeGreaterThan(8);
    expect(codes.filter((c) => !known.has(`fail.${c}`))).toEqual([]);
  });
});
