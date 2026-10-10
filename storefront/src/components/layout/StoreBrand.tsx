import Link from "next/link";
import { MediaImage } from "@/components/ui/media-image";
import type { MediaRef, ResolvedMedia } from "@/lib/presentation/media-ref";
import { sanitizeLogoUrl } from "@/lib/presentation/urls";
import { cn } from "@/lib/utils";

interface StoreBrandProps {
  href: string;
  name: string;
  className?: string;
  /** Larger setting for the desktop header row and the footer's identity line. */
  size?: "sm" | "md";
  /**
   * `dark` inverts the wordmark for the footer band, where the primary green
   * has almost no contrast against the surface it sits on.
   */
  tone?: "default" | "dark";
  /**
   * Optional merchant logo. Absent or unsafe values keep the typographic
   * fallback — AWJ corporate branding is never substituted.
   */
  logoUrl?: string | null;
  /**
   * CUST-HV V4a — the logo as a media-library reference, already resolved by
   * the server. Wins over `logoUrl` when present; the legacy value stays the
   * fallback so an unresolved reference never leaves the header empty.
   */
  logoMedia?: { ref: MediaRef; media: ResolvedMedia } | null;
  locale?: string;
  /**
   * CUST-HV V7a — the merchant's logo-size choice (`header.design.logo.size`). Absent ⇒ the
   * `size` preset exactly as before; present it replaces the logo height / wordmark size.
   */
  scale?: "sm" | "md" | "lg" | "xl";
}

/** Logo image height / wordmark size / image width cap per `scale` (literal for Tailwind). */
const SCALE = {
  sm: { img: "h-6 md:h-7", word: "text-lg md:text-xl", cap: "max-w-[7rem]" },
  md: { img: "h-8 md:h-9", word: "text-xl md:text-2xl", cap: "max-w-[9rem]" },
  lg: {
    img: "h-10 md:h-12",
    word: "text-2xl md:text-3xl",
    cap: "max-w-[11rem]",
  },
  xl: {
    img: "h-12 md:h-16",
    word: "text-3xl md:text-4xl",
    cap: "max-w-[14rem]",
  },
} as const;

/**
 * Store identity for the shell.
 *
 * Purely typographic by default, because AWJ gives the storefront a name and
 * no logo asset. A generated mark — an initial in a tile — dresses that gap
 * up as branding the merchant never chose. A wordmark set with intent is the
 * honest fallback.
 *
 * When the Customizer supplies a safe logo URL it replaces the wordmark
 * without the surrounding layout moving.
 */
export function StoreBrand({
  href,
  name,
  className,
  size = "sm",
  tone = "default",
  logoUrl,
  logoMedia = null,
  locale = "en",
  scale,
}: StoreBrandProps) {
  const safeLogo = sanitizeLogoUrl(logoUrl ?? null);
  const picked = scale ? SCALE[scale] : null;
  const capClass = picked ? picked.cap : "max-w-[9rem]";
  const heightClass = picked
    ? picked.img
    : size === "md"
      ? "h-8 md:h-9"
      : "h-7";

  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center",
        tone === "dark" ? "text-store-footer-foreground" : "text-store-primary",
        className,
      )}
    >
      {logoMedia ? (
        <MediaImage
          media={logoMedia.media}
          locale={locale}
          alt={logoMedia.ref.alt}
          fallbackAlt={name}
          fit={logoMedia.ref.fit}
          focal={logoMedia.ref.focal}
          // The brand is above the fold on every page: never lazy.
          loading="eager"
          sizes={
            picked
              ? "(min-width: 768px) 224px, 160px"
              : "(min-width: 768px) 144px, 112px"
          }
          className={cn("w-auto", capClass, heightClass)}
        />
      ) : safeLogo ? (
        // biome-ignore lint/performance/noImgElement: merchant logo is a runtime URL, not a static import
        <img
          src={safeLogo}
          alt={name}
          className={cn("w-auto", capClass, "object-contain", heightClass)}
        />
      ) : (
        <span
          className={cn(
            "min-w-0 truncate font-extrabold leading-none",
            picked
              ? picked.word
              : size === "md"
                ? "text-xl md:text-2xl"
                : "text-lg",
          )}
        >
          <bdi>{name}</bdi>
        </span>
      )}
    </Link>
  );
}
