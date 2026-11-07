import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * حدّ مجلد PIN: كتابتان فقط (POST/DELETE) على `/fuel-stations/staff/{uuid}/pin` من `pin-client.ts` وحده؛ والرمز لا يُخزَّن ولا يُسجَّل.
 * ومجلد الدخول `login/` لا يتصل بالشبكة مباشرة (يمرّ عبر `stationLogin` في lib/auth) ولا يخزّن PIN ولا رقم الموظف.
 */
const here = fileURLToPath(new URL('.', import.meta.url));
const load = (dir: string) => readdirSync(join(here, dir))
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file))
  .map((file) => ({ file: `${dir}/${file}`, text: readFileSync(join(here, dir, file), 'utf8') }));
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
const pin = load('.');
const login = load('../login');

describe('pin folder', () => {
  it('only pin-client.ts talks to api(); nobody uses fetch/axios/XHR/beacon', () => {
    for (const { file, text } of pin) {
      expect(/\bapi\s*[<(]/.test(code(text)), file).toBe(file.endsWith('pin-client.ts'));
      expect(code(text), file).not.toMatch(/\bfetch\s*\(|axios|XMLHttpRequest|sendBeacon/);
    }
  });

  it('exactly one POST and one DELETE, no PUT/PATCH', () => {
    const client = code(pin.find(({ file }) => file.endsWith('pin-client.ts'))!.text);
    expect([...client.matchAll(/['"`]POST['"`]/g)]).toHaveLength(2); // نوع الدالة + الاستدعاء
    expect([...client.matchAll(/['"`]DELETE['"`]/g)]).toHaveLength(2);
    expect(client).not.toMatch(/['"`](PUT|PATCH)['"`]/);
    for (const { file, text } of pin) if (!file.endsWith('pin-client.ts')) expect(code(text), file).not.toMatch(/['"`](POST|DELETE|PUT|PATCH)['"`]/);
  });

  it('never persists or logs a PIN', () => {
    for (const { file, text } of [...pin, ...login]) {
      expect(code(text), file).not.toMatch(/localStorage\.setItem|sessionStorage\.setItem|document\.cookie|console\.(log|info|debug|warn|error)/);
    }
  });

  it('the section does not import the staff-save client (a separate, audited write)', () => {
    const section = code(pin.find(({ file }) => file.endsWith('pin-section.tsx'))!.text);
    expect(section).not.toMatch(/saveStaff|admin-client/);
  });
});

describe('login folder', () => {
  it('has no direct network access and no storage writes', () => {
    for (const { file, text } of login) {
      expect(code(text), file).not.toMatch(/\bfetch\s*\(|axios|XMLHttpRequest|sendBeacon|localStorage\.setItem|sessionStorage|document\.cookie/);
      expect(/\bapi\s*[<(]/.test(code(text)), file).toBe(false);
    }
  });

  it('never routes to an ERP page: success goes to the app, nothing else', () => {
    const screen = code(login.find(({ file }) => file.endsWith('login-screen.tsx'))!.text);
    expect([...screen.matchAll(/router(?:Ref\.current)?\.(?:replace|push)\(([^)]*)\)/g)].map((m) => m[1])).toEqual(['STATION_HOME_PATH', 'STATION_HOME_PATH']);
    expect(screen).not.toMatch(/['"`]\/(dashboard|login|me)['"`]/);
  });
});
