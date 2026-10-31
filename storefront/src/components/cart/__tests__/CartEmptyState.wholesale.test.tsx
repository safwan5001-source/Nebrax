import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import { CartEmptyState } from "../CartEmptyState";

function renderState(
  locale: "en" | "ar",
  accessIssue: Parameters<typeof CartEmptyState>[0]["accessIssue"],
) {
  const messages = locale === "en" ? en : ar;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <CartEmptyState basePath={`/sa/${locale}`} accessIssue={accessIssue} />
    </NextIntlClientProvider>,
  );
}

describe("CartEmptyState — wholesale standing (H6 Batch K)", () => {
  it("an ordinary empty cart is unchanged (no issue)", () => {
    renderState("en", null);
    expect(screen.getByRole("heading").textContent).toBe(en.cart.emptyCart);
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/sa/en/products",
    );
  });

  it("a signed-out buyer is told to sign in and linked to the buyer sign-in page", () => {
    renderState("en", "sign_in_required");
    expect(screen.getByRole("heading").textContent).toBe(
      en.wholesaleBuyer.gate.sign_in_required.title,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/sa/en/buyer/sign-in",
    );
  });

  it("a buyer who is not (or no longer) approved is linked to the membership page, in Arabic too", () => {
    renderState("ar", "approval_required");
    expect(screen.getByRole("heading").textContent).toBe(
      ar.wholesaleBuyer.gate.approval_required.title,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/sa/ar/buyer/membership",
    );
  });

  it("an unavailable line does not replace the cart view (it is explained on the line)", () => {
    renderState("en", "unavailable_for_wholesale");
    expect(screen.getByRole("heading").textContent).toBe(en.cart.emptyCart);
  });
});
