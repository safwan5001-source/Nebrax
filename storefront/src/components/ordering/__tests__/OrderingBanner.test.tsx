import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrderingBanner } from "@/components/ordering/OrderingBanner";
import type { AwjOrdering } from "@/lib/commerce/ordering";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";

const paused = (over: Partial<AwjOrdering> = {}): AwjOrdering => ({
  accepting: false,
  reason: "paused",
  message: null,
  resumesAt: null,
  minOrderMinor: null,
  minOrderScope: "all",
  ...over,
});

const outsideHours: AwjOrdering = {
  accepting: false,
  reason: "outside_hours",
  message: null,
  resumesAt: null,
  minOrderMinor: null,
  minOrderScope: "all",
};

function withIntl(locale: "ar" | "en", ui: React.ReactElement) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "ar" ? ar : en}
    >
      {ui}
    </NextIntlClientProvider>
  );
}

describe("OrderingBanner (COPS-H4 Buyer Ordering UX)", () => {
  it("renders nothing while the store is accepting orders", () => {
    const { container } = render(
      withIntl(
        "en",
        <OrderingBanner
          ordering={{ ...outsideHours, accepting: true, reason: null }}
        />,
      ),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says in English that the store is paused, that browsing still works, and that existing orders are untouched", () => {
    render(withIntl("en", <OrderingBanner ordering={paused()} />));

    const region = screen.getByRole("region", {
      name: "The store is not taking new orders right now",
    });
    expect(region).toHaveAttribute("data-ordering-banner", "paused");
    expect(
      within(region).getByText(/keep browsing and fill your cart/),
    ).toBeInTheDocument();
    expect(
      within(region).getByText(
        /does not affect orders you have already placed — pausing new orders does not cancel or change them/,
      ),
    ).toBeInTheDocument();
  });

  it("says it in Arabic too, including the reassurance about existing orders", () => {
    render(withIntl("ar", <OrderingBanner ordering={paused()} />));

    const region = screen.getByRole("region", {
      name: "المتجر لا يستقبل طلبات جديدة حالياً",
    });
    expect(
      within(region).getByText(/يمكنك تصفّح المتجر وتجهيز سلتك/),
    ).toBeInTheDocument();
    expect(
      within(region).getByText(/هذا لا يؤثر على الطلبات التي قدّمتها سابقاً/),
    ).toBeInTheDocument();
  });

  it("explains outside-opening-hours differently from a pause", () => {
    render(withIntl("en", <OrderingBanner ordering={outsideHours} />));

    const region = screen.getByRole("region", {
      name: "The store is outside its opening hours",
    });
    expect(region).toHaveAttribute("data-ordering-banner", "outside_hours");
    expect(
      within(region).getByText(/place your order during opening hours/),
    ).toBeInTheDocument();
  });

  it("shows the merchant's note as escaped plain text, direction-isolated, with an accessible label", () => {
    const note = "<img src=x onerror=alert(1)> نغلق للصيانة";
    render(
      withIntl("en", <OrderingBanner ordering={paused({ message: note })} />),
    );

    const text = screen.getByText(note, { exact: false });
    expect(text.closest("p")).toHaveAttribute("dir", "auto");
    // No element was created from the note's markup.
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("Note from the store:")).toHaveClass("sr-only");
  });

  it("shows the scheduled resume as a machine-readable <time> in the shopper's locale once on the client", () => {
    const iso = "2026-11-09T14:00:00+00:00";
    render(
      withIntl("en", <OrderingBanner ordering={paused({ resumesAt: iso })} />),
    );

    const time = document.querySelector("time");
    expect(time).not.toBeNull();
    expect(time).toHaveAttribute("datetime", iso);
    expect(time?.textContent).toMatch(/2026/);
    expect(
      screen.getByText(/Orders resume automatically on/),
    ).toBeInTheDocument();
  });

  // Hydration safety: the server has no idea of the shopper's time zone, so the server render must not print a time.
  it("does not print the buyer-local time in the server render (falls back to the generic line)", () => {
    const html = renderToString(
      withIntl(
        "en",
        <OrderingBanner
          ordering={paused({ resumesAt: "2026-11-09T14:00:00+00:00" })}
        />,
      ),
    );
    expect(html).not.toContain("<time");
    expect(html).not.toContain("resume automatically");
    expect(html).toContain("keep browsing and fill your cart");
  });

  it("is a labelled region, not an alert — present on every page load without interrupting a screen reader", () => {
    render(withIntl("en", <OrderingBanner ordering={paused()} />));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("region")).toHaveAccessibleName();
  });

  it("is purely informational: no button, no link, nothing to disable", () => {
    render(
      withIntl("en", <OrderingBanner ordering={paused({ message: "x" })} />),
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("supports the inline card variant used inside the checkout", () => {
    render(
      withIntl("en", <OrderingBanner ordering={paused()} variant="card" />),
    );
    expect(screen.getByRole("region").className).toMatch(/rounded-store/);
  });
});
