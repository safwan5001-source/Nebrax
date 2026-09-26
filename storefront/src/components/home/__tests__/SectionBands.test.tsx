import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BannerBand } from "../BannerBand";
import { BenefitsBand } from "../BenefitsBand";
import { CustomContentBand } from "../CustomContentBand";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const token = "AwjUnbrokenToken".repeat(6);

describe("customizer section bands", () => {
  it("wraps an unbroken banner title instead of letting it define the width", () => {
    const { container } = render(
      <BannerBand
        headingId="banner-1"
        basePath="/sa/ar"
        content={{
          title: token.slice(0, 120),
          subtitle: token.slice(0, 80),
          ctaLabel: "تسوق",
          ctaHref: "https://example.com/roses",
          imageUrl: null,
        }}
      />,
    );
    const title = container.querySelector("h2");
    expect(title?.className).toContain("break-words");
    expect(title?.textContent).toContain("AwjUnbrokenToken");
  });

  it("lets a long benefit sit in a shrinkable grid cell", () => {
    const { container } = render(
      <BenefitsBand
        headingId="benefits-1"
        title="مزايا المتجر"
        content={{
          items: [
            { id: "b1", title: token.slice(0, 80), body: token.slice(0, 200) },
          ],
        }}
      />,
    );
    expect(container.querySelector("li")?.className).toContain("min-w-0");
    expect(container.querySelector("li p")?.className).toContain("break-words");
  });

  it("wraps a long custom-content paragraph", () => {
    const { container } = render(
      <CustomContentBand
        sectionId="custom-1"
        content={{
          blocks: [
            { id: "h1", kind: "heading", text: token.slice(0, 120) },
            { id: "p1", kind: "paragraph", text: token.slice(0, 600) },
          ],
        }}
      />,
    );
    expect(container.querySelector("section")?.className).toContain(
      "break-words",
    );
    expect(container.querySelector("p")?.className).toContain("break-words");
  });
});
