import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * UI-0 = قراءة فقط، وبلا بيانات ثابتة. حارس ساكن على مصدر الوحدة (باستثناء الاختبارات و`__fixtures__`):
 * لا طرق كتابة، لا fetch مباشر، لا `api(` خارج عميل القراءة، لا أسماء وقود/أسعار/محطات مكتوبة في الكود،
 * ولا استيراد من الاختبارات أو البيانات التجريبية.
 */
const dir = fileURLToPath(new URL('.', import.meta.url));
const sources = readdirSync(dir)
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.startsWith('__'))
  .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));

const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

describe('station-ops is read-only', () => {
  it('has module sources to scan', () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it.each(sources)('$file has no write HTTP method', ({ text }) => {
    expect(code(text)).not.toMatch(/['"`](POST|PUT|PATCH|DELETE)['"`]/i);
    expect(code(text)).not.toMatch(/method\s*:\s*['"`](?!GET)/i);
  });

  it.each(sources)('$file does not call fetch/axios/XHR directly', ({ text }) => {
    expect(code(text)).not.toMatch(/\bfetch\s*\(|axios|XMLHttpRequest|sendBeacon/);
  });

  it('only read-client.ts talks to api()', () => {
    for (const { file, text } of sources) {
      const calls = /\bapi\s*[<(]/.test(code(text));
      expect(calls, file).toBe(file === 'read-client.ts');
    }
  });

  it.each(sources)('$file hard-codes no fuel catalogue, price or station', ({ text }) => {
    const source = code(text);
    expect(source).not.toMatch(/diesel|ديزل|بنزين|gasoline|petrol|\b91\b|\b95\b|ULP|Nebras|نبراس|نبراكس/i);
    expect(source).not.toMatch(/price_per_liter_minor\s*[:=]\s*\d/);
  });

  it.each(sources)('$file imports no mock/demo data or test fixtures', ({ text }) => {
    expect(code(text)).not.toMatch(/mock-data|demo-product-store|__fixtures__/);
  });

  it('does not import the mutation helpers (idempotency/intent keys)', () => {
    for (const { file, text } of sources) expect(code(text), file).not.toMatch(/intent-key|idempotency/);
  });
});
