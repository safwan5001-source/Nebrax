import type { StorefrontOrder } from "./checkout-types";

/**
 * A StorefrontOrder-shaped fixture used by unit tests and the
 * development-only `/dev/store-ui-5` preview. It is **not** a production
 * default and is never imported by the live account routes.
 *
 * `line_total` on the second line is deliberately not `unit_price × qty`
 * so tests can prove the UI prints the server figure rather than
 * multiplying locally.
 */
export const ACCOUNT_ORDER_PREVIEW: StorefrontOrder = {
  id: "ord-preview-1",
  number: "AWJ-10482",
  status: "confirmed",
  deliveryMethod: "standard",
  total: { amount_minor: 17500, currency: "SAR" },
  contact: {
    name: "نورة العبدالله",
    phone: "+966501234567",
    email: "noura@example.com",
  },
  delivery: {
    country: "السعودية",
    city: "الدمام",
    district: "الشاطئ",
    street: "طريق الملك فهد",
    postal_code: "32230",
    notes: null,
  },
  payment: {
    method: "cod",
    status: "awaiting_collection",
    payment_method_name: "نقدي",
  },
  items: [
    {
      productId: "p-cups",
      productName: "طقم أكواب زجاج",
      unitName: "طقم",
      quantity: 2,
      unitPrice: { amount_minor: 4500, currency: "SAR" },
      lineTotal: { amount_minor: 9000, currency: "SAR" },
    },
    {
      productId: "p-pot",
      productName: "إبريق قهوة ستانلس",
      unitName: "قطعة",
      quantity: 2,
      unitPrice: { amount_minor: 5000, currency: "SAR" },
      lineTotal: { amount_minor: 8500, currency: "SAR" },
    },
  ],
  createdAt: "2026-09-12T10:15:00.000Z",
};
