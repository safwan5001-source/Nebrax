"use client";

import type { useTranslations } from "next-intl";
import { StageField, StageShell } from "@/components/checkout/awj/StageShell";
import type { GiftForm } from "@/components/checkout/awj/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { StorefrontGiftOptions } from "@/lib/commerce/checkout-gifting";

/**
 * Optional stage — "this order is a gift" (ADR-15).
 *
 * Four things stay separate, as in the API: the purchaser (already given in the
 * contact stage), the delivery recipient (name and, per the store's policy,
 * phone), the name shown on the card (never an account identity) and the card
 * message. The limits (message length, whether the sender may be hidden,
 * whether the recipient's phone is required) are the store's policy, read from
 * the checkout — not constants here. The message is plain text; the server
 * normalizes and bounds it again.
 */
export function GiftStage({
  gift,
  options,
  onChange,
  t,
}: {
  gift: GiftForm;
  options: StorefrontGiftOptions;
  onChange: (gift: GiftForm) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <StageShell
      id="awj-checkout-gift"
      title={t("gift.heading")}
      description={t("gift.description")}
    >
      <label className="flex cursor-pointer items-center gap-3 text-sm font-bold text-store-foreground">
        <Checkbox
          id="awj-gift-is-gift"
          checked={gift.isGift}
          onCheckedChange={(checked) =>
            onChange({ ...gift, isGift: checked === true })
          }
        />
        {t("gift.isGift")}
      </label>

      {gift.isGift && (
        <div className="mt-5 space-y-6" data-gift-fields="">
          <section aria-labelledby="awj-gift-recipient-heading">
            <h3
              id="awj-gift-recipient-heading"
              className="mb-3 text-sm font-bold text-store-foreground"
            >
              {t("gift.recipientHeading")}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <StageField
                id="awj-gift-recipient-name"
                label={t("gift.recipientName")}
              >
                <Input
                  id="awj-gift-recipient-name"
                  value={gift.recipientName}
                  maxLength={255}
                  onChange={(e) =>
                    onChange({ ...gift, recipientName: e.target.value })
                  }
                  autoComplete="off"
                  required
                />
              </StageField>
              <StageField
                id="awj-gift-recipient-phone"
                label={t("gift.recipientPhone")}
                hint={t("gift.recipientPhoneHint")}
              >
                <Input
                  id="awj-gift-recipient-phone"
                  type="tel"
                  inputMode="tel"
                  value={gift.recipientPhone}
                  maxLength={32}
                  onChange={(e) =>
                    onChange({ ...gift, recipientPhone: e.target.value })
                  }
                  autoComplete="off"
                  required={options.recipientPhoneRequired}
                />
              </StageField>
            </div>
          </section>

          <section aria-labelledby="awj-gift-sender-heading">
            <h3
              id="awj-gift-sender-heading"
              className="mb-3 text-sm font-bold text-store-foreground"
            >
              {t("gift.senderHeading")}
            </h3>
            <div className="space-y-3">
              <StageField
                id="awj-gift-sender-name"
                label={t("gift.senderName")}
                hint={t("gift.senderHint")}
              >
                <Input
                  id="awj-gift-sender-name"
                  value={gift.senderName}
                  maxLength={255}
                  disabled={options.allowHideSender && gift.hideSender}
                  onChange={(e) =>
                    onChange({ ...gift, senderName: e.target.value })
                  }
                  autoComplete="off"
                />
              </StageField>
              {options.allowHideSender && (
                <label className="flex cursor-pointer items-center gap-3 text-sm text-store-foreground">
                  <Checkbox
                    id="awj-gift-hide-sender"
                    checked={gift.hideSender}
                    onCheckedChange={(checked) =>
                      onChange({ ...gift, hideSender: checked === true })
                    }
                  />
                  {t("gift.hideSender")}
                </label>
              )}
            </div>
          </section>

          <StageField
            id="awj-gift-message"
            label={t("gift.message")}
            hint={t("gift.messageHint")}
          >
            <Textarea
              id="awj-gift-message"
              value={gift.message}
              rows={4}
              maxLength={options.messageMaxLength}
              onChange={(e) => onChange({ ...gift, message: e.target.value })}
            />
            <bdi className="mt-1 block text-end text-xs text-store-muted-foreground">
              {t("gift.messageCount", {
                count: gift.message.length,
                max: options.messageMaxLength,
              })}
            </bdi>
          </StageField>
        </div>
      )}
    </StageShell>
  );
}
