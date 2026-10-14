import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * AC-UX-07 — سقف تراجعي (ratchet): الشاشات الجديدة تستعمل `useCan()` من `@/lib/use-can`، لا استيراد
 * `hasPermission` مباشراً وحساب `user?.permissions, user?.role` يدوياً. القائمة أدناه هي المتبقّي من
 * المسارات القديمة (مجموعات commerce/pos، ومساعدات غير React)؛ تُشطَب منها عند ترحيلها ولا تُضاف إليها.
 */
const LEGACY_DIRECT_IMPORTERS = [
  'src/app/(app)/delivery-hub/page.tsx',
  'src/app/(app)/delivery-platforms/page.tsx',
  'src/app/(app)/integrations/page.tsx',
  'src/app/(commerce)/commerce/delivery/page.tsx',
  'src/app/(commerce)/commerce/domains/page.tsx',
  'src/app/(commerce)/commerce/gifting/page.tsx',
  'src/app/(commerce)/commerce/merchandising/page.tsx',
  'src/app/(commerce)/commerce/onboarding/page.tsx',
  'src/app/(commerce)/commerce/page.tsx',
  'src/app/(commerce)/commerce/published-products/page.tsx',
  'src/app/(commerce)/commerce/stores/page.tsx',
  'src/app/(commerce)/commerce/themes/page.tsx',
  'src/app/(pos)/pos/page.tsx',
  'src/components/dashboard/awj-global-search.tsx',
  'src/components/developer/developer-shell.tsx',
  'src/components/integrations/use-delivery-integration-data.ts',
  'src/components/integrations/use-signed-ingress.ts',
  'src/components/layout/nav-visibility.ts',
  'src/components/reports/delivery-channel-report-workspace.tsx',
  'src/lib/capabilities.ts',
  'src/lib/document-review-access.ts',
  'src/lib/ingress-management.ts',
  'src/modules/commerce-workspace/flowers-admin/product/gifting-tab.tsx',
  'src/modules/commerce-workspace/flowers-admin/product/use-flowers-capability.ts',
].sort();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe('permission-check consolidation', () => {
  const root = join(process.cwd(), 'src');
  const importers = sourceFiles(root)
    .filter((file) => /from '(@\/lib\/permissions|\.\.?\/permissions)'/.test(readFileSync(file, 'utf8')))
    .map((file) => relative(process.cwd(), file).split('\\').join('/'))
    .sort();

  it('adds no new direct hasPermission importer (use useCan from @/lib/use-can)', () => {
    expect(importers.filter((file) => !LEGACY_DIRECT_IMPORTERS.includes(file))).toEqual([]);
  });

  it('keeps the legacy list honest: migrated files are removed from it', () => {
    expect(LEGACY_DIRECT_IMPORTERS.filter((file) => !importers.includes(file))).toEqual([]);
  });
});
