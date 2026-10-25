import Image from "next/image";
import type {
  FooterPaymentLogoKey,
  FooterPaymentLogoSize,
  FooterPaymentLogos as FooterPaymentLogosConfig,
} from "@/lib/presentation/payment-logos";
import { cn } from "@/lib/utils";

export const PAYMENT_BRAND_ASSETS: Record<
  FooterPaymentLogoKey,
  { src: string; width: number; height: number; name: string }
> = {
  mada: {
    src: "/payment-brands/mada.svg",
    width: 38,
    height: 24,
    name: "mada",
  },
  visa: {
    src: "/payment-brands/visa.svg",
    width: 38,
    height: 24,
    name: "Visa",
  },
  mastercard: {
    src: "/payment-brands/mastercard.svg",
    width: 38,
    height: 24,
    name: "Mastercard",
  },
  apple_pay: {
    src: "/payment-brands/apple-pay.svg",
    width: 166,
    height: 106,
    name: "Apple Pay",
  },
};
const IMAGE_SIZE: Record<FooterPaymentLogoSize, string> = {
  sm: "h-5",
  md: "h-7",
  lg: "h-9",
};
const CARD_PADDING: Record<FooterPaymentLogoSize, string> = {
  sm: "px-2 py-1.5",
  md: "px-3 py-2",
  lg: "px-4 py-2.5",
};

/** Visual trust marks only. This component never reads or changes checkout payment methods. */
export function FooterPaymentLogos({
  settings,
  title,
  align = "start",
}: {
  settings: FooterPaymentLogosConfig | undefined;
  title: string;
  align?: "start" | "center" | "end";
}) {
  if (!settings?.enabled || settings.brands.length === 0) return null;
  const list = (
    <ul
      className={cn(
        "flex items-center gap-2",
        settings.style === "strip"
          ? "w-max min-w-full flex-nowrap"
          : "flex-wrap",
        align === "center" && "justify-center",
        align === "end" && "justify-end",
      )}
    >
      {settings.brands.map((key) => {
        const asset = PAYMENT_BRAND_ASSETS[key];
        return (
          <li
            key={key}
            className={cn(
              "flex shrink-0 items-center justify-center",
              settings.style === "cards" &&
                `awj-payment-brand-surface rounded-store border ${CARD_PADDING[settings.size]}`,
            )}
          >
            <Image
              src={asset.src}
              alt={asset.name}
              width={asset.width}
              height={asset.height}
              unoptimized
              className={cn(
                IMAGE_SIZE[settings.size],
                "w-auto max-w-none object-contain",
              )}
            />
          </li>
        );
      })}
    </ul>
  );

  return (
    <section
      data-footer-payment-logos=""
      data-payment-logo-style={settings.style}
      data-payment-logo-size={settings.size}
      aria-label={title}
      className={cn(
        "mt-8 min-w-0 border-t border-store-footer-border pt-6",
        align === "center" && "text-center",
        align === "end" && "text-end",
      )}
    >
      {settings.showTitle ? (
        <h2 className="mb-3 text-sm font-bold text-store-footer-foreground">
          {title}
        </h2>
      ) : null}
      {settings.style === "strip" ? (
        <div
          className={cn(
            "awj-payment-brand-surface max-w-full overflow-x-auto rounded-store",
            CARD_PADDING[settings.size],
          )}
        >
          {list}
        </div>
      ) : (
        list
      )}
    </section>
  );
}
