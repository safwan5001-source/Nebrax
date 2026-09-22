"use client";

/**
 * COM-CHECKOUT-1C wiring, STORE-UI-4 presentation — the AWJ-native checkout.
 *
 * Wires the AWJ cart to the AWJ Checkout V1 backend end to end: create/resume →
 * contact → address → delivery → payment (inert) → authoritative review →
 * idempotent completion → confirmation. This is storefront wiring only. No
 * pricing, shipping or payment logic lives here, and every purchase-affecting
 * value — line prices, line totals, subtotal, delivery amount, order total — is
 * read verbatim from the server's response and never computed, summed or
 * remembered client-side as a source of truth.
 *
 * Deliberately NOT the Spree `(checkout)` route group's `CheckoutProvider` /
 * `CheckoutContext`: this is a fully separate AWJ-native flow (no cart id in the
 * URL, no Spree state machine) per AWJ_CHECKOUT_V1_ARCHITECTURE.md. The
 * architecture test beside this file enforces that boundary.
 *
 * ## Why the stages are sequential
 *
 * Each stage owns one endpoint and saves on its own "continue"
 * (`PATCH checkout/contact`, `/address`, `/delivery`), so the server holds a
 * complete stage or none of it. The review stage then reads back what the
 * server actually stored rather than what the forms hold — which is how a save
 * that silently failed shows up as missing instead of as confirmed.
 *
 * The payment stage calls nothing, because there is nothing to call. It is
 * present and visibly inert; see `PaymentStage`.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { awjCartLineView, CartLine } from "@/components/cart/CartLine";
import { CartSummary } from "@/components/cart/CartSummary";
import { AddressStage } from "@/components/checkout/awj/AddressStage";
import { AwjOrderConfirmation } from "@/components/checkout/awj/Confirmation";
import { ContactStage } from "@/components/checkout/awj/ContactStage";
import { DeliveryStage } from "@/components/checkout/awj/DeliveryStage";
import { PaymentStage } from "@/components/checkout/awj/PaymentStage";
import { ReviewStage } from "@/components/checkout/awj/ReviewStage";
import {
  type AddressForm,
  CHECKOUT_STAGES,
  type CheckoutStage,
  type ContactForm,
  EMPTY_ADDRESS,
  EMPTY_CONTACT,
} from "@/components/checkout/awj/types";
import { CheckoutProgress } from "@/components/checkout/CheckoutProgress";
import { Button } from "@/components/ui/button";
import { useCartLineImages } from "@/hooks/useCartLineImages";
import { formatMinorAmount } from "@/lib/commerce/cart-types";
import {
  clearPersistedIdempotencyKey,
  resolveIdempotencyKey,
} from "@/lib/commerce/checkout-idempotency";
import {
  AWJ_DELIVERY_METHODS,
  type AwjDeliveryMethod,
  type AwjReviewIssue,
  type StorefrontCheckout,
  type StorefrontOrder,
} from "@/lib/commerce/checkout-types";
import {
  completeAwjCheckoutAction,
  getAwjCheckoutIdentity,
  startOrResumeAwjCheckout,
  updateAwjAddress,
  updateAwjContact,
  updateAwjDelivery,
} from "@/lib/data/awj-checkout";
import { extractBasePath } from "@/lib/utils/path";

/** The states the flow can be in that are not one of the six stages. */
type FlowState = "loading" | "empty" | "unavailable" | "stage" | "done";

function toContactForm(checkout: StorefrontCheckout): ContactForm {
  return {
    name: checkout.contact.name ?? "",
    phone: checkout.contact.phone ?? "",
    email: checkout.contact.email ?? "",
  };
}

function toAddressForm(checkout: StorefrontCheckout): AddressForm {
  const address = checkout.delivery.address;
  return {
    country: address.country ?? "",
    region: address.region ?? "",
    city: address.city ?? "",
    district: address.district ?? "",
    street: address.street ?? "",
    postalCode: address.postal_code ?? "",
    notes: address.notes ?? "",
  };
}

