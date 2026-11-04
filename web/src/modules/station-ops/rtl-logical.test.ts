import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * RTL/LTR بلا نسختين: المساحة تستعمل خصائص منطقية فقط (ms/me/ps/pe/start/end/border-s…)، فينقلب التخطيط
 * بتغيّر `dir` وحده. أي صنف فيزيائي (left/right) هنا يكسر أحد الاتجاهين.
 */
const dir = fileURLToPath(new URL('.', import.meta.url));
const files = readdirSync(dir).filter((file) => /\.tsx$/.test(file) && !/\.test\.tsx$/.test(file) && !file.startsWith('__'));
const PHYSICAL = /(?:^|[\s"'`:])-?(?:m[lr]|p[lr]|left|right|text-left|text-right|border-[lr]|rounded-[lr]|rounded-t[lr]|rounded-b[lr]|float-(?:left|right)|inset-[lr])(?:-[\w[\].]+)?(?=[\s"'`])/;

describe('station-ops uses logical (RTL-safe) utilities only', () => {
  it.each(files)('%s', (file) => {
    const classNames = [...readFileSync(join(dir, file), 'utf8').matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{cn\(([\s\S]*?)\)\})/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
    for (const value of classNames) expect(` ${value} `, value).not.toMatch(PHYSICAL);
  });
});
