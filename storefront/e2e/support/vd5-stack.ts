/**
 * AWJ-VD-H1 / VD-5 — helpers for `vd5-visual-dimensions.spec.ts`.
 *
 * The spec needs a REAL local stack (Laravel + Postgres + R2-compatible store + this storefront in dev mode) that is
 * described by one JSON file, whose path is passed in `VD5_STACK_ENV`. Nothing here starts a server, and nothing runs
 * in CI. All data is created and removed through the public/admin HTTP API with the `qa-s-e2e-` prefix; there are no
 * database writes.
 *
 * Stack file keys read here: `urls.api`, `urls.laravel`, `tenants["vd5-a"].owner_token_file`,
 * `storefronts[]` (key `s1`: host, port, store_id), `storefront_base_domain`, `chromium.args`.
 *
 * Public `store/v1` is throttled to 30 requests/minute per client IP, and the storefront's SSR and image proxy share
 * one IP, so a few page loads exhaust it (the proxy then answers 502). When a `reset-throttle.sh` sits next to the
 * stack file it is executed before every page load; otherwise the throttle is simply a limit the run has to live with.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
} from "node:http";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

export interface StackStorefront {
  key: string;
  host: string;
  port: number;
  store_id: string;
}

export interface StackEnv {
  urls: { api: string; laravel: string };
  storefront_base_domain: string;
  chromium?: { args?: string[]; executablePath?: string };
  tenants: Record<string, { owner_token_file: string }>;
  storefronts: StackStorefront[];
}

export function stackPath(): string | undefined {
  return process.env.VD5_STACK_ENV || undefined;
}

export function loadStack(path = stackPath()): StackEnv {
  if (!path) throw new Error("VD5_STACK_ENV is not set");
  return JSON.parse(readFileSync(path, "utf8")) as StackEnv;
}

export function storefrontOne(stack: StackEnv): StackStorefront {
  const s1 = stack.storefronts.find((s) => s.key === "s1");
  if (!s1) throw new Error("stack file has no storefront with key s1");
  return s1;
}

/** Clears the Laravel rate-limiter buckets through the stack's own script, when it exists. */
export function resetThrottle(): void {
  const path = stackPath();
  if (!path) return;
  const script = join(dirname(path), "reset-throttle.sh");
  if (existsSync(script)) {
    try {
      execFileSync("bash", [script], { stdio: "ignore" });
    } catch {
      // The throttle is an environment fact; a failed reset only means the run lives with it.
    }
  }
}

/**
 * Keeps the throttle bucket empty of history while a test runs: a hydrated page re-renders the route through Server
 * Actions (cart/session sync) and each render spends several `store/v1` requests, so a single reset before the page
 * load is not enough to stay under 30 requests/minute. Returns the function that stops the ticker.
 */
export function keepThrottleClear(everyMs = 2000): () => void {
  resetThrottle();
  const timer = setInterval(resetThrottle, everyMs);
  return () => clearInterval(timer);
}

// ───────────────────────────── admin API ─────────────────────────────

export class AdminApi {
  private readonly token: string;
  constructor(private readonly stack: StackEnv) {
    this.token = readFileSync(
      stack.tenants["vd5-a"].owner_token_file,
      "utf8",
    ).trim();
  }

