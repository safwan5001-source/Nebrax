/**
 * CUST-HV V4b — media library for the **preview (Demo) mode** only.
 *
 * Mirrors the shapes of `commerce/workspace/storefront-media*` so the picker,
 * editor and per-usage readiness can be reviewed (and visually verified)
 * without a Laravel server. In-memory, per page load; images are inline SVG
 * data URIs so nothing is fetched. Never reached outside demo mode.
 */

type DemoAsset = {
  id: string;
  name: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  alt_ar: string | null;
  alt_en: string | null;
  variants_state: 'pending' | 'ready' | 'failed';
  variants_error: string | null;
  src: string;
  usage_count: number;
};

function svg(width: number, height: number, a: string, b: string, label: string): string {
  // A raster (PNG) data URI where a canvas exists — the builder's logo guard
  // refuses SVG data URIs by design — else an inline SVG (unit tests / SSR).
  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const g = ctx.createLinearGradient(0, 0, width, height);
        g.addColorStop(0, a);
        g.addColorStop(1, b);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.arc(width * 0.72, height * 0.34, Math.min(width, height) * 0.16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(width * 0.08, height * 0.62, width * 0.34, height * 0.05);
        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.round(height * 0.09)}px sans-serif`;
        ctx.fillText(label, width * 0.08, height * 0.55);
        const png = canvas.toDataURL('image/png');
        if (png.startsWith('data:image/png')) return png;
      }
    } catch {
      /* fall through to SVG */
    }
  }
  const body =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>` +
    `<rect width="${width}" height="${height}" fill="url(#g)"/>` +
    `<text x="${width * 0.08}" y="${height * 0.55}" font-family="sans-serif" font-size="${height * 0.09}" fill="#ffffff">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(body)}`;
}

const assets: DemoAsset[] = [
  { id: 'a1b2c3d4-0001-4000-8000-000000000001', name: 'hero-spring.jpg', mime: 'image/jpeg', size: 482_113, width: 4000, height: 3000, alt_ar: 'مجموعة الربيع', alt_en: 'Spring collection', variants_state: 'ready', variants_error: null, src: svg(400, 300, '#0f766e', '#134e4a', 'Spring'), usage_count: 2 },
  { id: 'a1b2c3d4-0002-4000-8000-000000000002', name: 'logo-wordmark.png', mime: 'image/png', size: 38_412, width: 1200, height: 400, alt_ar: null, alt_en: null, variants_state: 'ready', variants_error: null, src: svg(300, 100, '#475569', '#0f172a', 'Wordmark'), usage_count: 0 },
  { id: 'a1b2c3d4-0003-4000-8000-000000000003', name: 'banner-ramadan.webp', mime: 'image/webp', size: 221_004, width: 3200, height: 1000, alt_ar: 'عروض رمضان', alt_en: null, variants_state: 'ready', variants_error: null, src: svg(320, 100, '#9a3412', '#431407', 'Ramadan'), usage_count: 1 },
  { id: 'a1b2c3d4-0004-4000-8000-000000000004', name: 'product-shot.jpg', mime: 'image/jpeg', size: 301_990, width: 2000, height: 2500, alt_ar: null, alt_en: 'Product on a table', variants_state: 'pending', variants_error: null, src: svg(200, 250, '#7c3aed', '#312e81', 'Product'), usage_count: 0 },
  { id: 'a1b2c3d4-0005-4000-8000-000000000005', name: 'corrupted.jpg', mime: 'image/jpeg', size: 9_100, width: 800, height: 600, alt_ar: null, alt_en: null, variants_state: 'failed', variants_error: 'decode_failed', src: svg(400, 300, '#64748b', '#1e293b', 'Failed'), usage_count: 0 },
];

let counter = 100;

function wire(a: DemoAsset) {
  const ready = a.variants_state === 'ready';
  return {
    id: a.id,
    name: a.name,
    mime: a.mime,
    size: a.size,
    width: a.width,
    height: a.height,
    alt_ar: a.alt_ar,
    alt_en: a.alt_en,
    variants_state: a.variants_state,
    variants_error: a.variants_error,
    variants: [],
    thumbnail_url: ready || a.variants_state === 'failed' ? null : null,
    preview_url: ready ? a.src : null,
    usage_count: a.usage_count,
    created_at: '2026-10-06T08:00:00+00:00',
    // The demo has no signed thumb route: the (tiny) inline preview is the thumb.
    ...(ready ? { thumbnail_url: a.src } : {}),
  };
}

