"use client";

import { Loader2, SearchX } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { AccountOrderStatus } from "@/components/account/AccountOrderStatus";
import { Button } from "@/components/ui/button";
import type { StorefrontOrderTracking } from "@/lib/commerce/order-tracking";
import {
  getOrderTrackingAction,
  type TrackingFailure,
} from "@/lib/data/awj-order-tracking";

/**
 * COPS-H2-5 — the guest tracking page body. The token (from the path) is the only credential; the server answers a
 * uniform "not found" for anything wrong with it, and this page says no more than that. It shows the narrow projection
 * only — never names, addresses, items or prices — because the link may be shared with the recipient of a gift.
 */
function formatDate(value: string | null, locale: string, withTime = false): string | null {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    }).format(new Date(value));
  } catch {
    return null;
  }
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; tracking: StorefrontOrderTracking }
  | { kind: "failed"; reason: TrackingFailure };

export function OrderTrackingView({
  token,
  basePath,
}: {
  token: string;
  basePath: string;
}) {
  const t = useTranslations("orderTracking");
  const locale = useLocale();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const result = await getOrderTrackingAction(token);
    setState(
      result.success
        ? { kind: "ready", tracking: result.tracking }
        : { kind: "failed", reason: result.reason },
    );
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") {
    return (
      <div
        role="status"
        className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-16 text-center text-store-muted-foreground"
      >
        <Loader2 className="size-6 animate-spin" aria-hidden="true" />
        <p className="mt-3 text-sm">{t("loading")}</p>
      </div>
    );
  }

  if (state.kind === "failed") {
    const notFound = state.reason === "not_found";
    const limited = state.reason === "rate_limited";
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-16 text-center">
        <SearchX className="size-8 text-store-muted-foreground" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-bold text-store-foreground">
          {notFound ? t("notFoundTitle") : limited ? t("rateLimitedTitle") : t("errorTitle")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-store-muted-foreground">
          {notFound ? t("notFoundBody") : limited ? t("rateLimitedBody") : t("errorBody")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {!notFound && (
            <Button type="button" variant="outline" onClick={() => void load()}>
              {t("retry")}
            </Button>
          )}
          <Button asChild>
            <Link href={basePath || "/"}>{t("backToStore")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const { tracking } = state;
  const placed = formatDate(tracking.placedAt, locale);
  const expires = formatDate(tracking.expiresAt, locale);
  const scheduleDate = tracking.schedule ? formatDate(tracking.schedule.date, locale) : null;
  const methodKey = tracking.deliveryMethod === "pickup" ? "pickup" : "standard";

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6">
      <header>
        <p className="text-xs font-medium text-store-muted-foreground">{t("title")}</p>
        <h1 className="mt-1 text-xl font-bold text-store-foreground">
          <span className="text-sm font-normal text-store-muted-foreground">
            {t("orderNumber")}{" "}
          </span>
          <bdi>{tracking.number}</bdi>
        </h1>
        <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-store-muted-foreground">
          {placed && <span>{t("placedOn", { date: placed })}</span>}
          {tracking.deliveryMethod && <span>{t(`method.${methodKey}`)}</span>}
        </p>
        {scheduleDate && (
          <p className="mt-1 text-sm text-store-foreground">
            {t("scheduled", {
              date: [scheduleDate, tracking.schedule?.label].filter(Boolean).join(" · "),
            })}
          </p>
        )}
      </header>

      <div className="mt-6">
        <AccountOrderStatus
          status={tracking.status}
          cancelledDate={formatDate(tracking.cancelledAt, locale)}
          fulfillment={tracking.fulfillment}
          showUntrackedCaption={false}
        />
      </div>

      {expires && (
        <p className="mt-8 text-xs leading-relaxed text-store-muted-foreground">
          {t("expiresNote", { date: expires })}
        </p>
      )}
    </div>
  );
}