export function AwjCheckoutFlow() {
  const t = useTranslations("awjCheckout");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const basePath = extractBasePath(pathname);

  const [flowState, setFlowState] = useState<FlowState>("loading");
  const [stage, setStage] = useState<CheckoutStage>("contact");
  const [checkout, setCheckout] = useState<StorefrontCheckout | null>(null);
  const [order, setOrder] = useState<StorefrontOrder | null>(null);
  const [contact, setContact] = useState<ContactForm>(EMPTY_CONTACT);
  const [address, setAddress] = useState<AddressForm>(EMPTY_ADDRESS);
  const [deliveryMethod, setDeliveryMethod] =
    useState<AwjDeliveryMethod | null>(null);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reviewIssues, setReviewIssues] = useState<AwjReviewIssue[]>([]);

  // One Idempotency-Key per checkout *attempt*, persisted in localStorage
  // scoped to this checkout's identity (see `checkout-idempotency.ts`) so it
  // survives a reload — not just a re-render or a retry within one mount.
  // Resolved inside `initialize()` (never during render: `localStorage` does
  // not exist during SSR) before the visitor can reach the place-order button.
  const idempotencyKeyRef = useRef<string | null>(null);
  const checkoutIdentityRef = useRef<string | null>(null);

  const initialize = useCallback(async () => {
    setFlowState("loading");
    const identity = await getAwjCheckoutIdentity();
    checkoutIdentityRef.current = identity;
    idempotencyKeyRef.current = resolveIdempotencyKey(identity);

    const result = await startOrResumeAwjCheckout();
    if (!result.success) {
      setFlowState("unavailable");
      return;
    }
    const nextCheckout = result.checkout;
    if (nextCheckout.cart.items.length === 0) {
      setFlowState("empty");
      return;
    }
    setCheckout(nextCheckout);
    setContact(toContactForm(nextCheckout));
    setAddress(toAddressForm(nextCheckout));
    setDeliveryMethod(
      AWJ_DELIVERY_METHODS.includes(
        nextCheckout.delivery.method as AwjDeliveryMethod,
      )
        ? (nextCheckout.delivery.method as AwjDeliveryMethod)
        : null,
    );
    setStage("contact");
    setFlowState("stage");
  }, []);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const goTo = useCallback((next: CheckoutStage) => {
    setFormError(null);
    setStage(next);
    // A stage change is a screen change on a phone; the shopper should land at
    // the top of the new stage, not halfway down where the previous one ended.
    // Guarded on actually being scrolled, so an already-top page never asks the
    // browser (or a test environment) to scroll nowhere.
    if (typeof window !== "undefined" && window.scrollY > 0) {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }, []);

  /**
   * Saves the current stage to its own endpoint, then advances. A failure keeps
   * the shopper on the stage with the server's message — it never advances past
   * something the server refused.
   */
  const saveAndAdvance = useCallback(
    async (from: CheckoutStage, to: CheckoutStage) => {
      setFormError(null);
      setSaving(true);
      try {
        if (from === "contact") {
          const result = await updateAwjContact({
            name: contact.name.trim(),
            phone: contact.phone.trim(),
            email: contact.email.trim() ? contact.email.trim() : null,
          });
          if (!result.success) {
            setFormError(result.error);
            return;
          }
          setCheckout(result.checkout);
        } else if (from === "address") {
          const result = await updateAwjAddress({
            country: address.country.trim(),
            region: address.region.trim() ? address.region.trim() : null,
            city: address.city.trim(),
            district: address.district.trim() ? address.district.trim() : null,
            street: address.street.trim(),
            postal_code: address.postalCode.trim()
              ? address.postalCode.trim()
              : null,
            notes: address.notes.trim() ? address.notes.trim() : null,
          });
          if (!result.success) {
            setFormError(result.error);
            return;
          }
          setCheckout(result.checkout);
        } else if (from === "delivery") {
          if (!deliveryMethod) return;
          // The only argument is the method. There is no amount parameter,
          // here or in the client — the delivery amount is the server's alone.
          const result = await updateAwjDelivery(deliveryMethod);
          if (!result.success) {
            setFormError(result.error);
            return;
          }
          setCheckout(result.checkout);
        }
        goTo(to);
      } finally {
        setSaving(false);
      }
    },
    [contact, address, deliveryMethod, goTo],
  );

  const handleComplete = useCallback(async () => {
    if (!idempotencyKeyRef.current) return;
    setCompleting(true);
    setFormError(null);
    try {
      const result = await completeAwjCheckoutAction(idempotencyKeyRef.current);
      if (result.success) {
        // Confirmed success only — never cleared on review_required,
        // idempotency_conflict or a transient error, all of which must keep the
        // same persisted key so a retry (or a reload after a lost response)
        // still replays correctly if this attempt actually landed server-side.
        if (checkoutIdentityRef.current !== null) {
          clearPersistedIdempotencyKey(checkoutIdentityRef.current);
        }
        setOrder(result.order);
        setStage("confirmation");
        setFlowState("done");
        return;
      }

      if (result.kind === "review_required") {
        setReviewIssues(result.items);
        setCheckout(result.checkout);
        setContact(toContactForm(result.checkout));
        setAddress(toAddressForm(result.checkout));
        // A contact gap sends the shopper back to the contact stage and a
        // missing delivery method to the delivery stage; a cart-content issue
        // (availability, price, stock) keeps them on review, where the
        // refreshed lines — now carrying up-to-date `available` flags — are
        // what explains the change.
        const reasons = new Set(result.items.map((issue) => issue.reason));
        if (reasons.has("contact_incomplete")) {
          goTo("contact");
        } else if (reasons.has("delivery_method_missing")) {
          goTo("delivery");
        } else if (reasons.has("empty_cart")) {
          setFlowState("empty");
        }
        return;
      }

      if (result.kind === "not_found") {
        setFlowState("unavailable");
        return;
      }

      // Includes `idempotency_conflict`: the shopper is told, and the key is
      // deliberately kept so a genuine replay still works.
      setFormError(result.message);
    } finally {
      setCompleting(false);
    }
  }, [goTo]);

  const reviewIssueMessages = useMemo(
    () =>
      reviewIssues.map((issue) => {
        const item = checkout?.cart.items.find((i) => i.id === issue.item_id);
        const reasonKey = `reviewRequired.reasons.${issue.reason}` as const;
        const reasonText = t.has(reasonKey)
          ? t(reasonKey)
          : t("reviewRequired.reasons.unknown");
        return item
          ? t("reviewRequired.itemIssue", {
              name: item.name,
              reason: reasonText,
            })
          : reasonText;
      }),
    [reviewIssues, checkout, t],
  );

  const steps = useMemo(
    () =>
      CHECKOUT_STAGES.map((key) => ({
        key,
        label: t(`steps.${key}`),
      })),
    [t],
  );

  const stageIndex = CHECKOUT_STAGES.indexOf(stage);

  const lineImages = useCartLineImages(
    checkout?.cart.items.map((line) => line.productId) ?? [],
    flowState === "stage",
  );

  if (flowState === "loading") {
    return <CheckoutSkeleton />;
  }

  if (flowState === "empty") {
    return (
      <CheckoutNotice
        title={t("emptyCartTitle")}
        body={t("emptyCartDescription")}
        actionHref={`${basePath}/products`}
        actionLabel={tc("continueShopping")}
      />
    );
  }

  if (flowState === "unavailable") {
    return (
      <CheckoutNotice
        title={t("unavailableTitle")}
        body={t("unavailableDescription")}
        actionHref={`${basePath}/cart`}
        actionLabel={t("returnToCart")}
      />
    );
  }

  if (flowState === "done" && order) {
    return <AwjOrderConfirmation order={order} basePath={basePath} />;
  }

  if (!checkout) {
    return null;
  }

  const contactReady = Boolean(contact.name.trim() && contact.phone.trim());
  const addressReady = Boolean(
    address.country.trim() && address.city.trim() && address.street.trim(),
  );

  return (
    <div className="mx-auto w-full max-w-store px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <h1 className="sr-only">{t("title")}</h1>

      <CheckoutProgress
        steps={steps}
        currentIndex={stageIndex}
        counterLabel={t("stepCounter", {
          current: stageIndex + 1,
          total: steps.length,
        })}
      />

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        <div className="space-y-5">
          {reviewIssueMessages.length > 0 && (
            <div
              role="alert"
              className="rounded-store border border-store-warning/50 bg-store-warning/10 p-4"
            >
              <p className="text-sm font-bold text-store-foreground">
                {t("reviewRequired.title")}
              </p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-store-foreground">
                {reviewIssueMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}

          {stage === "contact" && (
            <ContactStage contact={contact} onChange={setContact} t={t} />
          )}
          {stage === "address" && (
            <AddressStage address={address} onChange={setAddress} t={t} />
          )}
          {stage === "delivery" && (
            <DeliveryStage
              method={deliveryMethod}
              onChange={setDeliveryMethod}
              t={t}
            />
          )}
          {stage === "payment" && <PaymentStage t={t} />}
          {stage === "review" && (
            <ReviewStage checkout={checkout} onEdit={goTo} t={t} />
          )}

          {formError && (
            <p
              role="alert"
              className="rounded-store border border-store-destructive/40 bg-store-destructive/10 px-4 py-3 text-sm text-store-destructive"
            >
              {formError}
            </p>
          )}

          <StageActions
            stage={stage}
            saving={saving}
            completing={completing}
            contactReady={contactReady}
            addressReady={addressReady}
            deliveryMethod={deliveryMethod}
            onBack={goTo}
            onAdvance={saveAndAdvance}
            onComplete={handleComplete}
            t={t}
            tc={tc}
          />
        </div>

        <CartSummary
          subtotal={checkout.cart.subtotal}
          itemCount={checkout.cart.itemCount}
          showCoupon={false}
          sticky
          deliveryLabel={
            // COM-MOBILE-SHIPPING-1: `checkout.delivery.amount` is now a
            // real, server-committed figure once a method is saved
            // (`ShippingRateService`, no longer a hardcoded 0). Only shown
            // once the saved method matches the current draft selection —
            // an unsaved draft change has no confirmed amount yet.
            checkout.delivery.method &&
            checkout.delivery.method === deliveryMethod
              ? `${t(`delivery.methods.${checkout.delivery.method}`)} · ${formatMinorAmount(checkout.delivery.amount)}`
              : deliveryMethod
                ? `${t(`delivery.methods.${deliveryMethod}`)} · ${t("delivery.amountPending")}`
                : null
          }
        >
          <ul className="divide-y divide-store-border">
            {checkout.cart.items.map((line) => (
              <li key={line.id}>
                <CartLine
                  view={awjCartLineView(
                    line,
                    basePath,
                    line.productId ? lineImages[line.productId] : null,
                  )}
                  density="summary"
                />
              </li>
            ))}
          </ul>
        </CartSummary>
      </div>
    </div>
  );
}

function StageActions({
  stage,
  saving,
  completing,
  contactReady,
  addressReady,
  deliveryMethod,
  onBack,
  onAdvance,
  onComplete,
  t,
  tc,
}: {
  stage: CheckoutStage;
  saving: boolean;
  completing: boolean;
  contactReady: boolean;
  addressReady: boolean;
  deliveryMethod: AwjDeliveryMethod | null;
  onBack: (stage: CheckoutStage) => void;
  onAdvance: (from: CheckoutStage, to: CheckoutStage) => void;
  onComplete: () => void;
  t: ReturnType<typeof useTranslations>;
  tc: ReturnType<typeof useTranslations>;
}) {
  const back: Partial<Record<CheckoutStage, CheckoutStage>> = {
    address: "contact",
    delivery: "address",
    payment: "delivery",
    review: "payment",
  };
  const previous = back[stage];

  const primary = (() => {
    switch (stage) {
      case "contact":
        return {
          label: t("continueToAddress"),
          disabled: !contactReady,
          onClick: () => onAdvance("contact", "address"),
        };
      case "address":
        return {
          label: t("continueToDelivery"),
          disabled: !addressReady,
          onClick: () => onAdvance("address", "delivery"),
        };
      case "delivery":
        return {
          label: t("continueToPayment"),
          disabled: !deliveryMethod,
          onClick: () => onAdvance("delivery", "payment"),
        };
      case "payment":
        // Nothing to save: the stage is inert by design.
        return {
          label: t("continueToReview"),
          disabled: false,
          onClick: () => onAdvance("payment", "review"),
        };
      default:
        return null;
    }
  })();

  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      {previous ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => onBack(previous)}
          disabled={saving || completing}
        >
          {tc("back")}
        </Button>
      ) : (
        <span aria-hidden="true" className="hidden sm:block" />
      )}

      {stage === "review" ? (
        <Button
          type="button"
          size="lg"
          className="sm:min-w-56"
          onClick={onComplete}
          disabled={completing}
        >
          {completing ? tc("processing") : t("completeOrder")}
        </Button>
      ) : (
        primary && (
          <Button
            type="button"
            size="lg"
            className="sm:min-w-56"
            onClick={primary.onClick}
            disabled={saving || primary.disabled}
          >
            {saving ? tc("saving") : primary.label}
          </Button>
        )
      )}
    </div>
  );
}

function CheckoutNotice({
  title,
  body,
  actionHref,
  actionLabel,
}: {
  title: string;
  body: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-20 text-center sm:px-6">
      <h1 className="text-xl font-bold text-store-foreground sm:text-2xl">
        {title}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-store-muted-foreground">
        {body}
      </p>
      <Button asChild size="lg" className="mt-6">
        <Link href={actionHref}>{actionLabel}</Link>
      </Button>
    </div>
  );
}

function CheckoutSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto w-full max-w-store animate-pulse px-4 py-6 sm:px-6 lg:px-8 lg:py-10 motion-reduce:animate-none"
    >
      <div className="h-6 w-full rounded bg-store-surface-muted" />
      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        <div className="h-80 rounded-store border border-store-border bg-store-surface" />
        <div className="h-64 rounded-store border border-store-border bg-store-surface" />
      </div>
    </div>
  );
}
