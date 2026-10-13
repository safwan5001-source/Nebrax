// @vitest-environment node
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { describe, expect, it } from 'vitest';
import { config, middleware } from './middleware';
import { deliveryPlatformKeys } from '@/lib/integration-center';

const BASE = 'http://localhost:3000';
const run = (path: string) => middleware(new NextRequest(`${BASE}${path}`));
const isPassThrough = (response: Response) => response.headers.get('x-middleware-next') === '1';

describe('delivery platform 404 middleware (INT-UX-2)', () => {
  it.each(deliveryPlatformKeys())('a known key (%s) passes through untouched', (key) => {
    const response = run(`/integrations/delivery-platforms/${key}`);

    expect(isPassThrough(response)).toBe(true);
    expect(response.status).toBe(200);
  });

  it.each(['talabat', 'KEETA', 'keeta%20', '%2E%2E%2Fkeeta', 'jahez%3Fx%3D1', '%E0%A4%A', '__proto__', 'constructor'])(
    'an unknown or malformed key (%s) is answered with a real 404 rewrite',
    (key) => {
      const response = run(`/integrations/delivery-platforms/${key}`);

      expect(response.status).toBe(404);
      expect(isPassThrough(response)).toBe(false);
      expect(response.headers.get('x-middleware-rewrite')).toContain('unknown_platform=1');
    },
  );

  it('matches only the single-segment detail route', () => {
    const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

    expect(matches('/integrations/delivery-platforms/keeta')).toBe(true);
    expect(matches('/integrations/delivery-platforms/talabat')).toBe(true);
    expect(matches('/integrations/delivery-platforms')).toBe(false);
    expect(matches('/integrations')).toBe(false);
    expect(matches('/delivery-platforms')).toBe(false);
    expect(matches('/invoices')).toBe(false);
    expect(matches('/api/delivery-platforms/readiness')).toBe(false);
  });

  it('adds no data access: the file imports nothing but next/server and the registry check', async () => {
    const { readFileSync } = await import('node:fs');
    const code = readFileSync(new URL('./middleware.ts', import.meta.url), 'utf8');

    expect([...code.matchAll(/^import .* from '(.*)';$/gm)].map((m) => m[1]).sort()).toEqual(['@/lib/integration-center', 'next/server']);
    expect(code).not.toMatch(/\bfetch\(|\bapi\(|cookies\(|headers\(/);
  });
});
