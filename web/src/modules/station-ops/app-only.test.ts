import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';

/**
 * قرار المنتج 2026-11-05 (APP-ONLY / SIMPLE UX): الموظف والمشرف يعملان داخل تطبيق «محطات أَوْج» ولا يُوجَّهان إلى ERP أو وحدة
 * إدارة المحطات. حارس ساكن: (1) كل رابط/تنقل في المصدر داخل `/fuel-stations/ops` (أو الدخول/الخروج)، (2) لا نصوص تحيل إلى شاشة أخرى
 * في أَوْج، (3) لا مصطلحات ERP/محاسبة في نصوص التطبيق. (منع الوصول بالرابط من الخادم = بوابة الموظف المقيّدة لاحقاً، فجوة G7.)
 */
const dir = fileURLToPath(new URL('.', import.meta.url));
const sources = readdirSync(dir)
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.startsWith('__'))
  .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

type Tree = { [key: string]: string | Tree };
const values = (tree: Tree): string[] => Object.values(tree).flatMap((value) => (typeof value === 'string' ? [value] : values(value)));
const copy = [...values((ar as unknown as { stationOps: Tree }).stationOps), ...values((en as unknown as { stationOps: Tree }).stationOps)];

describe('station ops is an app of its own', () => {
  it.each(sources)('$file links only inside /fuel-stations/ops', ({ text }) => {
    const source = code(text);
    for (const match of source.matchAll(/href=(?:\{`([^`]*)`\}|"([^"]*)"|\{'([^']*)'\})/g)) {
      const href = match[1] ?? match[2] ?? match[3] ?? '';
      // مرساة داخلية، أو قالب يبدأ بـ OPS_BASE / رابط ديناميكي تمرّره الشاشة المستدعية (`href={href}` يُفحص عند تعريفه).
      expect(href === '' || href.startsWith('#') || href.startsWith('${OPS_BASE}') || href.startsWith('${')).toBe(true);
    }
    for (const match of source.matchAll(/(?:replace|push)\(\s*['"`]([^'"`]*)['"`]/g)) expect(['/login', '/me']).toContain(match[1]);
  });

  it('defines every in-app route target under OPS_BASE', () => {
    const nav = sources.find((entry) => entry.file === 'nav.ts')!.text;
    expect(nav).toMatch(/OPS_BASE = '\/fuel-stations\/ops'/);
    expect([...code(nav).matchAll(/\{ id: '\w+', href: ([^,]+),/g)]).toHaveLength(4);
    for (const match of code(nav).matchAll(/\{ id: '\w+', href: ([^,]+),/g)) expect(match[1]).toMatch(/OPS_BASE/);
  });

  it('no sentence sends the user to another AWJ screen or to administration', () => {
    const offenders = copy.filter((text) => /full shifts screen|in AWJ settings|AWJ administration|administration in AWJ|Manage .* in AWJ|الشاشة الكاملة|إدارة أَوْج|إعدادات أَوْج|في أَوْج\b/i.test(text));
    expect(offenders).toEqual([]);
  });

  it('uses employee language: no ERP/accounting jargon in the app copy', () => {
    const offenders = copy.filter((text) => /\bERP\b|ledger|journal|invoice|debit|credit|accounting|قيد|الأستاذ|مدين|دائن|فاتورة|محاسبي|محاسبة/i.test(text));
    expect(offenders).toEqual([]);
  });
});
