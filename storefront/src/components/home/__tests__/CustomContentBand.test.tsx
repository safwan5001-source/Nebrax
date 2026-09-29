import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CustomContentBand } from "@/components/home/CustomContentBand";

const faqBlocks = [
  { id: "q1", kind: "heading" as const, text: "كم مدة التوصيل؟" },
  { id: "a1", kind: "paragraph" as const, text: "خلال يومي عمل." },
  { id: "q2", kind: "heading" as const, text: "هل يمكن الاسترجاع؟" },
  { id: "a2", kind: "paragraph" as const, text: "نعم خلال 14 يوماً." },
];

describe("CustomContentBand — AWJ Market FAQ accordion", () => {
  it("renders multi-question content as a real disclosure under Market", () => {
    const { container, getAllByText } = render(
      <CustomContentBand
        sectionId="faq-1"
        content={{ blocks: faqBlocks }}
        themePreset="awj-market"
      />,
    );

    const details = container.querySelectorAll("details");
    expect(details).toHaveLength(2);
    // The exact merchant-authored text is used verbatim as the disclosure
    // trigger — nothing is fabricated or reworded.
    expect(getAllByText("كم مدة التوصيل؟")).toHaveLength(1);
    expect(getAllByText("هل يمكن الاسترجاع؟")).toHaveLength(1);
  });

  it("keeps a single-heading block as plain prose even under Market (not a one-item accordion)", () => {
    const { container } = render(
      <CustomContentBand
        sectionId="about-1"
        content={{
          blocks: [
            { id: "h1", kind: "heading", text: "من نحن" },
            { id: "p1", kind: "paragraph", text: "متجر تجريبي." },
          ],
        }}
        themePreset="awj-market"
      />,
    );
    expect(container.querySelectorAll("details")).toHaveLength(0);
    expect(container.querySelector("h2")).toBeTruthy();
  });

  it("keeps AWJ Modern as plain prose regardless of block count (no theme regression)", () => {
    const { container, getByText } = render(
      <CustomContentBand sectionId="faq-1" content={{ blocks: faqBlocks }} />,
    );
    expect(container.querySelectorAll("details")).toHaveLength(0);
    expect(getByText("كم مدة التوصيل؟").tagName).toBe("H2");
  });

  it("never drops or reorders authored text when grouping into an accordion", () => {
    const { container } = render(
      <CustomContentBand
        sectionId="faq-1"
        content={{ blocks: faqBlocks }}
        themePreset="awj-market"
      />,
    );
    expect(container.textContent).toContain("خلال يومي عمل.");
    expect(container.textContent).toContain("نعم خلال 14 يوماً.");
  });
});
