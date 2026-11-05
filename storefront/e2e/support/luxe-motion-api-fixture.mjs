// AWJ Luxe Motion QA — throwaway mock of the public `store/v1` catalog API.
//
// Purpose: drive the REAL, unmodified storefront routes (home, category, product, layout, header, footer) in a real
// browser with the `awj-luxe-motion` preset published, without a Laravel stack. Synthetic neutral data only: no merchant
// branding, no tenant data, no prices/stock/orders authority. It answers the read endpoints the storefront calls and
// logs anything else (404) so unexpected dependencies are visible. Never used by the product.
//
//   node e2e/support/luxe-motion-api-fixture.mjs            # port 4120
//   AWJ_COMMERCE_API_URL=http://127.0.0.1:4120 AWJ_STOREFRONT_DEV_HOST=qa.luxe.test pnpm dev
import http from "node:http";

const PORT = Number(process.env.LUXE_QA_API_PORT || 4120);

const money = (amount_minor) => ({ amount_minor, currency: "SAR" });
const img = (n) => `http://127.0.0.1:${PORT}/img/${n}.svg`;
const media = (id, n, alt) => ({
  id: `m-${id}-${n}`,
  url: img(n),
  thumbnail_url: img(n),
  card_url: img(n),
  alt,
  position: n,
});

const CATEGORIES = [
  ["c1", "هدايا فاخرة", "Luxury gifts"],
  ["c2", "عطور", "Fragrances"],
  ["c3", "إكسسوارات", "Accessories"],
  ["c4", "ديكور المنزل", "Home decor"],
  ["c5", "عناية شخصية", "Personal care"],
  ["c6", "مجموعات موسمية", "Seasonal collections"],
].map(([id, ar, en], i) => ({
  id,
  name: ar,
  name_en: en,
  description: null,
  color: null,
  image: { url: img(i + 1), alt: en },
  parent_id: null,
  children: [],
  ancestors: [],
}));

// [id, ar name, en name, price minor, in_stock, categoryIdx, kind]
const SEED = [
  ["p1", "صندوق هدايا فاخر", "Luxury Gift Box", 24900, true, 0, "simple"],
  ["p2", "عطر العود الملكي", "Royal Oud Eau de Parfum", 45000, true, 1, "variant"],
  ["p3", "أسورة معدنية مصقولة", "Polished Metal Bracelet", 12900, true, 2, "simple"],
  [
    "p4",
    "مجموعة ديكور منزلي متكاملة بتصميم عصري تشمل شمعدانات وأطباق تقديم وإطارات صور بمقاسات متعددة",
    "Complete Contemporary Home Decor Collection Including Candle Holders, Serving Plates and Photo Frames in Multiple Sizes",
    89900,
    true,
    3,
    "simple",
  ],
  ["p5", "كريم عناية مرطب", "Hydrating Care Cream", 7900, false, 4, "simple"],
  ["p6", "طقم موسمي محدود", "Limited Seasonal Set", 32000, true, 5, "simple"],
  ["p7", "شمعة معطرة", "Scented Candle", 5900, true, 3, "simple"],
  ["p8", "حقيبة سفر جلدية", "Leather Travel Bag", 69900, true, 2, "variant"],
  ["p9", "مجموعة عناية", "Care Set", 15900, true, 4, "simple"],
  ["p10", "منتج بلا صورة", "Product Without Image", 9900, true, 0, "noimage"],
  ["p11", "عطر الزهور", "Floral Eau de Toilette", 28000, true, 1, "simple"],
  ["p12", "صينية تقديم", "Serving Tray", 18900, true, 3, "simple"],
];

