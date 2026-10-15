/**
 * AWJ-VD-H1 / VD-5 — helpers for the stack-dependent visual-dimensions spec.
 *
 * Everything the spec needs from the outside world is read at run time from the JSON file named by `VD5_STACK_ENV`
 * (ports, tenant, owner token file, storefront host). Nothing about the stack — no host, token or id — is committed.
 * Seeding goes through the same public HTTP API the admin uses; there are no database writes.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { deflateSync } from 'node:zlib';
import type { Browser, BrowserContext, Page } from '@playwright/test';

export interface StackEnv {
  urls: { api: string; admin: string; laravel: string };
  users: Record<string, Record<string, { token_file: string; email: string }>>;
  storefronts?: { key: string; host: string; store_id: string; tenant: string }[];
}

export interface Stack {
  env: StackEnv;
  tenant: string;
  api: string;
  admin: string;
  laravel: string;
  ownerToken: string;
  /** Host of the second storefront (the one this spec may publish its own product to), when the env names one. */
  storefrontHost: string | null;
  storefrontId: string | null;
}

export function stackEnvPath(): string | null {
  return process.env.VD5_STACK_ENV ?? null;
}

export function loadStack(): Stack {
  const path = stackEnvPath();
  if (!path) throw new Error('VD5_STACK_ENV is not set');
  const env = JSON.parse(readFileSync(path, 'utf8')) as StackEnv;
  const tenant = process.env.VD5_TENANT ?? Object.keys(env.users).find((key) => env.users[key]?.owner) ?? '';
  const owner = env.users[tenant]?.owner;
  if (!owner) throw new Error(`no owner user for tenant "${tenant}" in ${path}`);
  const second = env.storefronts?.find((s) => s.key === (process.env.VD5_STORE_KEY ?? 's2') && s.tenant === tenant) ?? null;
  return {
    env,
    tenant,
    api: env.urls.api,
    admin: env.urls.admin,
    laravel: env.urls.laravel,
    ownerToken: readFileSync(owner.token_file, 'utf8').trim(),
    storefrontHost: second?.host ?? null,
    storefrontId: second?.store_id ?? null,
  };
}

