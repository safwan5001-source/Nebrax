import { displayLocale } from "@/lib/formatting";
import {
  isKnownOfferReason,
  type KnownOfferReason,
  type WorkspaceOffer,
  type WorkspaceOfferMoney,
} from "@/modules/commerce-workspace/workspace-offers";
import type { CustomizerLocale, CustomizerMessageKey } from "./messages";

/**
 * CUST-H4-7 — عرض (لا حساب) لقيم العروض القادمة من سلطة Commerce.
 *
 * كل دالة هنا **تنسّق** رقماً أعاده الخادم ولا تشتقّ شيئاً: لا توفير، لا نسبة
 * بديلة، لا سعر «كان». التنسيق نفسه (Gregorian + أرقام لاتينية عبر
 * `displayLocale`) هو ما تستعمله بقية معاينة الـCanvas.
 */

export function formatOfferMoney(money: WorkspaceOfferMoney, locale: CustomizerLocale): string {
  try {
    return new Intl.NumberFormat(displayLocale(locale), {
      style: "currency",
      currency: money.currency,
      currencyDisplay: "narrowSymbol",
    }).format(money.amountMinor / 100);
  } catch {
    return `${(money.amountMinor / 100).toFixed(2)} ${money.currency}`;
  }
}

/**
 * نص شارة الخصم مباشرةً من `discount_percent` الخلفي (عدد صحيح). لا يُخفى
 * `0%` هنا؛ قرار العرض في `isDiscountBadgeVisible`.
 */
export function offerDiscountBadgeText(percent: number, locale: CustomizerLocale): string {
  const value = new Intl.NumberFormat(displayLocale(locale), { maximumFractionDigits: 0 }).format(percent);
  return locale === "en" ? `${value}% off` : `خصم ${value}%`;
}

/**
 * خصم حقيقي أدنى من نصف بالمئة يصل من الخادم بـ`0`. شارة «خصم 0%» نصٌّ
 * مضلِّل، فلا تُرسم الشارة له — السعران يبقيان ظاهرَين ويشرحان العرض.
 * القرار عرضيّ بحت: لا شيء يُعاد حسابه.
 */
export function isDiscountBadgeVisible(percent: number | null): percent is number {
  return percent !== null && percent > 0;
}

const REASON_KEYS: Record<KnownOfferReason, CustomizerMessageKey> = {
  inactive: "offersReason_inactive",
  scheduled: "offersReason_scheduled",
  expired: "offersReason_expired",
  product_unavailable: "offersReason_product_unavailable",
  variant_managed: "offersReason_variant_managed",
  not_discounted: "offersReason_not_discounted",
  price_unresolved: "offersReason_price_unresolved",
  out_of_stock: "offersReason_out_of_stock",
  fulfillment_not_configured: "offersReason_fulfillment_not_configured",
  availability_unresolved: "offersReason_availability_unresolved",
};

/** مفتاح ترجمة سبب الحجب؛ سببٌ مستقبليٌّ غير معروف يسقط على نصٍّ صادق عام. */
export function offerReasonMessageKey(reason: string | null): CustomizerMessageKey {
  return isKnownOfferReason(reason) ? REASON_KEYS[reason] : "offersReason_unknown";
}

/** الاسم المعروض للتاجر حسب لغة الواجهة، مع السقوط على الاسم الأصلي. */
export function offerDisplayName(offer: WorkspaceOffer, locale: CustomizerLocale): string | null {
  if (!offer.product) return null;
  return locale === "en" && offer.product.nameEn ? offer.product.nameEn : offer.product.name;
}
