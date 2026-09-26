import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SBC_SEAL_SCRIPT_URL } from "./SbcSeal";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/lib/spree", () => ({ isWholesaleEnabled: () => false }));

import { Footer } from "./Footer";

const baseProps = {
  basePath: "",
  locale: "ar" as Locale,
  categoryLinks: null,
  storeName: "متجر الاختبار",
};

describe("Footer SBC presentation", () => {
  it("keeps the text-only fallback when no seal token is configured", async () => {
    const view = await Footer({
      ...baseProps,
      showSbc: true,
      sbcSealToken: "",
    });
    const screen = render(view);

    expect(screen.getByText("sbcVerified")).toBeTruthy();
    expect(screen.queryByTestId("sbc-official-seal")).toBeNull();
  });

  it("renders the official container path only when a seal token is configured", async () => {
    const view = await Footer({
      ...baseProps,
      showSbc: true,
      sbcSealToken: "official-token",
    });
    const screen = render(view);

    expect(screen.getByTestId("sbc-official-seal")).toHaveAttribute(
      "data-token",
      "official-token",
    );
    expect(screen.getByTestId("sbc-text-fallback")).toHaveTextContent(
      "sbcVerified",
    );
  });

  it("loads the official seal script on the public storefront when enabled and a token exists", async () => {
    const view = await Footer({
      ...baseProps,
      showSbc: true,
      sbcSealToken: "official-token",
    });
    const screen = render(view);

    expect(screen.getByTestId("sbc-official-seal")).toHaveAttribute(
      "data-token",
      "official-token",
    );
    await waitFor(() =>
      expect(
        document.querySelector(`script[src="${SBC_SEAL_SCRIPT_URL}"]`),
      ).not.toBeNull(),
    );
    expect(document.getElementById("awj-sbc-seal-loader")).toHaveAttribute(
      "src",
      SBC_SEAL_SCRIPT_URL,
    );
    expect(screen.queryByTestId("sbc-seal-preview")).toBeNull();
  });

  it("renders canonical identity and a separate merchant license", async () => {
    const view = await Footer({
      ...baseProps,
      businessIdentity: {
        legal_name: "شركة النور",
        cr_number: "7050247977",
        vat_number: null,
      },
      licenseNumber: "LIC-42",
    });
    const screen = render(view);

    expect(screen.getByText("legalName: شركة النور")).toBeTruthy();
    expect(screen.getByText("crNumber: 7050247977")).toBeTruthy();
    expect(screen.queryByText(/vatNumber/)).toBeNull();
    expect(screen.getByText("merchantProvided")).toBeTruthy();
    expect(screen.getByText("licenseNumber: LIC-42")).toBeTruthy();
  });

  it("opens the published WhatsApp link in a new tab without sending a message", async () => {
    const view = await Footer({
      ...baseProps,
      whatsappHref: "https://wa.me/966500000000",
    });
    const screen = render(view);
    const link = screen.getByRole("link", { name: "whatsapp" });

    expect(link.getAttribute("href")).toBe("https://wa.me/966500000000");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("names a published social link and opens it in a new tab", async () => {
    const view = await Footer({
      ...baseProps,
      socialLinks: [
        { id: "ig", network: "instagram", href: "https://instagram.com/awj" },
      ],
    });
    const screen = render(view);
    const link = screen.getByRole("link", { name: "socialInstagram" });

    expect(link.getAttribute("href")).toBe("https://instagram.com/awj");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByRole("link", { name: "instagram" })).toBeNull();
  });

  it("omits the merchant-provided group when the license is blank", async () => {
    const view = await Footer({
      ...baseProps,
      licenseNumber: "   ",
    });
    const screen = render(view);

    expect(screen.queryByText("merchantProvided")).toBeNull();
    expect(screen.queryByText("businessInformation")).toBeNull();
  });

  it("renders no SBC presentation when the merchant turns it off", async () => {
    const view = await Footer({
      ...baseProps,
      showSbc: false,
      sbcSealToken: "official-token",
    });
    const screen = render(view);

    expect(screen.queryByTestId("sbc-official-seal")).toBeNull();
    expect(screen.queryByText("sbcVerified")).toBeNull();
  });
});
