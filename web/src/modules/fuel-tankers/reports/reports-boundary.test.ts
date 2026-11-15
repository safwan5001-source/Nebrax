import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import { FINDING_CODES } from './logic';
import { REPORT_KEYS } from './routes';

/**
 * حدّ PR-6B-6 (الواجهات): قراءة فقط. نقطة الشبكة الوحيدة `client.ts` وفيها `GET` واحد على أربعة مفاتيح بيضاء؛ لا POST/PUT/PATCH/DELETE ولا `fetch` مباشر ولا `tenant_id` ولا ساعة عميل ولا
 * حسابات في أي حمولة، ولا استطلاع أو مؤقّت ولا كتابة من `useEffect`. لا يصل التطبيق المستقل (جلسة PIN) ولا يستورده، ولا يعرض «رصيد محطة» للحساب الوسيط، وخصائصه منطقية (RTL/LTR).
 */
const dir = __dirname;
const sources = readdirSync(dir).filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.startsWith('__'));
const read = (file: string) => readFileSync(join(dir, file), 'utf8');
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('TANKER-PR6B-6 reports network boundary', () => {
  it('only client.ts calls api(); nothing uses fetch/XMLHttpRequest/axios', () => {
    for (const file of sources) {
      const body = code(file);
      if (file !== 'client.ts') expect(body, `${file} must not call api()`).not.toMatch(/\bapi\s*[<(]/);
      expect(body, `${file} must not use fetch/XMLHttpRequest/axios`).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|axios/);
    }
  });

  it('client.ts is a single GET on the whitelisted report route', () => {
    const client = code('client.ts');
    expect(client).toContain("const BASE = '/fuel-stations/tanker-fill-reports'");
    expect([...client.matchAll(/\bapi\s*</g)]).toHaveLength(1);
    expect(client).toMatch(/api<unknown>\(`\$\{BASE\}\/\$\{key\}\$\{qs\}`\)/);
    expect(client).not.toMatch(/method\s*:|\bPOST\b|\bPUT\b|\bPATCH\b|\bDELETE\b|\bbody\s*:/);
  });

  it('ids in the query go through assertId and the key is the typed enum', () => {
    const client = code('client.ts');
    expect(client).toMatch(/stationId \? assertId\(filters\.stationId\)/);
    expect(client).toMatch(/ownerId \? assertId\(filters\.ownerId\)/);
    expect(client).toMatch(/key: ReportKey/);
  });

  it('no tenant, branch, client clock, account or amount parameter can be sent', () => {
    const logic = code('logic.ts');
    const keys = [...logic.matchAll(/entries\.push\(\['([a-z_]+)'/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual(['from', 'inventory_status', 'owner_id', 'page', 'per_page', 'station_id', 'status', 'to']);
    for (const file of sources) expect(code(file), file).not.toMatch(/tenant_id|Date\.now\(\)|new Date\(\)/);
  });

  it('has no polling, timers or effects that write', () => {
    for (const file of sources) {
      const body = code(file);
      expect(body, file).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
      expect(body, file).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
    }
  });

  it('never imports the standalone station app (PIN sessions cannot reach these reports)', () => {
    for (const file of sources) expect(code(file), file).not.toMatch(/station-ops|\/fuel-stations\/ops/);
  });

  it('uses logical (RTL/LTR-safe) spacing only', () => {
    for (const file of sources.filter((f) => f.endsWith('.tsx'))) {
      expect(code(file), file).not.toMatch(/\b(?:ml|mr|pl|pr|left|right|text-left|text-right|rounded-l|rounded-r|border-l|border-r)-/);
    }
  });

  it('never labels a ledger balance as a station balance (labels are organisation/branch; station is only ever negated)', () => {
    for (const messages of [ar, en]) {
      const c = messages.fuelTankerReports.clearing;
      const labels = [...Object.values(c.balance), c.levelOrganization, c.levelBranches, messages.fuelTankerReports.scope.level.organization, messages.fuelTankerReports.scope.level.branches].join(' ');
      expect(labels).not.toMatch(/محطة|station/i);
      // أي ذكر للمحطة في شروح النطاق يكون نفياً صريحاً.
      for (const note of [c.ledgerNote, messages.fuelTankerReports.scope.organizationBody, messages.fuelTankerReports.scope.branchesBody]) expect(note).toMatch(/ليس|لا |not /i);
    }
  });
});

describe('TANKER-PR6B-6 reports messages', () => {
  const flat = (value: unknown, prefix = ''): Record<string, string> => Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((acc, [k, v]) => (
    typeof v === 'string' ? { ...acc, [`${prefix}${k}`]: v } : { ...acc, ...flat(v, `${prefix}${k}.`) }
  ), {});
  const arFlat = flat(ar.fuelTankerReports);
  const enFlat = flat(en.fuelTankerReports);
  const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

  it('has identical keys and ICU parameters in Arabic and English', () => {
    expect(Object.keys(arFlat).sort()).toEqual(Object.keys(enFlat).sort());
    for (const key of Object.keys(arFlat)) expect(params(arFlat[key]), key).toBe(params(enFlat[key]));
  });

  it('translates every report, every finding code and every forbidden reason', () => {
    for (const key of REPORT_KEYS) {
      for (const group of ['tab', 'title', 'description']) { expect(arFlat[`${group}.${key}`], `${group}.${key}`).toBeTruthy(); expect(enFlat[`${group}.${key}`]).toBeTruthy(); }
    }
    for (const code of FINDING_CODES) { expect(arFlat[`finding.${code}`], code).toBeTruthy(); expect(enFlat[`finding.${code}`]).toBeTruthy(); }
    for (const reason of ['station_scope_restricted', 'financial_permissions_required', 'unknown']) {
      for (const part of ['title', 'body']) expect(arFlat[`forbidden.${reason}.${part}`]).toBeTruthy();
    }
    expect(arFlat['control.clearingUnavailable.station_scope_restricted']).toBeTruthy();
    expect(arFlat['control.clearingUnavailable.unknown']).toBeTruthy();
  });

  it('has no empty strings and no leftover placeholders', () => {
    for (const [key, value] of [...Object.entries(arFlat), ...Object.entries(enFlat)]) { expect(value.trim(), key).not.toBe(''); expect(value, key).not.toMatch(/TODO|undefined/); }
  });

  it('every t(...) key used by the screens exists (static keys)', () => {
    const used = new Set<string>();
    for (const file of sources.filter((f) => f.endsWith('.tsx'))) {
      for (const m of read(file).matchAll(/\bt\(\s*'([^'$`]+)'/g)) used.add(m[1]);
    }
    for (const key of used) expect(arFlat[key], `ar: ${key}`).toBeDefined();
    for (const key of used) expect(enFlat[key], `en: ${key}`).toBeDefined();
  });
});

describe('TANKER-PR6B-6 finding-code parity with the report service', () => {
  it('every finding code the server can emit is known (translated) in the screens', () => {
    const service = readFileSync(resolve(__dirname, '../../../../../app/Services/FuelTankerFillAccountingReportService.php'), 'utf8');
    const emitted = new Set([
      ...[...service.matchAll(/\$add\('([a-z_]+)'/g)].map((m) => m[1]),
      ...[...service.matchAll(/'code' => '([a-z_]+)'/g)].map((m) => m[1]),
    ]);
    expect(emitted.size).toBeGreaterThan(20);
    const known = new Set<string>(FINDING_CODES);
    expect([...emitted].filter((code) => !known.has(code))).toEqual([]);
  });

  it('every catalogued code is still emitted by the server (no stale translations)', () => {
    const service = readFileSync(resolve(__dirname, '../../../../../app/Services/FuelTankerFillAccountingReportService.php'), 'utf8');
    const stale = FINDING_CODES.filter((code) => !service.includes(`'${code}'`));
    expect(stale).toEqual([]);
  });
});
