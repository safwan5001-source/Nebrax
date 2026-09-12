import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isReservedTenantSlug, tenantBaseDomain, tenantHostSuffix } from '@/lib/tenant-domain';

function source(file: string) {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

describe('AWJ tenant subdomain display', () => {
  it('defaults to awj.app and keeps the suffix configurable', () => {
    expect(tenantBaseDomain('')).toBe('awj.app');
    expect(tenantBaseDomain('awj.app')).toBe('awj.app');
    expect(tenantBaseDomain('.awj.app.')).toBe('awj.app');
    expect(tenantHostSuffix('localhost')).toBe('.localhost');
    expect(tenantHostSuffix()).toBe('.awj.app');
  });

  it('rejects reserved infrastructure slugs', () => {
    for (const slug of ['www', 'api', 'app', 'admin', 'platform', 'support', 'WWW']) {
      expect(isReservedTenantSlug(slug)).toBe(true);
    }
    expect(isReservedTenantSlug('alnoor')).toBe(false);
  });

  it('registration shows the AWJ suffix rather than nebrax.app', () => {
    const page = source('src/app/register/page.tsx');
    expect(page).toContain('tenantHostSuffix');
    expect(page).not.toContain('.nebrax.app');
  });
});
