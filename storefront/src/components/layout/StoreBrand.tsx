import Link from "next/link";
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
}

/**
 * Store identity for the shell.
 *
 * Purely typographic, because AWJ gives the storefront a name and no logo
 * asset. A generated mark — an initial in a tile — dresses that gap up as
 * branding the merchant never chose, and reads as a placeholder precisely
 * because it is one. A wordmark set with intent is the honest fallback and the
 * one real merchants use before their logo exists.
 *
 * When the Customizer can supply a logo it replaces this without the
 * surrounding layout moving.
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
      className={cn(
        "min-w-0 truncate font-extrabold leading-none",
        tone === "dark" ? "text-store-footer-foreground" : "text-store-primary",
        size === "md" ? "text-xl md:text-2xl" : "text-lg",
        className,
      )}
    >
      <bdi>{name}</bdi>
    </Link>
  );
}
