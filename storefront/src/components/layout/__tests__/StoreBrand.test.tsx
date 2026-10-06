import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreBrand } from "../StoreBrand";

describe("StoreBrand", () => {
  it("uses the typographic fallback when no logo is supplied", () => {
    render(<StoreBrand href="/sa/ar" name="متجر النور" />);
    expect(
      screen.getByRole("link", { name: "متجر النور" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders a safe merchant logo without substituting AWJ branding", () => {
    render(
      <StoreBrand
        href="/sa/ar"
        name="متجر النور"
        logoUrl="data:image/png;base64,iVBORw0KGgo="
      />,
    );
    const image = screen.getByRole("img", { name: "متجر النور" });
    expect(image).toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo=");
    expect(screen.queryByText("أَوْج")).not.toBeInTheDocument();
  });

  it("ignores an unsafe logo URL and keeps the wordmark", () => {
    render(
      <StoreBrand
        href="/sa/ar"
        name="متجر النور"
        logoUrl="javascript:alert(1)"
      />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("متجر النور")).toBeInTheDocument();
  });

  describe("media-library logo (V4a)", () => {
    const ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
    const logoMedia = {
      ref: { mediaId: ID, fit: "contain" as const },
      media: {
        width: 800,
        height: 300,
        decorative: false,
        alt: { ar: "شعار النور", en: "Al Noor logo" },
        sources: [
          {
            kind: "w" as const,
            width: 480,
            height: 180,
            format: "webp" as const,
            src: `/api/storefront/media/customizer/${ID}/480w.webp`,
          },
          {
            kind: "w" as const,
            width: 480,
            height: 180,
            format: "jpg" as const,
            src: `/api/storefront/media/customizer/${ID}/480w.jpg`,
          },
        ],
      },
    };

    it("wins over the legacy logo and is described in the visitor's language", () => {
      render(
        <StoreBrand
          href="/sa/ar"
          name="متجر النور"
          locale="en"
          logoUrl="data:image/png;base64,iVBORw0KGgo="
          logoMedia={logoMedia}
        />,
      );
      const image = screen.getByRole("img", { name: "Al Noor logo" });
      expect(image).toHaveAttribute(
        "src",
        `/api/storefront/media/customizer/${ID}/480w.jpg`,
      );
      expect(image).toHaveAttribute("loading", "eager");
      expect(image.style.objectFit).toBe("contain");
    });

    it("falls back to the store name when the usage has no alt for this locale", () => {
      render(
        <StoreBrand
          href="/sa/ar"
          name="متجر النور"
          locale="en"
          logoMedia={{
            ...logoMedia,
            media: { ...logoMedia.media, alt: { ar: "شعار", en: null } },
          }}
        />,
      );
      expect(
        screen.getByRole("img", { name: "متجر النور" }),
      ).toBeInTheDocument();
    });

    it("without a resolved reference the legacy logo still renders", () => {
      render(
        <StoreBrand
          href="/sa/ar"
          name="متجر النور"
          logoUrl="data:image/png;base64,iVBORw0KGgo="
          logoMedia={null}
        />,
      );
      expect(screen.getByRole("img")).toHaveAttribute(
        "src",
        "data:image/png;base64,iVBORw0KGgo=",
      );
    });
  });
});
