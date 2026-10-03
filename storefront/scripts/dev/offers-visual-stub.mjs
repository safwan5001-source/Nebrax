// CUST-H4-7 — dev-only stub of `GET /store/v1/offers` for the `/dev/offers-visual` fixture.
// Usage: node scripts/dev/offers-visual-stub.mjs  (port 4010), then run the storefront with
//   AWJ_COMMERCE_API_URL=http://127.0.0.1:4010 AWJ_STOREFRONT_DEV_HOST=shop.test pnpm dev
// and open /dev/offers-visual?ids=o1,o2,o3,o4,gone . Never used by the product.
import http from "node:http";
// Stub of GET /store/v1/offers — LIVE offers only, in "database" order that
// deliberately differs from the merchant's stored order.
const money = (a) => ({ amount_minor: a, currency: "SAR" });
const offer = (id, name, nameEn, ref, off, pct, thumb = null) => ({
  id, product_id: `prod-${id}`, name, name_en: nameEn, thumbnail_url: thumb,
  reference_price: money(ref), offer_price: money(off), discount_percent: pct, starts_at: null, ends_at: null,
});
const data = [
  offer("o4", "جهاز منزلي متعدد الاستخدامات بمواصفات احترافية وضمان ممتد لخمس سنوات مع خدمة صيانة منزلية مجانية", "Professional-Grade Multi-Purpose Home Appliance with Five-Year Extended Warranty and Free In-Home Service", 129900, 99900, 23),
  offer("o2", "سماعة لاسلكية", "Wireless Headphones", 25000, 19000, 24, "http://127.0.0.1:4010/img.svg"),
  offer("o3", "حقيبة ظهر يومية", "Everyday Backpack", 25000, 24999, 0),
  offer("o1", "خوذة دراجة", "Bike Helmet", 18900, 14900, 21, "http://127.0.0.1:4010/img.svg"),
  offer("o5", "ساعة ذكية", "Smart Watch", 54900, 39900, 27),
  offer("o6", "مصباح مكتبي", "Desk Lamp", 9900, 7900, 20),
];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#dbe4ee"/><circle cx="200" cy="140" r="70" fill="#8aa1b8"/></svg>`;
http.createServer((req, res) => {
  console.log(req.method, req.url, req.headers["x-storefront-forwarded-host"] ?? "");
  if (req.url === "/img.svg") { res.writeHead(200, { "content-type": "image/svg+xml" }); return res.end(svg); }
  if (req.url?.startsWith("/store/v1/offers")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ data, meta: { request_id: "stub" } }));
  }
  res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "not_found", message: "no" } }));
}).listen(4010, "127.0.0.1", () => console.log("stub on 4010"));
