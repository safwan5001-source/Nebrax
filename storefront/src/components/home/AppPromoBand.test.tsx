import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppPromoBand } from "./AppPromoBand";

const labels = {
  title: "App",
  appStoreLabel: "App Store",
  playStoreLabel: "Google Play",
  locale: "en",
  appName: "AWJ",
};

describe("AppPromoBand", () => {
  it("renders nothing when neither store URL is allow-listed", () => {
    const { container } = render(
      <AppPromoBand
        {...labels}
        iosUrl="https://www.apple.com/iphone"
        androidUrl="https://example.com/app"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one official badge when only one URL is valid", () => {
    render(
      <AppPromoBand
        {...labels}
        iosUrl=""
        androidUrl="https://play.google.com/store/apps/details?id=sa.awj"
      />,
    );
    const image = screen.getByRole("img", { name: "Google Play" });
    expect(image).toHaveAttribute("src", expect.stringContaining("en_badge"));
    expect(image).toHaveClass("h-10");
    expect(image.closest("a")).toHaveAttribute("target", "_blank");
    expect(screen.queryByRole("img", { name: "App Store" })).toBeNull();
  });

  it("uses the Arabic publisher badges for ar", () => {
    render(
      <AppPromoBand
        {...labels}
        locale="ar"
        iosUrl="https://apps.apple.com/app/id1"
        androidUrl="https://play.google.com/store/apps/details?id=sa.awj"
      />,
    );
    expect(screen.getByRole("img", { name: "App Store" })).toHaveAttribute(
      "src",
      expect.stringContaining("/ar-sa?"),
    );
    expect(screen.getByRole("img", { name: "Google Play" })).toHaveAttribute(
      "src",
      expect.stringContaining("/ar_badge_web_generic.png"),
    );
  });
});
