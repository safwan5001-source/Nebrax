"use client";

import { Check, Copy, MapPin } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { issueTrackingLinkAction } from "@/lib/data/awj-order-tracking";

/**
 * COPS-H2-5 — offers the guest tracking link on the order confirmation, **only when the API issues one**. The gate being
 * closed (404) or any failure renders nothing: the confirmation stays exactly what it was. The order reference is the credential
 * that proves ownership; it is passed to the server action and never rendered, logged or placed in a URL.
 */
export function OrderTrackingLinkCard({
  orderId,
  orderReference,
  basePath,
}: {
  orderId: string;
  orderReference: string | null | undefined;
  basePath: string;
}) {
  const t = useTranslations("orderTracking");
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!orderReference) return;
    let cancelled = false;
    void issueTrackingLinkAction(orderId, orderReference).then((result) => {
      if (!cancelled && result.success) setToken(result.token);
    });
    return () => {
      cancelled = true;
    };
  }, [orderId, orderReference]);

  if (!token) return null;

  const path = `${basePath}/track/${token}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section
      aria-labelledby="awj-tracking-link"
      className="mt-6 rounded-store border border-store-border bg-store-surface p-5"
    >
      <h2
        id="awj-tracking-link"
        className="flex items-center gap-2 text-sm font-bold text-store-foreground"
      >
        <MapPin className="size-4" aria-hidden="true" />
        {t("linkTitle")}
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-store-muted-foreground">
        {t("linkBody")}
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href={path}>{t("linkOpen")}</Link>
        </Button>
        <Button type="button" variant="ghost" onClick={() => void copy()}>
          {copied ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
          <span role="status">{copied ? t("linkCopied") : t("linkCopy")}</span>
        </Button>
      </div>
    </section>
  );
}
