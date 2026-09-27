import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AWJ ERP browser icon', () => {
  it('ships a Next.js App Router icon asset', () => {
    const iconPath = path.join(process.cwd(), 'src/app/icon.ico');
    const icon = fs.readFileSync(iconPath);

    expect(icon.length).toBeGreaterThan(0);
    expect(icon.subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
  });

  it('does not reference legacy Nebrax/Nibras favicon branding', () => {
    const layout = fs.readFileSync(
      path.join(process.cwd(), 'src/app/layout.tsx'),
      'utf8',
    );

    expect(layout).not.toMatch(/Nebrax|Nibras|نبراس|نبراكس/i);
  });

  it('mounts tenant browser identity in every ERP shell, not root Providers', () => {
    const providers = fs.readFileSync(
      path.join(process.cwd(), 'src/components/providers.tsx'),
      'utf8',
    );
    const shells = [
      'src/app/(app)/layout.tsx',
      'src/app/(pos)/layout.tsx',
      'src/app/(fuel)/layout.tsx',
      'src/app/(commerce)/layout.tsx',
      'src/app/me/layout.tsx',
    ].map((file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8'));

    expect(providers).not.toContain('CompanyBrowserIdentity');
    for (const shell of shells) expect(shell).toContain('AuthenticatedCompanyBrowserIdentity');
  });

  it('uses a server-resolved icon endpoint so tenant identity is present in initial HTML', () => {
    const layout = fs.readFileSync(
      path.join(process.cwd(), 'src/app/layout.tsx'),
      'utf8',
    );
    const route = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/company-browser-icon/route.ts'),
      'utf8',
    );

    expect(layout).toContain("icon: '/api/company-browser-icon'");
    expect(layout).toContain("apple: '/api/company-browser-icon'");
    expect(route).toContain('company-browser-identity');
    expect(route).toContain("Origin: `${protocol}://${host}`");
    expect(route).toContain("const FALLBACK_ICON = '/icon.ico'");
  });
});
