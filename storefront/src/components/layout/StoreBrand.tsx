import Link from "next/link";
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
}

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
}: StoreBrandProps) {
  const safeLogo = sanitizeLogoUrl(logoUrl ?? null);

  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center",
        tone === "dark" ? "text-store-footer-foreground" : "text-store-primary",
        className,
      )}
    >
      {safeLogo ? (
        // biome-ignore lint/performance/noImgElement: merchant logo is a runtime URL, not a static import
        <img
          src={safeLogo}
          alt={name}
          className={cn(
            "w-auto max-w-[9rem] object-contain",
            size === "md" ? "h-8 md:h-9" : "h-7",
          )}
        />
      ) : (
        <span
          className={cn(
            "min-w-0 truncate font-extrabold leading-none",
            size === "md" ? "text-xl md:text-2xl" : "text-lg",
          )}
        >
          <bdi>{name}</bdi>
        </span>
      )}
    </Link>
  );
}
