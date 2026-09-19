"use client";

import { TicketPercent } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { COUPON_CAPABILITY } from "@/lib/commerce/capabilities";

/**
 * Promotion / discount code entry.
 *
 * **DESIGN_ONLY** — see `COUPON_CAPABILITY`. AWJ `store/v1` has no coupon
 * route, and the cart payload has no discount field, so this field cannot
 * apply anything and never pretends to.
 *
 * What it does: collects a code and, on submit, says that promotions are not
 * enabled for this store yet. What it must never do: report a code as accepted,
 * show a discount row, change a displayed amount, or persist the code anywhere.
 * The typed value lives in component state for the life of the page, as the
 * design-first policy §3 requires of an inert control — no cookie, no
 * `localStorage`.
 *
 * It exists now so the cart and checkout summaries keep their shape when the
 * contract lands: activation replaces `handleSubmit`'s body with the real
 * mutation and flips `COUPON_CAPABILITY`, and no layout moves.
 */
export function CouponField({ className }: { className?: string }) {
  const t = useTranslations("cart");
  const inputId = useId();
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const live = COUPON_CAPABILITY === "live";

  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        if (!code.trim()) return;
        // No request is made: there is nothing to call. The shopper is told
        // the truth rather than shown a spinner that resolves to a lie.
        setNotice(t("coupon.unavailable"));
      }}
    >
      <label
        htmlFor={inputId}
        className="flex items-center gap-1.5 text-xs font-semibold text-store-foreground"
      >
        <TicketPercent className="size-3.5 text-store-muted-foreground" />
        {t("coupon.label")}
      </label>
      <div className="mt-2 flex gap-2">
        <Input
          id={inputId}
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setNotice(null);
          }}
          placeholder={t("coupon.placeholder")}
          autoComplete="off"
          spellCheck={false}
          className="h-10 flex-1 uppercase placeholder:normal-case"
          aria-describedby={notice ? `${inputId}-notice` : undefined}
        />
        <Button
          type="submit"
          variant="outline"
          className="h-10 shrink-0"
          disabled={!code.trim()}
        >
          {t("coupon.apply")}
        </Button>
      </div>
      {notice && (
        <p
          id={`${inputId}-notice`}
          role="status"
          className="mt-2 text-xs text-store-muted-foreground"
        >
          {notice}
        </p>
      )}
      {!live && !notice && (
        <p className="mt-2 text-xs text-store-muted-foreground">
          {t("coupon.notEnabledHint")}
        </p>
      )}
    </form>
  );
}
