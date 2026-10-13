import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * إثبات بنيوي (INT-UX-2): وحدة التكاملات لا تحتوي — في المصدر — أي عنصر ربط أو تفويض أو
 * إعادة ربط أو مزامنة أو إدخال اعتماد، ولا أي كتابة إلى الخادم. هذا يكمل اختبارات التصيير: يفشل
 * حتى لو أُضيف عنصر في حالة لا يغطيها اختبار تصيير. (R-GATE-1/5/7 في وثيقة التصميم.)
 */
const SRC = fileURLToPath(new URL('../../', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return [full];
  });
}

const isTest = (path: string) => /\.test\.(ts|tsx)$/.test(path);
const sources = [
  ...walk(join(SRC, 'components/integrations')),
  ...walk(join(SRC, 'app/(app)/integrations')),
  join(SRC, 'lib/integration-center.ts'),
].filter((path) => !isTest(path) && /\.(ts|tsx)$/.test(path));

const files = sources.map((path) => ({ path: relative(SRC, path), code: readFileSync(path, 'utf8') }));

describe('integration center module sources', () => {
  it('covers the expected files (so the invariant cannot pass vacuously)', () => {
    const names = files.map((f) => f.path);
    expect(names).toEqual(expect.arrayContaining([
      'lib/integration-center.ts',
      'components/integrations/integration-center-landing.tsx',
      'components/integrations/delivery-platform-catalog.tsx',
      'components/integrations/delivery-platform-detail.tsx',
      'components/integrations/delivery-ladder.tsx',
      'components/integrations/use-delivery-integration-data.ts',
      'app/(app)/integrations/page.tsx',
      'app/(app)/integrations/delivery-platforms/page.tsx',
      'app/(app)/integrations/delivery-platforms/[platformKey]/page.tsx',
    ]));
  });

  it('has no raw button, form, input, select or textarea element', () => {
    for (const { path, code } of files) {
      expect(code, path).not.toMatch(/<\s*(button|form|input|select|textarea)\b/);
      expect(code, path).not.toMatch(/type\s*=\s*["']password["']/);
      expect(code, path).not.toMatch(/autoComplete|autocomplete/);
    }
  });

  it('uses the shared Button component only for the retry action', () => {
    for (const { path, code } of files) {
      const uses = code.match(/<Button\b/g)?.length ?? 0;
      if (uses === 0) continue;
      // كل استعمال لـButton يجب أن يكون زر «إعادة المحاولة» (onClick={onRetry} + t('retry')).
      const blocks = code.split(/<Button\b/).slice(1).map((chunk) => chunk.slice(0, chunk.indexOf('</Button>')));
      for (const block of blocks) {
        expect(block, `${path}: only the retry button is allowed`).toMatch(/onClick=\{onRetry\}/);
        expect(block, path).toMatch(/t\('retry'\)/);
      }
    }
  });

  it('never calls the backend with a write method or a connector/credential route', () => {
    for (const { path, code } of files) {
      expect(code, path).not.toMatch(/method\s*:\s*['"`](POST|PUT|PATCH|DELETE)/i);
      expect(code, path).not.toMatch(/delivery-connectors|rotate-secret|\/disable|\/reassign|oauth|authoriz|credential|\/connect\b|\/sync\b/i);
    }
  });

  it('only reads the three existing endpoints', () => {
    const called = new Set<string>();
    for (const { code } of files) {
      for (const match of code.matchAll(/api(?:<[^>]*>)?\(\s*['"`]([^'"`]+)['"`]/g)) called.add(match[1]);
    }
    expect([...called].sort()).toEqual(['/applications/nav-state', '/delivery-platforms', '/delivery-platforms/readiness']);
  });

  it('links only to allow-listed destinations', () => {
    const allowed = [
      /^\/integrations$/, /^\/integrations\/delivery-platforms/, /^\/delivery-platforms$/, /^\/delivery-hub$/,
      /^\/reports\/sales\/delivery-channel$/, /^\/applications$/,
    ];
    for (const { path, code } of files) {
      for (const match of code.matchAll(/href\s*=\s*(?:"([^"]+)"|\{`([^`]+)`\}|\{'([^']+)'\})/g)) {
        const href = (match[1] ?? match[2] ?? match[3]).replace(/\$\{[^}]+\}/g, 'x');
        expect(allowed.some((re) => re.test(href)), `${path}: ${href}`).toBe(true);
      }
    }
  });
});
