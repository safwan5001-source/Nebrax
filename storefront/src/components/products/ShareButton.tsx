"use client";

import { Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

interface ShareButtonProps {
  title: string;
  className?: string;
}

/**
 * AWJ Market PDP affordance (see the coverage matrix's PDP evidence). Shares
 * the page the shopper is already on — no product data of any kind is
 * gathered, sent, or fabricated. Prefers the platform share sheet where the
 * browser exposes one (`navigator.share`, the normal case on phones, which
 * is also where sharing is actually used); falls back to copying the URL,
 * confirmed the same way `CartContext` already confirms other outcomes.
 */
export function ShareButton({ title, className }: ShareButtonProps) {
  const t = useTranslations("products");

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        // AbortError on a cancelled share sheet is normal user behavior,
        // not a failure to report.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("linkCopied"));
    } catch {
      // No share sheet and no clipboard permission: nothing left to do
      // honestly succeed at.
    }
  };

  return (
    <button
      type="button"
      aria-label={t("share")}
      onClick={handleShare}
      className={className}
    >
      <Share2 className="size-4" aria-hidden="true" />
    </button>
  );
}