function build(seed, index) {
  const [id, ar, en, price, inStock, catIdx, kind] = seed;
  const cat = CATEGORIES[catIdx];
  const galleryCount = id === "p1" ? 5 : 3;
  const mediaList =
    kind === "noimage"
      ? []
      : Array.from({ length: galleryCount }, (_, k) =>
          media(id, ((index + k) % 12) + 1, en),
        );
  const base = {
    id,
    name: ar,
    name_en: en,
    description: `${en}. A neutral QA description used to exercise typography and spacing in the product page.`,
    sku: `QA-${id.toUpperCase()}`,
    category: { id: cat.id, name: cat.name },
    price: money(price),
    in_stock: inStock,
    thumbnail_url: mediaList[0]?.thumbnail_url ?? null,
    card_url: mediaList[0]?.card_url ?? null,
    media: mediaList,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  if (kind === "variant") {
    return {
      ...base,
      price: money(0),
      is_variant_managed: true,
      options: [
        {
          id: `${id}-o1`,
          name: "الحجم",
          name_en: "Size",
          values: [
            { id: `${id}-o1v1`, value: "صغير", value_en: "Small" },
            { id: `${id}-o1v2`, value: "كبير", value_en: "Large" },
          ],
        },
      ],
      variants: [
        {
          id: `${id}-v1`,
          sku: `QA-${id.toUpperCase()}-S`,
          descriptor: "Small",
          option_value_ids: [`${id}-o1v1`],
          price: money(price),
          in_stock: true,
          media: mediaList.slice(0, 1),
        },
        {
          id: `${id}-v2`,
          sku: `QA-${id.toUpperCase()}-L`,
          descriptor: "Large",
          option_value_ids: [`${id}-o1v2`],
          price: money(price + 10000),
          in_stock: false,
          media: mediaList.slice(1, 2),
        },
      ],
    };
  }
  return base;
}
const PRODUCTS = SEED.map(build);

const presentation = {
  version: 2,
  themePreset: "awj-luxe-motion",
  primaryColor: "#71243f",
  accentColor: "#B88A43",
  fontPreset: "cairo-geist",
  density: "comfortable",
  productCard: "standard",
  branding: { displayName: "AWJ QA Store" },
  header: {
    style: "standard",
    showSearch: true,
    showAccount: true,
    showCart: true,
    showCategoryNav: true,
    design: { layout: "centered", sticky: "always", shadow: "soft" },
  },
  homepage: {
    heroHeadline: "Luxe Motion QA",
    heroSubheadline: "Neutral fixture content",
    // Section designs copied from the Luxe Motion theme's `sectionDefaults` (web/.../built-in-themes.ts), i.e. what a
    // store gets after "Apply theme". Authored content (banners, galleries) is deliberately absent: no fake merchant data.
    sections: [
      {
        id: "hero",
        type: "hero",
        visible: true,
        design: {
          layout: "split",
          spacing: { top: "lg", bottom: "lg", inner: "lg" },
          mediaTreatment: { height: "tall", mobileHeight: "standard" },
          typography: { headingScale: "xl", lineHeight: "relaxed" },
          radius: "lg",
          motion: { reveal: "fade-up" },
        },
      },
      {
        id: "categories",
        type: "categories",
        visible: true,
        design: {
          spacing: { top: "lg", bottom: "lg" },
          typography: { headingStyle: "centered" },
        },
      },
      {
        id: "newArrivals",
        type: "newArrivals",
        visible: true,
        design: {
          layout: "rail",
          typography: { headingStyle: "centered" },
          spacing: { top: "lg", bottom: "lg" },
          cards: { imageRatio: "3:4", hover: "zoom" },
        },
      },
      {
        id: "benefits",
        type: "benefits",
        visible: true,
        design: { layout: "flat", spacing: { top: "lg", bottom: "lg" }, typography: { headingStyle: "centered" } },
      },
    ],
  },
  footer: { tagline: "QA fixture", showLogo: true, copyright: "" },
  typography: {
    headingFamily: "amiri-lora",
    headingScale: "lg",
    headingWeight: 700,
    sectionHeading: "centered",
    lineHeight: "relaxed",
  },
  buttons: { style: "solid", size: "lg", radius: "md", hover: "lift" },
  surfaces: { radius: "md", border: { width: "hairline" }, shadow: "soft" },
  cards: { align: "start", imageRatio: "3:4", imageFit: "cover", hover: "zoom" },
  layout: { contentWidth: "standard" },
  motion: { duration: "slow", easing: "emphasized" },
};
// LUXE_QA_PRESET: "luxe" (default, full theme tokens) · "luxe-bare" (preset id only, no global tokens — what a
// document that merely selects the preset renders) · "modern" (baseline, also without tokens).
const MODE = process.env.LUXE_QA_PRESET || "luxe";
if (MODE === "luxe-bare" || MODE === "modern") {
  for (const key of ["typography", "buttons", "surfaces", "cards", "layout", "motion"]) delete presentation[key];
  delete presentation.header.design;
  presentation.accentColor = null;
}
if (MODE === "modern") {
  presentation.themePreset = "awj-modern";
  presentation.primaryColor = "#0f766e";
}

const SWATCHES = [
  ["#e9ded1", "#a97683"],
  ["#e8cfd0", "#8b4558"],
  ["#dfe6e0", "#6b8f7a"],
  ["#e5d3c6", "#b88a43"],
  ["#d9dde8", "#5c6b8f"],
  ["#efe3ea", "#9d2449"],
];
function svg(n) {
  const [bg, fg] = SWATCHES[n % SWATCHES.length];
  // 3:4 portrait art, reused for every ratio (object-fit handles the crop).
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200"><rect width="900" height="1200" fill="${bg}"/><circle cx="450" cy="520" r="230" fill="${fg}" opacity=".75"/><rect x="250" y="820" width="400" height="40" rx="20" fill="${fg}" opacity=".5"/><text x="450" y="1120" font-size="64" text-anchor="middle" fill="${fg}" font-family="sans-serif">${n}</text></svg>`;
}


// ── Cart (QA-only, in-memory, single shared cart). Prices are copied from the fixture catalogue; the real backend
// resolves prices itself — this exists only so the add-to-cart interaction has something to talk to.
const cart = { items: [] };
const cartBody = () => ({
  data: {
    status: cart.items.length ? "active" : null,
    items: cart.items,
    subtotal: money(cart.items.reduce((a, l) => a + l.line_total.amount_minor, 0)),
    currency: "SAR",
    has_unavailable_items: false,
  },
  meta: { request_id: "qa" },
});
const readBody = (req) =>
  new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
globalThis.__cartPosts = 0;

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const pagination = (page, perPage, total) => ({
  page,
  per_page: perPage,
  total,
  last_page: Math.max(1, Math.ceil(total / perPage)),
  has_more: page * perPage < total,
});

http
  .createServer((req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const p = url.pathname;
    const q = url.searchParams;

    const m = p.match(/^\/img\/(\d+)\.svg$/);
    if (m) {
      res.writeHead(200, {
        "content-type": "image/svg+xml",
        "cache-control": "public, max-age=3600",
      });
      return res.end(svg(Number(m[1])));
    }

    if (p === "/store/v1/cart" && req.method === "GET") return json(res, 200, cartBody());
    if (p === "/store/v1/cart/items" && req.method === "POST") {
      return readBody(req).then((b) => {
        const prod = PRODUCTS.find((x) => x.id === b.product_id);
        const variant = prod?.variants?.find((v) => v.id === b.product_variant_id);
        if (!prod || prod.in_stock === false || (prod.is_variant_managed && (!variant || variant.in_stock === false))) {
          return json(res, 422, { error: { code: "unavailable", message: "Unavailable" } });
        }
        const unit = (variant ?? prod).price;
        const key = `${prod.id}:${variant?.id ?? ""}`;
        const existing = cart.items.find((l) => l.id === key);
        const qty = Number(b.quantity || 1) + (existing?.quantity ?? 0);
        const line = {
          id: key,
          product_id: prod.id,
          product_variant_id: variant?.id ?? null,
          variant_descriptor: variant?.descriptor ?? null,
          product_name: prod.name,
          unit_key: "base",
          unit_name: "pcs",
          quantity: qty,
          unit_price: unit,
          line_total: money(unit.amount_minor * qty),
          available: true,
        };
        cart.items = existing ? cart.items.map((l) => (l.id === key ? line : l)) : [...cart.items, line];
        globalThis.__cartPosts += 1;
        return json(res, 200, cartBody());
      });
    }
    if (p === "/__qa/cart") return json(res, 200, { items: cart.items, posts: globalThis.__cartPosts });
    if (p === "/__qa/reset") { cart.items = []; globalThis.__cartPosts = 0; return json(res, 200, {}); }
    if (p === "/store/v1/storefront") {
      return json(res, 200, {
        data: {
          name: "AWJ QA Store",
          default_locale: null,
          business_identity: null,
          presentation,
        },
      });
    }
    if (p === "/store/v1/categories") {
      return json(res, 200, {
        data: CATEGORIES,
        meta: { request_id: "qa", pagination: pagination(1, 50, CATEGORIES.length) },
      });
    }
    const cat = p.match(/^\/store\/v1\/categories\/([^/]+)$/);
    if (cat) {
      const found = CATEGORIES.find((c) => c.id === cat[1]);
      return found
        ? json(res, 200, { data: found, meta: { request_id: "qa" } })
        : json(res, 404, { error: { code: "not_found", message: "Not found" } });
    }
    if (p === "/store/v1/products") {
      let list = PRODUCTS;
      const ids = q.getAll("ids[]").concat(q.getAll("ids"));
      if (ids.length) list = list.filter((x) => ids.includes(x.id));
      if (q.get("category_id")) list = list.filter((x) => x.category?.id === q.get("category_id"));
      if (q.get("search")) {
        const s = q.get("search").toLowerCase();
        list = list.filter((x) => x.name_en.toLowerCase().includes(s) || x.name.includes(s));
      }
      const sort = q.get("sort");
      if (sort === "sale_price") list = [...list].sort((a, b) => a.price.amount_minor - b.price.amount_minor);
      if (sort === "-sale_price") list = [...list].sort((a, b) => b.price.amount_minor - a.price.amount_minor);
      const perPage = Math.min(Number(q.get("per_page") || 24), 100);
      const page = Math.max(Number(q.get("page") || 1), 1);
      const slice = list.slice((page - 1) * perPage, page * perPage);
      // The list endpoint carries neither options nor variants.
      const rows = slice.map(({ options, variants, ...rest }) => rest);
      return json(res, 200, {
        data: rows,
        meta: { request_id: "qa", pagination: pagination(page, perPage, list.length) },
      });
    }
    const prod = p.match(/^\/store\/v1\/products\/([^/]+)$/);
    if (prod) {
      const found = PRODUCTS.find((x) => x.id === prod[1]);
      return found
        ? json(res, 200, { data: found, meta: { request_id: "qa" } })
        : json(res, 404, { error: { code: "not_found", message: "Not found" } });
    }
    // Everything else the storefront may ask for is intentionally unsupported by this fixture.
    if (p.startsWith("/store/v1/")) {
      process.stdout.write(`[luxe-fixture] unhandled ${req.method} ${p}\n`);
      return json(res, 404, { error: { code: "not_found", message: "Not found" } });
    }
    res.writeHead(404);
    res.end();
  })
  .listen(PORT, "127.0.0.1", () => {
    process.stdout.write(`luxe-motion QA API fixture listening on ${PORT}\n`);
  });
