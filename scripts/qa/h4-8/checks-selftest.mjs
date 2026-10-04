// Self-check: the harness must exit non-zero when an assertion fails and 0 when all pass.
import { spawnSync } from 'node:child_process';
const run = (body) => spawnSync(process.execPath, ['--input-type=module', '-e', `import { checks } from './lib.mjs'; const { ok, finish } = checks(); ${body}; finish();`], { cwd: new URL('.', import.meta.url).pathname, env: { ...process.env, H48_SEED: new URL('./seed.json', import.meta.url).pathname }, encoding: 'utf8' });
const pass = run("ok(true, 'a')"), fail = run("ok(true, 'a'); ok(false, 'b')");
console.log('all-pass exit', pass.status, '| one-failure exit', fail.status, '| failure still listed:', /FAIL b/.test(fail.stdout), '| summary:', /FAILS 1/.test(fail.stdout));
if (pass.status !== 0 || fail.status === 0 || !/FAIL b/.test(fail.stdout)) { console.error('SELF-TEST FAILED'); process.exit(1); }
console.log('SELF-TEST OK');