/** A short unique suffix so repeated runs never collide on facet keys or names. */
export const runTag = (): string => `qa-w-${randomBytes(3).toString('hex')}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ApiResult<T = any> {
  status: number;
  data: T;
  headers: Headers;
}

export class StackApi {
  constructor(
    private readonly base: string,
    private readonly token: string,
  ) {}

  async request<T = any>(
    method: string,
    path: string,
    options: { json?: unknown; form?: FormData; headers?: Record<string, string>; absolute?: boolean } = {},
  ): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { Accept: 'application/json', ...(options.headers ?? {}) };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let body: BodyInit | undefined;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    }
    if (options.form) body = options.form;
    for (let attempt = 1; attempt <= 6; attempt++) {
      const response = await fetch(options.absolute ? path : this.base + path, { method, headers, body });
      if (response.status === 429 && attempt < 6) {
        await sleep(Math.min(70, Number(response.headers.get('retry-after') || 10)) * 1000 + 500);
        continue;
      }
      const text = await response.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text.slice(0, 200) };
      }
      return { status: response.status, data, headers: response.headers };
    }
    throw new Error(`rate limited: ${method} ${path}`);
  }
}

/**
 * GET against the PUBLIC storefront API (`store/v1`) as a shopper of the storefront that owns `host`. `fetch` silently
 * drops a custom Host header, so this goes through `node:http`.
 */
export function publicGet(laravel: string, path: string, host: string): Promise<ApiResult> {
  const url = new URL(laravel + path);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: 'GET', headers: { Host: host, Accept: 'application/json' } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          let data: any = null;
          try {
            data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            /* non-JSON body */
          }
          resolve({ status: res.statusCode ?? 0, data, headers: new Headers() });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ── seeding through the public API ──────────────────────────────────────────────

export const FACETS = '/commerce/workspace/facets';

export interface SeededFacet {
  id: string;
  key: string;
}
export interface SeededValue {
  id: string;
  slug: string;
}

export async function createFacet(api: StackApi, key: string, name: string, nameEn: string): Promise<SeededFacet> {
  const result = await api.request(`POST`, FACETS, { json: { key, name, name_en: nameEn } });
  if (result.status !== 201) throw new Error(`create facet ${key}: ${result.status} ${JSON.stringify(result.data).slice(0, 200)}`);
  return { id: result.data.data.facet.id, key };
}

export async function createValue(api: StackApi, facetId: string, name: string, nameEn?: string): Promise<SeededValue> {
  const result = await api.request('POST', `${FACETS}/${facetId}/values`, { json: { name, ...(nameEn ? { name_en: nameEn } : {}) } });
  if (result.status !== 201) throw new Error(`create value ${name}: ${result.status} ${JSON.stringify(result.data).slice(0, 200)}`);
  return { id: result.data.data.value.id, slug: result.data.data.value.slug };
}

export async function listFacets(api: StackApi): Promise<any[]> {
  const result = await api.request('GET', FACETS);
  if (result.status !== 200) throw new Error(`list facets: ${result.status}`);
  return result.data.data.facets;
}

export async function readValue(api: StackApi, facetId: string, valueId: string): Promise<any> {
  const facet = (await listFacets(api)).find((f) => f.id === facetId);
  return facet?.values.find((v: any) => v.id === valueId);
}

export async function readFacet(api: StackApi, facetId: string): Promise<any> {
  return (await listFacets(api)).find((f) => f.id === facetId);
}

export async function putValueVisual(api: StackApi, facetId: string, valueId: string, visual: unknown, expectedVersion: number | null) {
  return api.request('PUT', `${FACETS}/${facetId}/values/${valueId}/visual`, { json: { visual, expected_version: expectedVersion } });
}

export async function putFacetVisual(api: StackApi, facetId: string, visual: unknown, expectedVersion: number | null) {
  return api.request('PUT', `${FACETS}/${facetId}/visual`, { json: { visual, expected_version: expectedVersion } });
}

export async function uploadMedia(api: StackApi, name: string, png: Buffer): Promise<string> {
  const form = new FormData();
  form.append('files[]', new Blob([new Uint8Array(png)], { type: 'image/png' }), name);
  const result = await api.request('POST', '/commerce/workspace/storefront-media', { form });
  const media = result.data?.data?.[0]?.media;
  if (!media?.id) throw new Error(`upload ${name}: ${result.status} ${JSON.stringify(result.data).slice(0, 200)}`);
  if (media.variants_state !== 'ready') throw new Error(`media ${name} is ${media.variants_state}, not ready`);
  return media.id as string;
}

// ── a tiny dependency-free PNG encoder (deterministic fixture images) ────────────

function crc32(buffer: Buffer): number {
  let crc = ~0;
  for (let n = 0; n < buffer.length; n++) {
    let c = (crc ^ buffer[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A w×h RGB gradient PNG; `seed` makes each fixture's bytes (and therefore its library hash) different. */
export function makePng(width: number, height: number, base: [number, number, number], seed = 0): Buffer {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const o = y * stride + 1 + x * 3;
      raw[o] = (base[0] + ((x + y + seed) % 255)) % 256;
      raw[o + 1] = (base[1] + ((x * 2) % 90)) % 256;
      raw[o + 2] = (base[2] + ((y * 2) % 90)) % 256;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ── browser sessions ───────────────────────────────────────────────────────────

/** Hides the Next dev overlay badge (it covers the Save button) — dev-only chrome, never part of the product. */
export const HIDE_DEV_OVERLAY = 'nextjs-portal{display:none!important}';

export async function openAdminContext(
  browser: Browser,
  stack: Stack,
  options: { locale?: 'ar' | 'en'; token?: string } = {},
): Promise<BrowserContext> {
  const locale = options.locale ?? 'en';
  const token = options.token ?? stack.ownerToken;
  const me = await fetch(`${stack.api}/me`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (me.status !== 200) throw new Error(`/me answered ${me.status}`);
  const { user } = (await me.json()) as { user: unknown };
  const context = await browser.newContext({
    baseURL: stack.admin,
    viewport: { width: 1440, height: 960 },
    locale: locale === 'ar' ? 'ar-SA' : 'en-US',
  });
  await context.addCookies([{ name: 'locale', value: locale, url: stack.admin }]);
  // The login form is throttled (5/min/IP): the session is seeded the way the app itself stores it.
  await context.addInitScript(
    ({ token: t, user: u, css }) => {
      try {
        localStorage.setItem('token', t);
        localStorage.setItem('user', JSON.stringify(u));
        localStorage.setItem('theme', 'light');
      } catch {
        /* storage blocked: the page falls back to the login redirect and the spec fails loudly */
      }
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
      });
    },
    { token, user, css: HIDE_DEV_OVERLAY },
  );
  return context;
}

/** Records every request the page sends to the API: method, path (no query) and, once known, the status. */
export interface RecordedCall {
  method: string;
  path: string;
  status?: number;
  body?: any;
}

export function recordApi(page: Page, stack: Stack): RecordedCall[] {
  const calls: RecordedCall[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(stack.api)) return;
    let body: any;
    try {
      body = request.postDataJSON();
    } catch {
      body = undefined;
    }
    calls.push({ method: request.method(), path: request.url().slice(stack.api.length).split('?')[0], body });
  });
  page.on('response', (response) => {
    const request = response.request();
    if (!request.url().startsWith(stack.api)) return;
    const path = request.url().slice(stack.api.length).split('?')[0];
    const entry = [...calls].reverse().find((c) => c.method === request.method() && c.path === path && c.status === undefined);
    if (entry) entry.status = response.status();
  });
  return calls;
}

export async function openMerchandising(page: Page): Promise<void> {
  await page.goto('/commerce/merchandising', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-facet-row]').first().waitFor({ timeout: 120_000 });
}
