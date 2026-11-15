import { afterEach, describe, expect, it, vi } from 'vitest';

const { requestHeaders } = vi.hoisted(() => ({ requestHeaders: vi.fn() }));
vi.mock('next/headers', () => ({ headers: requestHeaders }));
import { GET } from './route';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('company icon fallback behind a reverse proxy', () => {
  it('uses a same-origin PNG location even when request.url contains localhost', async () => {
    requestHeaders.mockResolvedValue(new Headers({ host: 'tenant.example.test' }));
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
    const response = await GET(new Request('http://localhost:8080/api/company-browser-icon'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/brand/awj/app-icon-v2.png');
    expect(new URL(response.headers.get('location')!, 'https://tenant.example.test').host).toBe('tenant.example.test');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('retains a valid company logo instead of returning the product fallback', async () => {
    requestHeaders.mockResolvedValue(new Headers({ host: 'tenant.example.test' }));
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ logo: 'https://cdn.example.test/company.png' }))));
    const response = await GET(new Request('http://localhost:8080/api/company-browser-icon'));
    expect(response.headers.get('location')).toBe('https://cdn.example.test/company.png');
  });
});
