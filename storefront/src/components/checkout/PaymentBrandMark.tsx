import Image from "next/image";
import { PAYMENT_BRAND_ASSETS } from "@/components/layout/FooterPaymentLogos";
import type { FooterPaymentLogoKey } from "@/lib/presentation/payment-logos";
import { cn } from "@/lib/utils";

/**
 * Checkout payment-method mark. Reuses the footer's approved brand assets
 * (`PAYMENT_BRAND_ASSETS`, synced from `web/public/payment-brands`) so there is
 * one source of logo files. It lives outside `checkout/awj/` on purpose: the
 * checkout stages name no scheme in source (see the architecture guard) and
 * pass only the server-sent key.
 *
 * The mark sits on the same always-light surface the footer uses, so it reads
 * in both themes and both directions. Decorative (`alt=""`): the localized
 * method name is rendered next to it.
 */
export function isPaymentBrandKey(
  key: string | undefined,
): key is FooterPaymentLogoKey {
  return (
    key !== undefined &&
    Object.prototype.hasOwnProperty.call(PAYMENT_BRAND_ASSETS, key)
  );
}

export function PaymentBrandMark({
  brand,
  className,
}: {
  brand: FooterPaymentLogoKey;
  className?: string;
}) {
  const asset = PAYMENT_BRAND_ASSETS[brand];
  return (
    <span
      data-payment-brand={brand}
      className={cn(
        "awj-payment-brand-surface flex h-8 w-12 shrink-0 items-center justify-center rounded-store border px-1",
        className,
      )}
    >
      <Image
        src={asset.src}
        alt=""
        width={asset.width}
        height={asset.height}
        unoptimized
        className="h-5 w-auto max-w-full object-contain"
      />
    </span>
  );
}
