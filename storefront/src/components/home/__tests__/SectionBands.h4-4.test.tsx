/**
 * CUST-H4-4 — focused parity/safety proof for Banner (imageAlt), Benefits,
 * and Custom Content. These sections were already confirmed LIVE in
 * CUST-H4-ARCH-1 §18–§20; this proves it with tests rather than churning
 * working code. Canvas-side mirror:
 * web/src/modules/store-experience-builder/__tests__/StorefrontPreviewCanvas.h4-4.test.tsx
 */
import { render, screen } from "@testing-library/react";
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

describe("BannerBand — imageAlt (CUST-H4-4)", () => {
  it("uses the merchant-authored imageAlt when present", () => {
    render(
      <BannerBand
        headingId="banner-1"
        basePath="/sa/ar"
        content={{
          title: "عرض الصيف",
          subtitle: "",
          ctaLabel: "",
          ctaHref: "",
          imageUrl: "https://example.com/banner.jpg",
          imageAlt: "صورة لمنتجات الصيف",
        }}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "alt",
      "صورة لمنتجات الصيف",
    );
  });

  it("stays decorative (empty alt) when imageAlt is absent — backward compatible with pre-H4-4 documents", () => {
    render(
      <BannerBand
        headingId="banner-1"
        basePath="/sa/ar"
        content={{
          title: "عرض الصيف",
          subtitle: "",
          ctaLabel: "",
          ctaHref: "",
          imageUrl: "https://example.com/banner.jpg",
        }}
      />,
    );
    // An empty alt makes the image presentational to assistive tech — it is
    // not exposed via the img role's accessible name, so it must be found
    // by tag instead.
    const img = document.querySelector("img") as HTMLImageElement;
    expect(img.alt).toBe("");
  });

  it("stays decorative when imageAlt is only whitespace", () => {
    render(
      <BannerBand
        headingId="banner-1"
        basePath="/sa/ar"
        content={{
          title: "عرض الصيف",
          subtitle: "",
          ctaLabel: "",
          ctaHref: "",
          imageUrl: "https://example.com/banner.jpg",
          imageAlt: "   ",
        }}
      />,
    );
    const img = document.querySelector("img") as HTMLImageElement;
    expect(img.alt).toBe("");
  });

  it("never renders a CTA for an unsafe href scheme, regardless of imageAlt", () => {
    render(
      <BannerBand
        headingId="banner-1"
        basePath="/sa/ar"
        content={{
          title: "عرض",
          subtitle: "",
          ctaLabel: "تسوّق",
          ctaHref: "javascript:alert(1)",
          imageUrl: null,
          imageAlt: "",
        }}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("BenefitsBand — completeness proof (CUST-H4-4)", () => {
  it("uses real list semantics, not decorative markup", () => {
    const { container } = render(
      <BenefitsBand
        headingId="benefits-1"
        title="مزايا المتجر"
        content={{
          items: [
            { id: "b1", title: "شحن مجاني", body: "لكل الطلبات" },
            { id: "b2", title: "دعم 24/7", body: "" },
          ],
        }}
      />,
    );
    expect(container.querySelector("ul")).toBeTruthy();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(
      screen.getByRole("heading", { name: "مزايا المتجر" }),
    ).toHaveAttribute("id", "benefits-1");
  });

  it("omits an item that has neither title nor body, never rendering an empty card", () => {
    const { container } = render(
      <BenefitsBand
        headingId="benefits-1"
        title="مزايا المتجر"
        content={{
          items: [
            { id: "b1", title: "", body: "" },
            { id: "b2", title: "ضمان الجودة", body: "" },
          ],
        }}
      />,
    );
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });
});

describe("CustomContentBand — safety proof (CUST-H4-4)", () => {
  it("never interprets authored text as HTML — a literal <script> tag renders as plain text, not markup", () => {
    const { container } = render(
      <CustomContentBand
        sectionId="cc-1"
        content={{
          blocks: [
            { id: "h1", kind: "heading", text: "<script>alert(1)</script>" },
          ],
        }}
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("renders nothing for an all-empty block list — no empty section markup", () => {
    const { container } = render(
      <CustomContentBand
        sectionId="cc-1"
        content={{ blocks: [{ id: "p1", kind: "paragraph", text: "   " }] }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