type Outcome = { handled: false } | { handled: true; response: unknown } | { handled: true; error: { status: number; message: string; body: unknown } };

const ROOT = '/commerce/workspace/storefront-media';

export function handleStorefrontMediaDemo(path: string, method: string, body: unknown): Outcome {
  const clean = path.split('?')[0];
  if (clean !== ROOT && !clean.startsWith(`${ROOT}/`)) return { handled: false };

  const rest = clean.slice(ROOT.length).split('/').filter(Boolean);
  const query = new URLSearchParams(path.includes('?') ? path.split('?')[1] : '');
  const found = (id: string) => assets.find((a) => a.id === id);
  const notFound: Outcome = { handled: true, error: { status: 404, message: 'الوسيط غير موجود.', body: { message: 'الوسيط غير موجود.' } } };

  if (rest.length === 0 && method === 'GET') {
    const q = (query.get('q') ?? '').toLowerCase();
    const unused = query.get('unused') === '1';
    const items = assets
      .filter((a) => !q || [a.name, a.alt_ar ?? '', a.alt_en ?? ''].some((s) => s.toLowerCase().includes(q)))
      .filter((a) => !unused || a.usage_count === 0)
      .map(wire);
    return {
      handled: true,
      response: {
        data: items,
        meta: {
          next_cursor: null,
          has_more: false,
          uploads_enabled: true,
          max_files_per_request: 5,
          max_bytes: 20_000_000,
          library: { assets: assets.length, max_assets: 500, bytes: 1_052_619, max_bytes: 1_000_000_000 },
        },
      },
    };
  }

  if (rest.length === 0 && method === 'POST') {
    const file = body instanceof FormData ? (body.getAll('files[]')[0] as File | undefined) : undefined;
    counter += 1;
    const created: DemoAsset = {
      id: `a1b2c3d4-${String(counter).padStart(4, '0')}-4000-8000-000000000999`,
      name: file?.name ?? 'upload.jpg',
      mime: file?.type || 'image/jpeg',
      size: file?.size ?? 100_000,
      width: 3000,
      height: 2000,
      alt_ar: null,
      alt_en: null,
      variants_state: 'ready',
      variants_error: null,
      src: svg(300, 200, '#0369a1', '#082f49', 'Upload'),
      usage_count: 0,
    };
    assets.unshift(created);
    return { handled: true, response: { data: [{ status: 'created', name: created.name, media: wire(created) }] } };
  }

  const asset = rest[0] ? found(rest[0]) : undefined;
  if (rest.length === 1) {
    if (!asset) return notFound;
    if (method === 'GET') return { handled: true, response: { data: wire(asset) } };
    if (method === 'PATCH') {
      const patch = (body ?? {}) as Record<string, string | null>;
      if ('alt_ar' in patch) asset.alt_ar = patch.alt_ar || null;
      if ('alt_en' in patch) asset.alt_en = patch.alt_en || null;
      if (typeof patch.name === 'string') asset.name = patch.name;
      return { handled: true, response: { data: wire(asset) } };
    }
  }

  if (rest[1] === 'retry' && method === 'POST') {
    if (!asset) return notFound;
    asset.variants_state = 'ready';
    asset.variants_error = null;
    return { handled: true, response: { data: wire(asset) } };
  }

  if (rest[1] === 'derivatives') {
    if (!asset) return notFound;
    const ready = (framed: boolean) => ({
      media_id: asset.id,
      usage_key: `demo-${framed ? 'framed' : 'plain'}`,
      state: 'ready',
      retryable: false,
      error_code: null,
      files: [
        { width: 768, format: 'webp', state: 'ready', url: asset.src, rendered_width: 768, rendered_height: 432 },
        { width: 768, format: 'jpg', state: 'ready', url: asset.src, rendered_width: 768, rendered_height: 432 },
      ],
    });
    if (rest[2] === 'status') return { handled: true, response: { data: [ready(true)] } };
    return { handled: true, response: { data: ready(true) } };
  }

  return { handled: false };
}