  async call<T = any>(
    method: string,
    path: string,
    options: { json?: unknown; form?: FormData; ok?: number[] } = {},
  ): Promise<{ status: number; data: T }> {
    const ok = options.ok ?? [200, 201];
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
    };
    let body: BodyInit | undefined;
    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options.form) {
      body = options.form;
    }
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(this.stack.urls.api + path, {
        method,
        headers,
        body,
      });
      if (res.status === 429 && attempt < 5) {
        await sleep((Number(res.headers.get("retry-after")) || 10) * 1000);
        continue;
      }
      const text = await res.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text.slice(0, 200) };
      }
      if (!ok.includes(res.status)) {
        throw new Error(
          `${method} ${path} -> ${res.status} ${text.slice(0, 300)}`,
        );
      }
      return { status: res.status, data: data as T };
    }
  }

  async uploadImage(name: string, seed: number): Promise<string> {
    const form = new FormData();
    form.append(
      "files[]",
      new Blob([new Uint8Array(makePng(480, 480, seed))], {
        type: "image/png",
      }),
      `${name}.png`,
    );
    const res = await this.call(
      "POST",
      "/commerce/workspace/storefront-media",
      {
        form,
      },
    );
    const media = res.data?.data?.[0]?.media;
    if (!media?.id || media.variants_state !== "ready") {
      throw new Error(`media not ready: ${JSON.stringify(media)}`);
    }
    return media.id as string;
  }

  async createFacet(key: string, name: string, nameEn: string) {
    const res = await this.call("POST", "/commerce/workspace/facets", {
      json: { key, name, name_en: nameEn, sort_order: 95 },
    });
    return res.data.data.facet as { id: string };
  }

  async createValue(
    facetId: string,
    slug: string,
    name: string,
    nameEn: string,
  ) {
    const res = await this.call(
      "POST",
      `/commerce/workspace/facets/${facetId}/values`,
      {
        json: {
          name,
          name_en: nameEn,
          slug,
          sort_order: 1,
          is_active: true,
        },
      },
    );
    return res.data.data.value as { id: string; slug: string };
  }

  /** PUT the value's visual with the optimistic-concurrency token the admin API requires once a row exists. */
  async putValueVisual(facetId: string, valueId: string, visual: unknown) {
    const facets = (await this.call("GET", "/commerce/workspace/facets")).data
      .data.facets as {
      id: string;
      values: { id: string; visual_version: number | null }[];
    }[];
    const current = facets
      .find((f) => f.id === facetId)
      ?.values.find((v) => v.id === valueId);
    await this.call(
      "PUT",
      `/commerce/workspace/facets/${facetId}/values/${valueId}/visual`,
      {
        json: {
          visual,
          expected_version: current?.visual_version ?? null,
        },
      },
    );
  }

  async createProduct(sku: string) {
    const res = await this.call("POST", "/products", {
      json: {
        name: `qa-s e2e ${sku}`,
        name_en: `qa-s e2e ${sku}`,
        sku,
        type: "good",
        unit: "piece",
        sale_price: 10000,
        tax_rate: 15,
        track_inventory: false,
        is_active: true,
      },
    });
    const body = res.data as { data?: { id: string }; id?: string };
    return (body.data?.id ?? body.id) as string;
  }

  async assignValues(productId: string, valueIds: string[]) {
    await this.call("PUT", `/commerce/workspace/products/${productId}/facets`, {
      json: { value_ids: valueIds },
    });
  }

  async publishProduct(productId: string, storeIds: string[]) {
    await this.call(
      "PUT",
      `/commerce/workspace/products/${productId}/publication`,
      { json: { storefront_ids: storeIds } },
    );
  }

  /**
   * Replaces (or, with `section: null`, removes) the home section with `section.id` / `id` and publishes a new
   * version. Other sections, including seeded ones, are kept as they are. Retries on a stale-head 409.
   */
  async publishDiscoverySection(
    storeId: string,
    id: string,
    section: Record<string, unknown> | null,
  ) {
    const base = `/commerce/workspace/storefronts/${storeId}/presentation/versions`;
    for (let attempt = 1; ; attempt++) {
      const created = await this.call<any>("POST", base, {
        json: { name: `qa-s e2e ${new Date().toISOString().slice(0, 19)}` },
      });
      const versionId = created.data.data.id as string;
      try {
        const full = (await this.call<any>("GET", `${base}/${versionId}`)).data
          .data;
        const config = full.config;
        const sections = (config.homepage.sections as { id: string }[]).filter(
          (s) => s.id !== id,
        );
        if (section) {
          const at = Math.max(
            0,
            sections.findIndex((s) => s.id === "categories") + 1,
          );
          sections.splice(at, 0, { id, ...section } as { id: string });
        }
        config.homepage.sections = sections;
        const saved = await this.call<any>("PUT", `${base}/${versionId}`, {
          json: { config, revision: full.revision },
        });
        const head = (
          await this.call<any>(
            "GET",
            `/commerce/workspace/storefronts/${storeId}/presentation`,
          )
        ).data.data;
        const versions = (await this.call<any>("GET", base)).data.data as {
          id: string;
          state: string;
        }[];
        const active = versions.find((v) => v.state === "published");
        await this.call("POST", `${base}/${versionId}/publish`, {
          json: {
            revision: saved.data.data.revision,
            expected_published_revision: head.published_revision ?? null,
            expected_active_version_id: active?.id ?? null,
          },
        });
        return;
      } catch (error) {
        await this.call("DELETE", `${base}/${versionId}`, {
          ok: [200, 204, 404, 409, 422],
        }).catch(() => undefined);
        if (attempt < 4 && /-> 409/.test(String(error))) {
          await sleep(700 * attempt);
          continue;
        }
        throw error;
      }
    }
  }
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// ───────────────────────────── raw HTTP with an explicit Host ─────────────────────────────

