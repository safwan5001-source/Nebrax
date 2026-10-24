import http from "node:http";

/**
 * Minimal `store/v1` fixture for the payment-return visual QA. The payment
 * state is encoded in the order id (`o-paid`, `o-pending`, …) so one server
 * covers every state; ownership is the signed reference header, exactly as the
 * real API: anything but `ref-ok` is the uniform 404.
 */
const PORT = Number(process.env.PAYMENT_QA_API_PORT || 4101);

const money = { amount_minor: 18750, currency: "SAR" };
const base = {
  can_retry: false,
  amount: money,
  paid_at: null,
  expires_at: null,
  checkout_url: null,
};
const STATES = {
  "o-paid": { ...base, status: "paid", paid_at: "2026-10-24T10:00:00Z" },
  "o-pending": { ...base, status: "pending", checkout_url: "https://pay.example/hosted/1" },
  "o-review": { ...base, status: "under_review" },
  "o-failed": { ...base, status: "failed", can_retry: true },
  "o-expired": { ...base, status: "expired", can_retry: true },
  "o-cancelled": { ...base, status: "cancelled", can_retry: false },
  "o-awaiting": { ...base, status: "awaiting_payment", can_retry: true },
};

const json = (res, body, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const storefront = {
  data: {
    name: "Al Noor",
    default_locale: null,
    business_identity: { legal_name: "Al Noor Trading Company", cr_number: "7050247977", vat_number: "310123456700003" },
    presentation: { version: 2, branding: { displayName: "Al Noor" }, header: { showCategoryNav: false } },
  },
};

http
  .createServer((req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    if (url.pathname === "/store/v1/storefront") return json(res, storefront);
    if (url.pathname === "/store/v1/categories") return json(res, { data: [] });
    if (url.pathname === "/store/v1/products") return json(res, { data: [], meta: {} });

    const status = url.pathname.match(/^\/store\/v1\/orders\/([^/]+)\/payment-status$/);
    if (status) {
      const payment = STATES[status[1]];
      if (!payment || req.headers["x-order-reference"] !== "ref-ok") {
        return json(res, { error: { code: "not_found", message: "Not found" } }, 404);
      }
      return json(res, { data: { payment } });
    }
    if (url.pathname === "/store/v1/checkout/payment-intent" && req.method === "POST") {
      return json(res, { data: { payment: STATES["o-pending"] } }, 201);
    }

    json(res, { error: { code: "not_found", message: "Not found" } }, 404);
  })
  .listen(PORT, "127.0.0.1", () => process.stdout.write(`payment-return QA API fixture on ${PORT}\n`));
