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
const read = (base: string, prefix: string) => readdirSync(join(dir, base))
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.startsWith('__'))
  .map((file) => ({ file: `${prefix}${file}`, text: readFileSync(join(dir, base, file), 'utf8') }));
// FUEL-B4/B5: مساحتا الإدارة (`admin/`) والاستلام (`receiving/`) جزء من التطبيق نفسه وتخضعان للقواعد نفسها. PR-2: ومعالج الرصيد الافتتاحي (`opening/`) كذلك
// (روابطه داخل التطبيق فقط). نصوصه في فضاء `stationOpsOpening` المستقل: هو تدفّق مالي بسلطة مالية (ترحيل + تكلفة) يعرض القيد المحاسبي صراحةً بطلب المالك،
// فلا يخضع لحارس «لغة الموظف» الذي يحرس نصوص البائع والمشرف في `stationOps` وحدها.
// FUEL-B6: ومساحة الخزانات (`tanks/`) كذلك.
const sources = [...read('.', ''), ...read('admin', 'admin/'), ...read('receiving', 'receiving/'), ...read('tanks', 'tanks/'), ...read('opening', 'opening/')];
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
    for (const match of source.matchAll(/\brouter\.(?:replace|push)\(\s*['"`]([^'"`]*)['"`]/g)) expect(['/login', '/me']).toContain(match[1]);
  });

  it('defines every in-app route target under OPS_BASE', () => {
    const nav = sources.find((entry) => entry.file === 'nav.ts')!.text;
    expect(nav).toMatch(/OPS_BASE = '\/fuel-stations\/ops'/);
    expect([...code(nav).matchAll(/\{ id: '\w+', href: ([^,]+),/g)]).toHaveLength(7); // FUEL-B4: + «الإدارة»، FUEL-B5: + «الاستلام»، FUEL-B6: + «الخزانات»
    for (const match of code(nav).matchAll(/\{ id: '\w+', href: ([^,]+),/g)) expect(match[1]).toMatch(/OPS_BASE/);
  });

  // FUEL-B4: الاستثناء الوحيد المعتمد بطلب المالك — رابط إدارة أسعار الوقود القائمة، يعرّفه nav.ts وتستعمله شاشة الإدارة وحدها.
  it('has exactly one approved link out of the app: the existing fuel-price management screen', () => {
    const nav = code(sources.find((entry) => entry.file === 'nav.ts')!.text);
    expect([...nav.matchAll(/['"`](\/fuel-stations\/(?!ops)[^'"`]*)['"`]/g)].map((m) => m[1])).toEqual(['/fuel-stations/prices']);
    expect(nav).toMatch(/PRICES_HREF = '\/fuel-stations\/prices'/);
    const users = sources.filter(({ text }) => /\bPRICES_HREF\b/.test(code(text))).map(({ file }) => file).sort();
    expect(users).toEqual(['admin/manage-screen.tsx', 'nav.ts']);
    for (const { file, text } of sources) if (file !== 'nav.ts') expect(code(text), file).not.toMatch(/href=\{?['"`]\/fuel-stations\/prices|['"`]\/fuel-stations\/prices['"`]/);
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