export interface RawResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: Buffer;
}

/** A GET to 127.0.0.1:`port` carrying `Host: host` (fetch cannot override Host). */
export function rawGet(
  port: number,
  host: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: { Host: host, Accept: "*/*", ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: Object.fromEntries(
              Object.entries(res.headers).map(([k, v]) => [
                k,
                Array.isArray(v) ? v.join(", ") : v,
              ]),
            ),
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ───────────────────────────── a deterministic PNG, no dependency ─────────────────────────────

const CRC_TABLE = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** An RGB PNG whose pixels depend on `seed`, so the media library never deduplicates two runs. */
export function makePng(width: number, height: number, seed: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  const base = [(seed * 53) % 200, (seed * 97) % 200, (seed * 31) % 200];
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const ring =
        Math.abs(Math.hypot(x - width / 2, y - height / 2) - 120) < 8;
      const o = y * stride + 1 + x * 3;
      for (let c = 0; c < 3; c++) {
        raw[o + c] = ring ? 255 : base[c] + 40 + ((x + y + seed) % 24);
      }
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ───────────────────────────── browsing through `localhost` ─────────────────────────────

/**
 * `next dev` blocks its HMR WebSocket (a cross-origin dev resource) for any host that is not `localhost` or listed in
 * `allowedDevOrigins`, and a page whose HMR socket is blocked NEVER HYDRATES in dev: the markup is there but no
 * client code runs, so `onError` fallbacks, effects and hydration are not exercised at all. The managed hostname of a
 * storefront (`<slug>.store.<base>`) is exactly such a host.
 *
 * This reverse proxy lets the browser use `http://localhost:<listenPort>` (allowed, so the page hydrates) while the
 * dev server sees the managed `Host` (the facet-image proxy forwards the raw Host to Laravel, which resolves the
 * store from it). `Origin`/`Referer` of plain requests follow the Host so Server Actions pass the same-origin check;
 * the WebSocket upgrade keeps its `localhost` Origin. Test scaffolding only: no product code is involved.
 */
export function startBrowseProxy(options: {
  listenPort: number;
  targetPort: number;
  host: string;
}): Promise<Server> {
  const hostValue = `${options.host}:${options.targetPort}`;
  const server = createServer((req: IncomingMessage, res) => {
    const headers = { ...req.headers, host: hostValue };
    if (headers.origin) headers.origin = `http://${hostValue}`;
    if (headers.referer) {
      headers.referer = headers.referer.replace(
        /^http:\/\/[^/]+/,
        `http://${hostValue}`,
      );
    }
    const upstream = httpRequest(
      {
        host: "127.0.0.1",
        port: options.targetPort,
        path: req.url,
        method: req.method,
        headers,
      },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  server.on("upgrade", (req, socket, head) => {
    const upstream = connect(options.targetPort, "127.0.0.1", () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i];
        lines.push(
          `${name}: ${name.toLowerCase() === "host" ? hostValue : req.rawHeaders[i + 1]}`,
        );
      }
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head?.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.listenPort, "127.0.0.1", () => resolve(server));
  });
}

/** The port the spec's browse proxy listens on (the config's `baseURL` uses the same default). */
export function browsePort(): number {
  return Number(process.env.VD5_BROWSE_PORT) || 3317;
}
