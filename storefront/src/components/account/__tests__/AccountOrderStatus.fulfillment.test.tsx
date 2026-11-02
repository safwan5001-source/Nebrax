import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { AccountOrderStatus } from "../AccountOrderStatus";
import { mapOrderFulfillment, type AwjOrderFulfillment } from "@/lib/commerce/checkout-types";
import ar from "../../../../messages/ar.json";
import de from "../../../../messages/de.json";
import en from "../../../../messages/en.json";
import es from "../../../../messages/es.json";
import fr from "../../../../messages/fr.json";
import pl from "../../../../messages/pl.json";

/**
 * COPS-H2-4 — the order journey driven only by the server `fulfillment` block, rendered with the **real** message files in all six shipped
 * languages (the AWJ market exposes only ar/en routes; de/es/fr/pl are verified here). No key echoes, no raw `{date}`, no reason/attempt leak.
 */
const LOCALES = { ar, de, en, es, fr, pl } as const;

const raw = (over: Partial<AwjOrderFulfillment> = {}): AwjOrderFulfillment => ({
  type: "local_delivery",
  stage: "preparing",
  stages: [
    { key: "placed", at: "2026-11-02T09:00:00+03:00" },
    { key: "preparing", at: "2026-11-02T10:00:00+03:00" },
  ],
  tracking: null,
  pickup: null,
  ...over,
});

function view(locale: keyof typeof LOCALES, fulfillment: AwjOrderFulfillment | null, status = "confirmed") {
  return render(
    <NextIntlClientProvider locale={locale} messages={LOCALES[locale]}>
      <AccountOrderStatus status={status} fulfillment={fulfillment ? mapOrderFulfillment(fulfillment) : null} />
    </NextIntlClientProvider>,
  );
}

const lit = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("ol > li"))
    .filter((li) => li.querySelector("span")?.className.includes("bg-store-primary"))
    .map((li) => li.querySelector("p")?.textContent);

describe("AccountOrderStatus with a fulfillment block (COPS-H2-4)", () => {
  it("lights placed + preparing for a preparing order and shows no 'not published' caption", () => {
    const { container } = view("en", raw());
    expect(lit(container)).toEqual(["Placed", "Preparing"]);
    expect(screen.queryByText(/does not publish shipment tracking/)).toBeNull();
  });

  it("lights the delivery path up to the delivered step", () => {
    const { container } = view("en", raw({ stage: "delivered", stages: [{ key: "placed", at: null }, { key: "delivered", at: "2026-11-02T14:00:00+03:00" }] }));
    expect(lit(container)).toEqual(["Placed", "Preparing", "On the way", "Delivered"]);
  });

  it("uses ready/picked-up steps for a pickup order and shows when it became ready", () => {
    const { container } = view("en", raw({ type: "pickup", stage: "ready", pickup: { ready_at: "2026-11-02T13:00:00+03:00" }, stages: [{ key: "placed", at: null }, { key: "ready", at: "2026-11-02T13:00:00+03:00" }] }));
    expect(lit(container)).toEqual(["Placed", "Preparing", "Ready for pickup"]);
    expect(screen.getByText(/Ready for pickup since/)).toBeTruthy();
    expect(screen.queryByText("Delivered")).toBeNull();
  });

  it("a failed attempt keeps 'on the way' lit, never reads as delivered, and says nothing about the reason", () => {
    const { container } = view("en", raw({ stage: "delivery_attempt_failed", stages: [{ key: "placed", at: null }, { key: "out_for_delivery", at: "2026-11-02T12:00:00+03:00" }, { key: "delivery_attempt_failed", at: "2026-11-02T13:00:00+03:00" }] }));
    expect(lit(container)).toEqual(["Placed", "Preparing", "On the way"]);
    const notice = screen.getByRole("status");
    expect(within(notice).getByText("The last delivery attempt was not completed")).toBeTruthy();
    expect(container.textContent).not.toMatch(/address|absent|refused|unreachable|attempt\s*\d/i);
  });

  it("shows carrier tracking with a safe external link", () => {
    view("en", raw({ type: "carrier", stage: "out_for_delivery", tracking: { carrier: "SMSA", number: "T-1", url: "https://track.example.test/T-1" } }));
    const link = screen.getByRole("link", { name: "Open tracking page" });
    expect(link.getAttribute("href")).toBe("https://track.example.test/T-1");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("SMSA")).toBeTruthy();
    expect(screen.getByText("T-1")).toBeTruthy();
  });

  it("never renders a non-https tracking link", () => {
    view("en", raw({ type: "carrier", stage: "out_for_delivery", tracking: { carrier: "SMSA", number: "T-1", url: "javascript:alert(1)" } }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("T-1")).toBeTruthy();
  });

  it("a cancelled order ignores any block and shows only the cancellation notice", () => {
    const { container } = view("en", raw({ stage: "out_for_delivery" }), "cancelled");
    expect(screen.getByText("This order was cancelled")).toBeTruthy();
    expect(container.querySelector("ol")).toBeNull();
  });

  it("without a block the legacy design: only 'placed' may light for a confirmed order, caption shown", () => {
    const { container } = view("en", null);
    expect(lit(container)).toEqual(["Placed"]);
    expect(screen.getByText(/does not publish shipment tracking/)).toBeTruthy();
  });

  it("an unreadable block falls back to the legacy design instead of inventing progress", () => {
    const { container } = view("en", raw({ stage: "teleported" }));
    expect(lit(container)).toEqual(["Placed"]);
  });

  describe.each(Object.keys(LOCALES) as Array<keyof typeof LOCALES>)("%s", (locale) => {
    const messages = LOCALES[locale].orders.timeline;

    it("renders every fulfilment state in this language with no raw key or placeholder", () => {
      const cases: AwjOrderFulfillment[] = [
        raw(),
        raw({ stage: "delivered" }),
        raw({ stage: "delivery_attempt_failed" }),
        raw({ type: "pickup", stage: "ready", pickup: { ready_at: "2026-11-02T13:00:00+03:00" } }),
        raw({ type: "pickup", stage: "picked_up" }),
        raw({ type: "carrier", stage: "out_for_delivery", tracking: { carrier: "SMSA", number: "T-1", url: "https://t.example.test/1" } }),
      ];
      for (const fulfillment of cases) {
        const { container, unmount } = view(locale, fulfillment);
        const text = container.textContent ?? "";
        expect(text).not.toMatch(/timeline\.|orders\.|\{date\}|\{/);
        unmount();
      }
    });

    it("has every new key translated (non-empty, not copied from English except proper nouns)", () => {
      for (const key of ["readyForPickup", "pickedUp", "attemptFailedTitle", "attemptFailedBody", "trackingTitle", "trackingCarrier", "trackingNumber", "trackingOpen", "pickupReady"] as const) {
        expect(messages[key]).toBeTruthy();
        if (locale !== "en") expect(messages[key]).not.toBe(en.orders.timeline[key]);
      }
      expect(messages.pickupReady).toContain("{date}");
    });
  });
});
