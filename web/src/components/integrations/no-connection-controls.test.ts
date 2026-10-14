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
  join(SRC, 'lib/communications-providers.ts'),
  join(SRC, 'lib/signed-ingress.ts'),
  join(SRC, 'lib/ingress-management.ts'),
].filter((path) => !isTest(path) && /\.(ts|tsx)$/.test(path));

const files = sources.map((path) => ({ path: relative(SRC, path), code: readFileSync(path, 'utf8') }));

describe('integration center module sources', () => {
  it('covers the expected files (so the invariant cannot pass vacuously)', () => {
    const names = files.map((f) => f.path);
    expect(names).toEqual(expect.arrayContaining([
      'lib/integration-center.ts',
      'lib/signed-ingress.ts',
      'components/integrations/signed-ingress-panel.tsx',
      'components/integrations/use-signed-ingress.ts',
      'lib/ingress-management.ts',
      'components/integrations/use-ingress-permissions.ts',
      'components/integrations/use-ingress-management.ts',
      'components/integrations/ingress-row-actions.tsx',
      'components/integrations/ingress-management-layer.tsx',
      'components/integrations/integration-center-landing.tsx',
      'components/integrations/delivery-platform-catalog.tsx',
      'components/integrations/delivery-platform-detail.tsx',
      'components/integrations/delivery-ladder.tsx',
      'components/integrations/use-delivery-integration-data.ts',
      'components/integrations/communications-catalog.tsx',
      'components/integrations/communications-provider-mark.tsx',
      'lib/communications-providers.ts',
      'app/(app)/integrations/communications/page.tsx',
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

  it('uses the shared Button component only for the retry action and the declared INT-UX-5b/5c actions', () => {
    // INT-UX-5b: ثلاثة مواضع استثنائية معلنة بأسمائها، لكلٍّ معالج واحد معروف. أي زر آخر (إنشاء، إعادة إسناد، إعادة تفعيل…) يفشل هنا.
    const allowed: Record<string, RegExp[]> = {
      'components/integrations/ingress-row-actions.tsx': [/onClick=\{\(\) => management\.openRotate\(point\)\}/, /onClick=\{\(\) => management\.openDisable\(point\)\}/],
      'components/integrations/ingress-management-layer.tsx': [/onClick=\{management\.dismissNotice\}/],
      // INT-UX-5c: مدخل الإنشاء زرّ واحد، ونموذج الإنشاء ثلاثة (إعادة قراءة الفروع، إلغاء، إرسال).
      'components/integrations/ingress-create-entry.tsx': [/onClick=\{management\.openCreate\}/],
      'components/integrations/ingress-create-dialog.tsx': [/onClick=\{\(\) => setBranchAttempt\(\(value\) => value \+ 1\)\}/, /onClick=\{onCancel\}/, /onClick=\{submit\}/],
    };
    for (const { path, code } of files) {
      const uses = code.match(/<Button\b/g)?.length ?? 0;
      if (uses === 0) continue;
      const blocks = code.split(/<Button\b/).slice(1).map((chunk) => chunk.slice(0, chunk.indexOf('</Button>')));
      const exceptions = allowed[path];
      if (exceptions) {
        expect(blocks, `${path}: exactly the declared buttons`).toHaveLength(exceptions.length);
        blocks.forEach((block, index) => expect(block, path).toMatch(exceptions[index]));
        continue;
      }
      // كل استعمال لـButton في غيرها يجب أن يكون زر «إعادة المحاولة» (onClick={onRetry} + t('retry')).
      for (const block of blocks) {
        expect(block, `${path}: only the retry button is allowed`).toMatch(/onClick=\{onRetry\}/);
        expect(block, path).toMatch(/t\('retry'\)/);
      }
    }
  });

  it('never calls the backend with a write method or a connector/credential route', () => {
    // INT-UX-4: القراءة الحرفية `GET '/delivery-connectors'` (بلا لاحقة) مسموحة في خطّاف اللوحة وحده؛ كل ما عداها ممنوع.
    for (const { path, code } of files) {
      expect(code, path).not.toMatch(/method\s*:\s*['"`](POST|PUT|PATCH|DELETE)/i);
      const live = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const scrubbed = path === 'components/integrations/use-signed-ingress.ts' ? live.replace(/api<unknown>\('\/delivery-connectors'\)/g, 'api<unknown>(READ)') : live;
      expect(scrubbed, path).not.toMatch(/delivery-connectors|rotate-secret|\/disable|\/reassign|oauth|authoriz|credential|\/connect\b|\/sync\b/i);
    }
  });

  it('only reads the four existing endpoints, all by GET with no options argument', () => {
    const called = new Set<string>();
    for (const { path, code } of files) {
      for (const match of code.matchAll(/api(?:<[^>]*>)?\(\s*(['"`])([^'"`]+)\1\s*([,)])/g)) {
        called.add(match[2]);
        expect(match[3], `${path}: ${match[2]} must be a plain GET (no options)`).toBe(')');
      }
    }
    expect([...called].sort()).toEqual(['/applications/nav-state', '/branches', '/delivery-connectors', '/delivery-platforms', '/delivery-platforms/readiness']);
  });

  it('reads delivery-connectors and branches only from the signed ingress hook', () => {
    for (const { path, code } of files) {
      const touches = /['"`]\/(delivery-connectors|branches)['"`]/.test(code);
      expect(touches, path).toBe(path === 'components/integrations/use-signed-ingress.ts');
    }
  });

  it('never reads a secret-bearing field from the connector payload (comments excluded)', () => {
    for (const { path, code } of files) {
      const live = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(live, path).not.toMatch(/secret_prefix|\bsecretPrefix\b|signing_key|\.secret\b|\btoken\b|authorization/i);
    }
  });

  it('the ingress-management foundations stay pure and are consumed only by the declared INT-UX-5b files', () => {
    // الأساس (صلاحيات + قاموس أخطاء + هيكل hook) نقيّ: لا `api(` ولا `fetch` ولا أي مسار كتابة.
    const foundations = files.filter((f) => ['lib/ingress-management.ts', 'components/integrations/use-ingress-permissions.ts'].includes(f.path));
    expect(foundations).toHaveLength(2);
    for (const { path, code } of foundations) {
      const live = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(live, path).not.toMatch(/\bapi\s*[<(]|\bfetch\s*\(|XMLHttpRequest|\/delivery-connectors|rotate-secret|\/disable|\/reassign/);
    }
    const consumers = (pattern: RegExp) => files.filter((f) => pattern.test(f.code)).map((f) => f.path).filter((p) => p !== 'lib/ingress-management.ts' && p !== 'components/integrations/use-ingress-permissions.ts').sort();
    expect(consumers(/use-ingress-permissions/)).toEqual(['components/integrations/ingress-row-actions.tsx']);
    // `ingress-create-dialog` يستورد النوع `IngressErrorKey` وحده (لا منطق).
    expect(consumers(/@\/lib\/ingress-management/)).toEqual(['components/integrations/ingress-create-dialog.tsx', 'components/integrations/use-ingress-management.ts']);
  });

  it('INT-UX-5b: the only code that talks to the rotate/disable routes is lib/ingress-operations.ts, and only the management hook calls it', () => {
    const everything = walk(SRC).filter((path) => !isTest(path) && /\.(ts|tsx)$/.test(path));
    const writers = everything
      .filter((path) => /delivery-connectors\/\$\{|delivery-connectors[^\n]*rotate-secret/.test(readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')))
      .map((path) => relative(SRC, path));
    expect(writers).toEqual(['lib/ingress-operations.ts']);

    const callers = everything
      .filter((path) => /rotateIngressSecret|disableIngress/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path))
      .sort();
    expect(callers).toEqual(['components/integrations/use-ingress-management.ts', 'lib/ingress-operations.ts']);
  });

  it('INT-UX-5b/5c: ingress-operations has exactly three POST routes (create, rotate, disable), no reassign, and never stores, logs or tracks', () => {
    const code = readFileSync(join(SRC, 'lib/ingress-operations.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code.match(/method\s*:\s*'POST'/g)).toHaveLength(3);
    expect(code.match(/target\(id, '([a-z-]+)'\)/g)).toEqual(["target(id, 'rotate-secret')", "target(id, 'disable')"]);
    expect(code).not.toMatch(/reassign|oauth|authoriz|credential|\/connect\b|\/sync\b|method\s*:\s*'(PUT|PATCH|DELETE)'/i);
    expect(code).not.toMatch(/console\.|localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.|window\.|location|history\.|analytics|track|fetch\s*\(|XMLHttpRequest|sendBeacon/i);
    // مسار الإنشاء الحرفي مرة واحدة فقط، وجسمه الحقول الثلاثة التي يقبلها الخادم وحدها.
    expect(code.match(/api<unknown>\('\/delivery-connectors', \{ method: 'POST', body \}\)/g)).toHaveLength(1);
    expect(code.match(/delivery_platform_profile_id|external_store_id|branch_id/g)?.sort()).toEqual(['branch_id', 'delivery_platform_profile_id', 'external_store_id']);
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
