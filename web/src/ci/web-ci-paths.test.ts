import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * WEB-CI-02 — حارس تغطية مسارات Web CI.
 *
 * اختبارات Web تقرأ ملفات من خارج `web/` (Rbac.php، عقود، fixtures، storefront/src…). تغيير
 * أحدها وحده لا يشغّل Web CI ما لم يكن في `paths` — وهكذا مرّ `commerce.wholesale.manage`
 * بلا تسمية. هذا الاختبار يستخرج كل مرجع نسبي حرفي خارج `web/` في مصادر `src/` ويشترط أن
 * يغطيه فلتر `web-ci.yml`. حدّه المعلن: يلتقط المراجع الحرفية (`'../../../x'`) لا المبنيّة
 * بأجزاء منفصلة؛ ويغطّي الاستيراد المتعدّي عبر `storefront/src/**` الواسع عمداً.
 */
const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../..');
const repoRoot = resolve(webRoot, '..');
const workflow = parse(readFileSync(resolve(repoRoot, '.github/workflows/web-ci.yml'), 'utf8')) as {
  on: { push: { paths: string[] }; pull_request: { paths: string[] } };
};

/** دلالات GitHub: `*` بلا شرطة مائلة، `**` أي شيء. */
function toRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; ) {
    if (pattern.startsWith('**', i)) { out += '.*'; i += 2; }
    else if (pattern[i] === '*') { out += '[^/]*'; i += 1; }
    else { out += pattern[i].replace(/[.+^${}()|[\]\\?]/g, '\\$&'); i += 1; }
  }
  return new RegExp(`^${out}$`);
}
const covered = (file: string, patterns: string[]) => patterns.some((p) => toRegExp(p).test(file));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sources(full);
    return /\.(ts|tsx|mjs)$/.test(e.name) ? [full] : [];
  });
}

function externalReferences(): { file: string; target: string }[] {
  const self = fileURLToPath(import.meta.url);
  const found: { file: string; target: string }[] = [];
  for (const file of sources(resolve(webRoot, 'src'))) {
    if (file === self) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/["'`]((?:\.\.\/){2,}[^"'`\n]+)["'`]/g)) {
      const abs = resolve(dirname(file), m[1]);
      if (abs.startsWith(webRoot + sep) || abs === webRoot || !abs.startsWith(repoRoot + sep)) continue;
      found.push({ file: relative(webRoot, file), target: relative(repoRoot, abs).split(sep).join('/') });
    }
  }
  return found;
}

describe('Web CI path filter (WEB-CI-02)', () => {
  const push = workflow.on.push.paths;
  const pr = workflow.on.pull_request.paths;

  it('push and pull_request filters are identical', () => {
    expect(pr).toEqual(push);
  });

  it('covers web/ and the workflow itself', () => {
    expect(covered('web/src/x.ts', push)).toBe(true);
    expect(covered('.github/workflows/web-ci.yml', push)).toBe(true);
  });

  it('covers the permission catalogue the roles label guard reads', () => {
    expect(covered('app/Support/Rbac.php', push)).toBe(true);
  });

  it('does not run for unrelated backend files', () => {
    for (const f of ['app/Services/Accounting/LedgerService.php', 'routes/api.php', 'database/migrations/x.php', 'tests/Feature/LedgerTest.php', 'app/Models/Product.php']) {
      expect(covered(f, push), f).toBe(false);
    }
  });

  it('covers every file outside web/ that a web source references by relative path', () => {
    const refs = externalReferences();
    expect(refs.length).toBeGreaterThan(0);
    // مرجع إلى مجلد (يُقرأ محتواه) يُعدّ مغطّى إذا غطّى الفلتر ما بداخله.
    const uncovered = refs.filter((r) => !covered(r.target, push) && !covered(`${r.target}/x`, push));
    expect(uncovered).toEqual([]);
  });
});
