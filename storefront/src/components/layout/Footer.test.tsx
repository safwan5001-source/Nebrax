import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
