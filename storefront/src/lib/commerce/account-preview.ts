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
  gift: null,
  schedule: null,
  items: [
    {
      productId: "p-cups",
      productName: "طقم أكواب زجاج",
      unitName: "طقم",
      quantity: 2,
      unitPrice: { amount_minor: 4500, currency: "SAR" },
      lineTotal: { amount_minor: 9000, currency: "SAR" },
      personalization: [],
      lineId: null,
      addonOf: null,
    },
    {
      productId: "p-pot",
      productName: "إبريق قهوة ستانلس",
      unitName: "قطعة",
      quantity: 2,
      unitPrice: { amount_minor: 5000, currency: "SAR" },
      lineTotal: { amount_minor: 8500, currency: "SAR" },
      personalization: [],
      lineId: null,
      addonOf: null,
    },
  ],
  createdAt: "2026-09-12T10:15:00.000Z",
};

/**
 * A gifting order (FLOWERS-H13): an add-on under its bouquet, a personalised
 * line, a gift card and a requested delivery window. Same status as
 * `ACCOUNT_ORDER_PREVIEW` — a test/dev fixture, never a production default.
 */
export const ACCOUNT_GIFT_ORDER_PREVIEW: StorefrontOrder = {
  ...ACCOUNT_ORDER_PREVIEW,
  id: "ord-preview-gift-1",
  number: "AWJ-10533",
  total: { amount_minor: 31000, currency: "SAR" },
  gift: {
    recipientName: "ريم الحربي",
    recipientPhone: "+966555550101",
    senderDisplayName: "نورة",
    hideSender: false,
    message: "كل عام وأنتِ بخير\nمع محبتي",
  },
  schedule: {
    method: "delivery",
    date: "2026-09-14",
    slot: {
      label: "مساءً",
      labelEn: "Evening",
      startTime: "16:00",
      endTime: "20:00",
    },
    timezone: "Asia/Riyadh",
  },
  items: [
    {
      productId: "p-bouquet",
      productName: "باقة ورد جوري",
      unitName: "باقة",
      quantity: 1,
      unitPrice: { amount_minor: 24000, currency: "SAR" },
      lineTotal: { amount_minor: 24000, currency: "SAR" },
      personalization: [
        {
          key: "card_name",
          label: "الاسم على البطاقة",
          labelEn: "Name on the card",
          display: "ريم",
        },
      ],
      lineId: "line-1",
      addonOf: null,
    },
    {
      productId: "p-choc",
      productName: "علبة شوكولاتة",
      unitName: "علبة",
      quantity: 1,
      unitPrice: { amount_minor: 7000, currency: "SAR" },
      lineTotal: { amount_minor: 7000, currency: "SAR" },
      personalization: [],
      lineId: "line-2",
      addonOf: "line-1",
    },
  ],
};
