"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  SearchX,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatMinorAmount } from "@/lib/commerce/cart-types";
import type { AwjOnlinePayment } from "@/lib/commerce/online-payment";
import {
  clearPendingOnlinePayment,
  type PendingOnlinePayment,
  readPendingOnlinePayment,
} from "@/lib/commerce/pending-online-payment";
import {
  getOnlinePaymentStatusAction,
  type OnlinePaymentFailure,
  startOnlinePaymentAction,
} from "@/lib/data/awj-online-payment";

/**
 * PAY-H4-05 — the page the shopper lands on after the provider's hosted
 * payment page (and the page an online order is handed to right after it is
 * placed).
 *
 * **The browser's return is a doorbell, not a receipt.** Whatever the provider
 * put in the address bar (`?status=paid`, an id, a message) is never read.
 * The only thing this page believes is `GET …/payment-status`, which asks the
 * server, which asks the provider. A page that says "paid" without that would
 * be the most damaging untruth this storefront could tell.
 *
 * What it can show, and only these (a closed set mirrored from the API):
 * - `paid` — the server confirmed the capture. Thanks, and nothing else.
 * - `pending` — the provider page is still open or the confirmation has not
 *   reached us yet. Polls gently, then stops and offers a manual re-check.
 * - `under_review` — money was captured but the amount did not match; a person
 *   at the store will review it. Never "failed", never "paid".
 * - `awaiting_payment` / `failed` / `expired` / `cancelled` — retryable while
 *   the API says `can_retry`; otherwise a calm dead end with a way out.
 * - nothing known on this device — an honest "cannot identify your order".
 *
 * `?start=1` (set by the checkout right after placing the order) starts the
 * payment automatically exactly once and sends the shopper to the provider's
 * page; without it the page only reports and offers buttons.
 */

export const PAYMENT_RETURN_PATH = "/checkout/payment-return";

/** Poll cadence while the server says the payment is still pending. */
const POLL_INTERVAL_MS = 3000;
/** ~2 minutes, then stop hammering and let the shopper re-check by hand. */
const MAX_POLLS = 40;

type View =
  | { kind: "loading" }
  | { kind: "unknown" }
  | { kind: "starting" }
  | { kind: "payment"; payment: AwjOnlinePayment; slow: boolean }
  | { kind: "failure"; reason: OnlinePaymentFailure };

/** Only ever follow an https address the server handed back — never anything from the URL. */
function safeProviderUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

