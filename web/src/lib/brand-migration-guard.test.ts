import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const LEGACY_PRODUCT_NAMES = ['نبراكس', 'Nebrax', 'NEBRAX', 'Nibras', 'NIBRAS'];

// Keep this list intentionally limited to customer-facing surfaces already migrated.
// Technical compatibility identifiers and historical company names are audited separately.
const MIGRATED_SURFACES = [
  'src/app/layout.tsx',
  'src/app/page.tsx',
  'src/components/auth/auth-shell.tsx',
  'src/components/layout/awj-logo.tsx',
  'src/lib/brand.ts',
];

describe('AWJ migrated customer-facing surfaces', () => {
  it.each(MIGRATED_SURFACES)('%s does not reintroduce a legacy product display name', (relativePath) => {
    const content = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

    for (const legacyName of LEGACY_PRODUCT_NAMES) {
      expect(content, `${relativePath} contains legacy product name: ${legacyName}`).not.toContain(legacyName);
    }
  });
});
