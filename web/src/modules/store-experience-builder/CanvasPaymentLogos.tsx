import { paymentBrandPresentation } from "@/lib/payment-brand-registry";
import { cn } from "@/lib/utils";
import type {
  FooterPaymentLogos,
  FooterPaymentLogoSize,
} from "./presentation/payment-logos";

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

/** Preview twin of the published footer's display-only payment marks. */
export function CanvasPaymentLogos({
  settings,
  title,
  locale,
  align = "start",
}: {
  settings: FooterPaymentLogos | undefined;
  title: string;
  locale: "ar" | "en";
  align?: "start" | "center" | "end";
}) {
  if (!settings?.enabled || settings.brands.length === 0) return null;
  const brands = settings.brands
    .map((key) => paymentBrandPresentation(key))
    .filter((brand) => brand !== null);
  if (brands.length === 0) return null;

  const list = (
    <ul
      className={cn(
        "flex items-center gap-2",
        settings.style === "strip" ? "w-max min-w-full flex-nowrap" : "flex-wrap",
        align === "center" && "justify-center",
        align === "end" && "justify-end",
      )}
    >
      {brands.map((brand) => (
        <li
          key={brand.key}
          className={cn(
            "flex shrink-0 items-center justify-center",
            settings.style === "cards" &&
              `rounded-store border border-black/10 bg-white ${CARD_PADDING[settings.size]}`,
          )}
        >
          <img
            src={brand.logo.src}
            alt={locale === "ar" ? brand.nameAr : brand.nameEn}
            width={brand.logo.width}
            height={brand.logo.height}
            className={cn(IMAGE_SIZE[settings.size], "w-auto max-w-none object-contain")}
          />
        </li>
      ))}
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
        <h2 className="mb-3 text-sm font-bold text-store-footer-foreground">{title}</h2>
      ) : null}
      {settings.style === "strip" ? (
        <div className={cn("max-w-full overflow-x-auto rounded-store bg-white", CARD_PADDING[settings.size])}>
          {list}
        </div>
      ) : list}
    </section>
  );
}