export function PaymentReturn({ basePath }: { basePath: string }) {
  const t = useTranslations("awjCheckout.paymentReturn");
  const [view, setView] = useState<View>({ kind: "loading" });
  const recordRef = useRef<PendingOnlinePayment | null>(null);
  const pollsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStartedRef = useRef(false);
  const mountedRef = useRef(true);
  // `refresh` and `startPayment` call each other; the ref breaks the hook-dependency cycle.
  const startPaymentRef = useRef<(() => Promise<void>) | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const goToProvider = useCallback((payment: AwjOnlinePayment): boolean => {
    const url = safeProviderUrl(payment.checkout_url);
    if (!url) return false;
    window.location.assign(url);
    return true;
  }, []);

  const refresh = useCallback(
    async (opts: { autoStart: boolean }) => {
      const record = recordRef.current;
      if (!record) return;
      const result = await getOnlinePaymentStatusAction(
        record.orderId,
        record.orderReference,
      );
      if (!mountedRef.current) return;

      if (!result.success) {
        if (result.reason === "not_found") {
          clearPendingOnlinePayment();
          recordRef.current = null;
          setView({ kind: "unknown" });
          return;
        }
        // Transient (provider/network): keep trying a few times, then say so.
        if (
          (result.reason === "provider_unavailable" ||
            result.reason === "error") &&
          pollsRef.current < MAX_POLLS
        ) {
          pollsRef.current += 1;
          setView((current) =>
            current.kind === "loading" ? current : { kind: "loading" },
          );
          timerRef.current = setTimeout(
            () => void refresh({ autoStart: opts.autoStart }),
            POLL_INTERVAL_MS,
          );
          return;
        }
        setView({ kind: "failure", reason: result.reason });
        return;
      }

      const { payment } = result;

      if (payment.status === "paid") {
        clearPendingOnlinePayment();
        stopPolling();
        setView({ kind: "payment", payment, slow: false });
        return;
      }

      if (payment.status === "pending") {
        pollsRef.current += 1;
        const slow = pollsRef.current >= MAX_POLLS;
        setView({ kind: "payment", payment, slow });
        if (!slow) {
          timerRef.current = setTimeout(
            () => void refresh({ autoStart: false }),
            POLL_INTERVAL_MS,
          );
        }
        return;
      }

      if (payment.status === "under_review") {
        stopPolling();
        setView({ kind: "payment", payment, slow: false });
        return;
      }

      // awaiting_payment | failed | expired | cancelled
      if (
        opts.autoStart &&
        !autoStartedRef.current &&
        payment.status === "awaiting_payment" &&
        payment.can_retry
      ) {
        autoStartedRef.current = true;
        await startPaymentRef.current?.();
        return;
      }
      setView({ kind: "payment", payment, slow: false });
    },
    [stopPolling],
  );

  const startPayment = useCallback(async () => {
    const record = recordRef.current;
    if (!record) return;
    stopPolling();
    setView({ kind: "starting" });
    const result = await startOnlinePaymentAction(
      record.orderId,
      record.orderReference,
    );
    if (!mountedRef.current) return;
    if (!result.success) {
      if (result.reason === "not_found") {
        clearPendingOnlinePayment();
        recordRef.current = null;
        setView({ kind: "unknown" });
        return;
      }
      setView({ kind: "failure", reason: result.reason });
      return;
    }
    if (result.payment.status === "paid") {
      clearPendingOnlinePayment();
      setView({ kind: "payment", payment: result.payment, slow: false });
      return;
    }
    if (goToProvider(result.payment)) {
      return; // leaving the page; keep the "starting" notice until the browser navigates
    }
    // No usable payment page (provider hiccup): fall back to the server's verdict.
    pollsRef.current = 0;
    await refresh({ autoStart: false });
  }, [goToProvider, refresh, stopPolling]);

  useEffect(() => {
    startPaymentRef.current = startPayment;
  }, [startPayment]);

  useEffect(() => {
    mountedRef.current = true;
    const record = readPendingOnlinePayment();
    recordRef.current = record;
    if (!record) {
      setView({ kind: "unknown" });
      return () => {
        mountedRef.current = false;
      };
    }
    const params = new URLSearchParams(window.location.search);
    const autoStart = params.get("start") === "1";
    if (autoStart) {
      // Strip it so a reload only reports (starting again is idempotent, but never surprising).
      window.history.replaceState(null, "", window.location.pathname);
    }
    void refresh({ autoStart });
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [refresh, stopPolling]);

  const recheck = useCallback(() => {
    stopPolling();
    pollsRef.current = 0;
    setView({ kind: "loading" });
    void refresh({ autoStart: false });
  }, [refresh, stopPolling]);

  const shop = (
    <Button asChild size="lg" variant="outline" className="mt-3">
      <Link href={`${basePath}/products`}>{t("continueShopping")}</Link>
    </Button>
  );

  if (view.kind === "loading" || view.kind === "starting") {
    const starting = view.kind === "starting";
    return (
      <Shell
        tone="neutral"
        icon={
          <Loader2 className="w-8 h-8 animate-spin motion-reduce:animate-none" />
        }
        title={starting ? t("startingTitle") : t("loadingTitle")}
        body={starting ? t("startingBody") : t("loadingBody")}
      />
    );
  }

  if (view.kind === "unknown") {
    return (
      <Shell
        tone="warning"
        icon={<SearchX className="w-8 h-8" />}
        title={t("unknownTitle")}
        body={t("unknownBody")}
      >
        {shop}
      </Shell>
    );
  }

  if (view.kind === "failure") {
    const unavailable =
      view.reason === "unavailable" || view.reason === "not_payable";
    return (
      <Shell
        tone="danger"
        icon={<AlertTriangle className="w-8 h-8" />}
        title={unavailable ? t("unavailableTitle") : t("errorTitle")}
        body={unavailable ? t("unavailableBody") : t("errorBody")}
      >
        {!unavailable ? (
          <Button size="lg" className="mt-6" onClick={recheck}>
            {t("checkAgain")}
          </Button>
        ) : null}
        {shop}
      </Shell>
    );
  }

  const { payment, slow } = view;
  const amount = formatMinorAmount(payment.amount);

  switch (payment.status) {
    case "paid":
      return (
        <Shell
          tone="success"
          icon={<CheckCircle2 className="w-8 h-8" />}
          title={t("paidTitle")}
          body={t("paidBody", { amount })}
        >
          {shop}
        </Shell>
      );
    case "under_review":
      return (
        <Shell
          tone="warning"
          icon={<ShieldCheck className="w-8 h-8" />}
          title={t("reviewTitle")}
          body={t("reviewBody")}
        >
          {shop}
        </Shell>
      );
    case "pending": {
      const url = safeProviderUrl(payment.checkout_url);
      return (
        <Shell
          tone="neutral"
          icon={
            slow ? (
              <Clock className="w-8 h-8" />
            ) : (
              <Loader2 className="w-8 h-8 animate-spin motion-reduce:animate-none" />
            )
          }
          title={slow ? t("slowTitle") : t("pendingTitle")}
          body={slow ? t("slowBody") : t("pendingBody")}
        >
          {slow ? (
            <Button size="lg" className="mt-6" onClick={recheck}>
              {t("checkAgain")}
            </Button>
          ) : null}
          {url ? (
            <Button
              size="lg"
              variant="outline"
              className="mt-3"
              onClick={() => window.location.assign(url)}
            >
              {t("reopenPayment")}
            </Button>
          ) : null}
        </Shell>
      );
    }
    default: {
      // awaiting_payment | failed | expired | cancelled
      const key =
        payment.status === "awaiting_payment"
          ? "awaiting"
          : payment.status === "expired"
            ? "expired"
            : payment.status === "cancelled"
              ? "cancelled"
              : "failed";
      return (
        <Shell
          tone={payment.status === "awaiting_payment" ? "neutral" : "danger"}
          icon={
            payment.status === "awaiting_payment" ? (
              <Clock className="w-8 h-8" />
            ) : (
              <XCircle className="w-8 h-8" />
            )
          }
          title={t(`${key}Title`)}
          body={t(`${key}Body`, { amount })}
        >
          {payment.can_retry ? (
            <Button
              size="lg"
              className="mt-6"
              onClick={() => void startPayment()}
            >
              {payment.status === "awaiting_payment"
                ? t("payNow")
                : t("tryAgain")}
            </Button>
          ) : null}
          {shop}
        </Shell>
      );
    }
  }
}

const TONES = {
  neutral: "bg-store-primary-soft text-store-primary",
  success: "bg-store-success/10 text-store-success",
  warning: "bg-store-warning/10 text-store-warning",
  danger: "bg-store-destructive/10 text-store-destructive",
} as const;

function Shell({
  tone,
  icon,
  title,
  body,
  children,
}: {
  tone: keyof typeof TONES;
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="awj-payment-return"
      className="mx-auto flex w-full max-w-lg flex-col items-center px-4 py-16 text-center sm:px-6 sm:py-20"
    >
      <span
        aria-hidden="true"
        className={`flex size-14 items-center justify-center rounded-full ${TONES[tone]}`}
      >
        {icon}
      </span>
      <h1 className="mt-5 text-xl font-bold text-store-foreground sm:text-2xl">
        {title}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-store-muted-foreground">
        {body}
      </p>
      <div className="flex w-full flex-col items-stretch sm:items-center">
        {children}
      </div>
    </div>
  );
}
