import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isReservedTenantSlug,
  isTenantSubdomainHost,
  tenantBaseDomain,
  tenantHostFor,
  tenantHostSuffix,
} from '@/lib/tenant-domain';

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

  it('builds the tenant own subdomain from its slug', () => {
    expect(tenantHostFor('Aqiall', 'awjdev.xyz')).toBe('aqiall.awjdev.xyz');
    expect(tenantHostFor('alnoor')).toBe('alnoor.awj.app');
  });

  it('detects subdomain-hosted mode only when the host is under the configured base domain', () => {
    expect(isTenantSubdomainHost('test.awjdev.xyz', 'awjdev.xyz')).toBe(true);
    expect(isTenantSubdomainHost('aqiall.awjdev.xyz', 'awjdev.xyz')).toBe(true);
    // القاعدة عاريةً بلا شريحة تُعامَل كنطاق فرعي أيضاً على مستوى هذه الدالة
    // النصية وحدها — الحسم الفعلي لوجود شريحة أو غيابها من مسؤولية الخادم
    // (`TenantHostnameResolver::extractSlug`)، لا هذا المساعد العميل.
    expect(isTenantSubdomainHost('localhost', 'awjdev.xyz')).toBe(false);
    expect(isTenantSubdomainHost('localhost:3000', 'awjdev.xyz')).toBe(false);
    expect(isTenantSubdomainHost('preview-123.vercel.app', 'awjdev.xyz')).toBe(false);
    expect(isTenantSubdomainHost('test.localhost', 'localhost')).toBe(true);
  });
});
