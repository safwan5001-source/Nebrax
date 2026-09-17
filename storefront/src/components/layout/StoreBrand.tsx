import Link from "next/link";
import { cn } from "@/lib/utils";

interface StoreBrandProps {
  href: string;
  name: string;
  className?: string;
  /** Larger lockup for the desktop header row. */
  size?: "sm" | "md";
  /**
   * `dark` inverts the mark for the footer band, where the primary green has
   * almost no contrast against the surface it would sit on.
   */
  tone?: "default" | "dark";
}

/**
 * Derives the monogram from the merchant's own name. `Intl.Segmenter` is used
 * rather than `name[0]` because an Arabic name's first grapheme can be more than
 * one code unit, and slicing mid-grapheme renders a broken glyph.
 */
function monogram(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const segmenter = new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  });
  const [first] = segmenter.segment(trimmed);
  return first?.segment ?? trimmed.slice(0, 1);
}

/**
 * Store identity for the shell.
 *
 * The mark is the merchant's own initial on the primary surface, not invented
 * branding: the storefront has one `name` from AWJ and no logo asset, and a
 * wordmark alone reads as unfinished at the scale the header gives it. When the
 * Customizer can supply a real logo it replaces the mark without moving anything
 * around it.
 */
export function StoreBrand({
  href,
  name,
  className,
  size = "sm",
  tone = "default",
}: StoreBrandProps) {
  return (
    <Link
      href={href}
      className={cn("flex min-w-0 items-center gap-2.5", className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid shrink-0 place-items-center rounded-store font-bold",
          tone === "dark"
            ? "bg-store-footer-foreground text-store-primary"
            : "bg-store-primary text-store-primary-foreground",
          size === "md" ? "size-10 text-lg" : "size-8 text-base",
        )}
      >
        {monogram(name)}
      </span>
      <span
        className={cn(
          "min-w-0 truncate font-bold",
          tone === "dark"
            ? "text-store-footer-foreground"
            : "text-store-primary",
          size === "md" ? "text-xl" : "text-base",
        )}
      >
        <bdi>{name}</bdi>
      </span>
    </Link>
  );
}
