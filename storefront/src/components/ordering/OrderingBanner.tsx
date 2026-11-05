"use client";

import { Clock, Pause } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useSyncExternalStore } from "react";
import { storeContainerClassName } from "@/components/layout/StoreContainer";
import type { AwjOrdering } from "@/lib/commerce/ordering";
import { cn } from "@/lib/utils";

/**
 * COPS-H4 Buyer Ordering UX — the store-wide notice shown while the store is not taking new orders.
 *
 * Rendered by the storefront layout only when `data.ordering.accepting === false`; with the deployment gate closed the
 * block is absent and nothing renders, so the shell is exactly what it was before.
 *
 * **Informational, not a gate.** The shopper can still browse and fill a cart; whether an order is accepted is decided by
 * Checkout on the server, which refuses before writing anything. This notice never disables, hides or redirects.
 *
 * It states, in one place, the three things a shopper needs: that the store is not taking *new* orders (and why), when it
 * is expected back, and that orders already placed are untouched — the server's guard runs only at order creation, so
 * pausing never cancels or alters an existing order.
 *
 * Deliberately a labelled region, not `role="alert"`: it is present from page load on every page and must not interrupt a
 * screen reader. The merchant's note is plain text (escaped by React), direction-isolated with `dir="auto"` because the
 * merchant may write in a different language from the interface.
 */

const noopSubscribe = () => () => {};

/** `false` on the server and during hydration, `true` afterwards — keeps the buyer-local time out of the server render. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function formatInstant(iso: string, locale: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    // Gregorian regardless of locale (`ar` must not silently become Hijri); the shopper's own time zone, named, so the
    // instant reads unambiguously wherever they are.
    // Explicit fields: `dateStyle`/`timeStyle` cannot be combined with `timeZoneName` (the constructor throws).
    return new Intl.DateTimeFormat(`${locale}-u-ca-gregory`, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return null;
  }
}

interface OrderingBannerProps {
  ordering: AwjOrdering;
  /**
   * `bar` — full-width band under the storefront header (the default). `card` — a bordered block that sits inside a page's
   * own content measure (the checkout, whose shell has no category rail to hang a band from).
   */
  variant?: "bar" | "card";
  className?: string;
}

export function OrderingBanner({
  ordering,
  variant = "bar",
  className,
}: OrderingBannerProps) {
  const t = useTranslations("ordering");
  const locale = useLocale();
  const headingId = useId();
  const isClient = useIsClient();

  if (ordering.accepting || ordering.reason === null) return null;

  const paused = ordering.reason === "paused";
  const Icon = paused ? Pause : Clock;
  const resumes =
    paused && ordering.resumesAt && isClient
      ? formatInstant(ordering.resumesAt, locale)
      : null;

  return (
    <section
      aria-labelledby={headingId}
      data-ordering-banner={ordering.reason}
      className={cn(
        variant === "bar"
          ? "border-b border-store-warning/40 bg-store-warning/10"
          : "rounded-store border border-store-warning/40 bg-store-warning/10 p-4",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-start gap-3",
          variant === "bar" && cn(storeContainerClassName, "py-3"),
        )}
      >
        <Icon
          className="mt-0.5 size-5 shrink-0 text-store-warning"
          aria-hidden="true"
        />
        <div className="min-w-0 space-y-1 text-sm leading-relaxed">
          <h2 id={headingId} className="font-bold text-store-foreground">
            {paused ? t("banner.pausedTitle") : t("banner.outsideHoursTitle")}
          </h2>

          {paused && ordering.message ? (
            <p dir="auto" className="break-words text-store-foreground">
              <span className="sr-only">{t("banner.merchantNote")}: </span>
              {ordering.message}
            </p>
          ) : null}

          <p className="text-store-muted-foreground">
            {resumes && ordering.resumesAt
              ? t.rich("banner.resumesAt", {
                  time: () => (
                    <time
                      dateTime={ordering.resumesAt ?? undefined}
                      className="whitespace-nowrap font-medium text-store-foreground"
                    >
                      {resumes}
                    </time>
                  ),
                })
              : paused
                ? t("banner.pausedBrowse")
                : t("banner.outsideHoursBrowse")}
          </p>

          <p className="text-store-muted-foreground">
            {t("banner.existingOrders")}
          </p>
        </div>
      </div>
    </section>
  );
}
