import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BenefitsBand } from "../BenefitsBand";

const content = {
  items: [
    {
      id: "a",
      title: "Free delivery",
      body: "Over 200",
      icon: "truck" as const,
    },
    { id: "b", title: "Secure", body: "", icon: "shield-check" as const },
    { id: "c", title: "Plain", body: "No icon" },
  ],
};

const band = (layout?: "flat" | "columns-2" | "columns-3" | "columns-4") =>
  render(
    <BenefitsBand
      content={content}
      headingId="b-1"
      title="Why us"
      designed
      layout={layout}
    />,
  );

describe("BenefitsBand — CUST-HV V9b", () => {
  it("draws an icon only for items that have one, decoratively, before the text", () => {
    const { container } = band();
    const items = container.querySelectorAll("[data-benefit-item]");
    expect(items).toHaveLength(3);
    expect(items[0].querySelector("[data-benefit-icon] svg")).not.toBeNull();
    expect(
      items[0]
        .querySelector("[data-benefit-icon] svg")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(items[2].querySelector("[data-benefit-icon]")).toBeNull();
    // icon precedes the text in DOM order (start edge in both directions)
    expect(items[0].firstElementChild?.hasAttribute("data-benefit-icon")).toBe(
      true,
    );
  });

  it("an unknown icon key draws nothing but keeps the text (fail-closed)", () => {
    const { container, getByText } = render(
      <BenefitsBand
        content={{
          items: [{ id: "a", title: "X", body: "", icon: "nope" as never }],
        }}
        headingId="b-1"
        title="t"
      />,
    );
    expect(getByText("X")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("absent layout = cards in automatic columns (today's look)", () => {
    const { container } = band();
    expect(
      container.querySelector("section")?.getAttribute("data-benefits"),
    ).toBe("auto");
    const ul = container.querySelector("ul");
    expect(ul?.className).toContain("lg:grid-cols-3");
    expect(container.querySelector("li")?.className).toContain(
      "border-store-border",
    );
  });

  it.each([
    ["columns-2", "sm:grid-cols-2", "lg:grid-cols-"],
    ["columns-3", "lg:grid-cols-3", "lg:grid-cols-4"],
    ["columns-4", "lg:grid-cols-4", "lg:grid-cols-3"],
  ] as const)("%s fixes the wide-screen column count", (layout, has, hasNot) => {
    const { container } = band(layout);
    const cls = container.querySelector("ul")?.className ?? "";
    expect(cls).toContain(has);
    if (layout !== "columns-2") expect(cls).not.toContain(hasNot);
    else expect(cls).not.toContain(hasNot);
    // phones are always one column: no unprefixed grid-cols
    expect(cls).not.toMatch(/(^| )grid-cols-/);
    // still cards
    expect(container.querySelector("li")?.className).toContain(
      "border-store-border",
    );
  });

  it("flat drops the card frame but keeps icon, text and the grid", () => {
    const { container } = band("flat");
    const li = container.querySelector("li");
    expect(li?.className).not.toContain("border");
    expect(li?.className).not.toContain("bg-store-surface");
    expect(li?.querySelector("[data-benefit-icon]")).not.toBeNull();
    expect(container.querySelector("ul")?.className).toContain(
      "lg:grid-cols-3",
    );
  });
});
