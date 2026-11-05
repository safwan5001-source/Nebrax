import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** جدران ساكنة لحدود PS-A4b: لا إغلاق/إبطال/استبدال (A4c)، لا اعتماد جماعي (A4b0)، لا نداء شبكة خارج عميل الوحدة، لا حساب مالي بنقطة عائمة. */
const dir = __dirname;
const sources = readdirSync(dir).filter((name) => /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx'));
/** الشيفرة بلا تعليقات (التعليقات تذكر الحدود نفسها بالاسم). */
const text = (name: string) =>
  readFileSync(join(dir, name), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('PS-A4b architecture walls', () => {
  it('the client calls only the allowed endpoints', () => {
    const client = text('client.ts');
    const paths = Array.from(client.matchAll(/\$\{base\(id\)\}(\/[a-z-]+)/g)).map((m) => m[1]);
    expect(new Set(paths)).toEqual(new Set(['/status', '/lines', '/matches', '/match', '/verify-set', '/decisions', '/reversed-pairs', '/review', '/reopen', '/events']));
    expect(client).not.toMatch(/\/(close|void|replace|bulk|export|settings)\b/);
  });

  it('nothing outside client.ts talks to the network or to lifecycle endpoints that belong to later slices', () => {
    for (const name of sources.filter((file) => file !== 'client.ts')) {
      const source = text(name);
      expect(source, name).not.toMatch(/\bfetch\(/);
      expect(source, name).not.toMatch(/(?<![.\w])(close|void|replace|bulk)[A-Za-z]*\(/i);
    }
  });

  it('the decision queue imports ApiError only to classify 429 and never posts by itself', () => {
    const queue = text('decision-queue.ts');
    expect(queue).not.toMatch(/\bapi\(/);
    expect(queue).toMatch(/status === 429/);
  });

  it('has no bulk-approval or simulated bulk affordance', () => {
    for (const name of sources) {
      expect(text(name), name).not.toMatch(/approve[_-]?all|confirm[_-]?all|bulk[_-]?(decision|approve|confirm)|اعتماد جماعي/i);
    }
  });

  it('does no floating-point money arithmetic', () => {
    for (const name of sources) {
      expect(text(name), name).not.toMatch(/parseFloat|toFixed|Math\.round\([^)]*\*\s*100/);
    }
  });

  it('keeps financial values left-to-right via the shared presentation helpers', () => {
    expect(text('presentation.tsx')).toMatch(/dir="ltr"/);
  });
});
