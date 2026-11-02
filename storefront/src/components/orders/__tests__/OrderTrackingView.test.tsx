import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ar from "../../../../messages/ar.json";
import de from "../../../../messages/de.json";
import en from "../../../../messages/en.json";
import es from "../../../../messages/es.json";
import fr from "../../../../messages/fr.json";
import pl from "../../../../messages/pl.json";
import { OrderTrackingView } from "../OrderTrackingView";
import type { StorefrontOrderTracking } from "@/lib/commerce/order-tracking";

const LOCALES = { ar, de, en, es, fr, pl } as const;
const action = vi.fn();
vi.mock("@/lib/data/awj-order-tracking", () => ({ getOrderTrackingAction: (...a: unknown[]) => action(...a) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const tracking = (over: Partial<StorefrontOrderTracking> = {}): StorefrontOrderTracking => ({
  number: "CORD-77",
  status: "confirmed",
  deliveryMethod: "standard",
  placedAt: "2026-11-02T09:00:00+03:00",
  cancelledAt: null,
  schedule: null,
  fulfillment: null,
  expiresAt: "2027-01-31T09:00:00+00:00",
  ...over,
});

function view(locale: keyof typeof LOCALES = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={LOCALES[locale]}>
      <OrderTrackingView token="trk1.x.y.z" basePath="/sa/en" />
    </NextIntlClientProvider>,
  );
}

describe("OrderTrackingView (COPS-H2-5)", () => {
  beforeEach(() => action.mockReset());
  afterEach(cleanup);

  it("asks the server with the path token and renders the narrow projection", async () => {
    action.mockResolvedValue({ success: true, tracking: tracking() });
    view();
    await screen.findByText("CORD-77");
    expect(action).toHaveBeenCalledWith("trk1.x.y.z");
    expect(screen.getByText(/Anyone who has it can follow this order's progress/)).toBeTruthy();
  });

  it("lights the journey from the fulfilment block and says nothing about 'store does not publish tracking'", async () => {
    action.mockResolvedValue({
      success: true,
      tracking: tracking({
        fulfillment: { type: "local_delivery", stage: "out_for_delivery", stages: [{ key: "placed", at: null }, { key: "out_for_delivery", at: "2026-11-02T12:00:00+03:00" }], tracking: null, pickup: null },
      }),
    });
    const { container } = view();
    await screen.findByText("CORD-77");
    expect(container.querySelector('[data-fulfillment-stage="out_for_delivery"]')).not.toBeNull();
    expect(screen.queryByText(/does not publish shipment tracking/)).toBeNull();
  });

  it("without a block there is no misleading 'untracked' caption", async () => {
    action.mockResolvedValue({ success: true, tracking: tracking() });
    view();
    await screen.findByText("CORD-77");
    expect(screen.queryByText(/does not publish shipment tracking/)).toBeNull();
  });

  it("shows the cancellation notice for a cancelled order and no journey", async () => {
    action.mockResolvedValue({ success: true, tracking: tracking({ status: "cancelled", cancelledAt: "2026-11-03T10:00:00+03:00" }) });
    const { container } = view();
    await screen.findByText("This order was cancelled");
    expect(container.querySelector("ol")).toBeNull();
  });

  it("a uniform not-found says no more than 'not found' and offers no retry", async () => {
    action.mockResolvedValue({ success: false, reason: "not_found" });
    view();
    await screen.findByText("We couldn't find this order");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to the store" }).getAttribute("href")).toBe("/sa/en");
  });

  it("rate-limited and errors offer a retry that asks again", async () => {
    action.mockResolvedValueOnce({ success: false, reason: "rate_limited" }).mockResolvedValueOnce({ success: true, tracking: tracking() });
    view();
    await screen.findByText("Too many attempts");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("CORD-77");
    expect(action).toHaveBeenCalledTimes(2);

    cleanup();
    action.mockReset();
    action.mockResolvedValue({ success: false, reason: "error" });
    view();
    await screen.findByText("Tracking is unavailable right now");
  });

  it("never renders customer-identifying data (the projection has none to render)", async () => {
    action.mockResolvedValue({ success: true, tracking: tracking() });
    const { container } = view();
    await screen.findByText("CORD-77");
    expect(container.textContent).not.toMatch(/@|\+?\d{9,}/);
  });

  describe.each(Object.keys(LOCALES) as Array<keyof typeof LOCALES>)("%s", (locale) => {
    it("renders ready, not-found and limited states with real messages (no raw keys, no placeholders)", async () => {
      for (const result of [
        { success: true, tracking: tracking({ schedule: { date: "2026-11-05", label: "Evening", labelEn: null, start: "17:00", end: "20:00" } }) },
        { success: false, reason: "not_found" },
        { success: false, reason: "rate_limited" },
        { success: false, reason: "error" },
      ]) {
        action.mockResolvedValue(result);
        const { container, unmount } = view(locale);
        await waitFor(() => expect(container.querySelector('[role="status"]')).toBeNull());
        expect(container.textContent).not.toMatch(/orderTracking\.|\{date\}|\{/);
        unmount();
      }
    });

    it("has every orderTracking key", () => {
      for (const key of Object.keys(en.orderTracking)) {
        expect((LOCALES[locale].orderTracking as Record<string, unknown>)[key]).toBeTruthy();
      }
    });
  });
});
