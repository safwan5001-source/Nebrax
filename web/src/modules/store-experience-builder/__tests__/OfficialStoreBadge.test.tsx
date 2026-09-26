/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OfficialStoreBadge } from "../OfficialStoreBadge";

describe("OfficialStoreBadge", () => {
  it("renders the Arabic publisher badges only for allow-listed URLs", () => {
    const { rerender } = render(
      <OfficialStoreBadge
        store="apple"
        href="https://www.apple.com/iphone"
        locale="ar"
        label="App Store"
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();

    rerender(
      <OfficialStoreBadge
        store="apple"
        href="https://apps.apple.com/app/id1"
        locale="ar"
        label="App Store"
      />,
    );
    const apple = screen.getByRole("img", { name: "App Store" });
    expect(apple.getAttribute("src")).toContain("/ar-sa?");
    expect(apple.className).toContain("h-10");
    expect(apple.closest("a")?.getAttribute("target")).toBeNull();

    rerender(
      <OfficialStoreBadge
        store="google"
        href="https://play.google.com/store/apps/details?id=sa.awj"
        locale="en"
        label="Google Play"
      />,
    );
    expect(
      screen.getByRole("img", { name: "Google Play" }).getAttribute("src"),
    ).toContain("/en_badge_web_generic.png");
  });
});
