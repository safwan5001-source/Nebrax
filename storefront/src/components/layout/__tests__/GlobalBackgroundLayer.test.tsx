import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "@/lib/presentation/config";
import type {
  ResolvedMedia,
  ResolvedMediaMap,
} from "@/lib/presentation/media-ref";
import type { StorefrontBackground } from "@/lib/presentation/storefront-background";
import {
  GlobalBackgroundLayer,
  isStorefrontBackgroundRoute,
} from "../GlobalBackgroundLayer";

const pathname = vi.hoisted(() => ({ value: "/sa/en" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

function resolved(id: string): ResolvedMedia {
  return {
    width: 1600,
    height: 900,
    decorative: true,
    alt: { ar: null, en: null },
    sources: [
      {
        kind: "w",
        width: 768,
        height: 432,
        format: "webp",
        src: `/api/storefront/media/customizer/${id}/w-768.webp`,
      },
      {
        kind: "w",
        width: 768,
        height: 432,
        format: "jpg",
        src: `/api/storefront/media/customizer/${id}/w-768.jpg`,
      },
      {
        kind: "w",
        width: 1600,
        height: 900,
        format: "jpg",
        src: `/api/storefront/media/customizer/${id}/w-1600.jpg`,
      },
    ],
    animation: {
      src: `/api/storefront/media/customizer/${id}/animated.gif`,
      format: "gif",
      frames: 12,
      durationMs: 900,
      loop: true,
    },
  };
}
const desktopId = "00000000-0000-4000-8000-000000000010";
const mobileId = "00000000-0000-4000-8000-000000000020";
const background: StorefrontBackground = {
  kind: "media",
  media: { mediaId: desktopId, focal: { x: 25, y: 60 }, decorative: true },
  mobile: { mediaId: mobileId, focal: { x: 70, y: 35 }, decorative: true },
  overlay: { color: { hex: "#102030" }, alpha: 35 },
};
const media: ResolvedMediaMap = {
  "background.media": resolved(desktopId),
  "background.mobile": resolved(mobileId),
};

beforeEach(() => {
  pathname.value = "/sa/en";
});

describe("GlobalBackgroundLayer", () => {
  it("allows storefront content routes and excludes checkout, account and wholesale", () => {
    for (const path of [
      "/sa/en",
      "/sa/en/products",
      "/sa/en/products/rose",
      "/sa/en/c/flowers",
      "/sa/en/policies/returns",
    ]) {
      expect(isStorefrontBackgroundRoute(path)).toBe(true);
    }
    for (const path of [
      "/sa/en/checkout/123",
      "/sa/en/account/orders",
      "/sa/en/wholesale/apply",
    ]) {
      expect(isStorefrontBackgroundRoute(path)).toBe(false);
    }
    expect(isStorefrontBackgroundRoute(null)).toBe(false);
  });

  it("uses the existing resolved still ladders, mobile art direction, focal point and overlay", () => {
    render(
      <GlobalBackgroundLayer
        background={background}
        resolved={media}
        presentation={DEFAULT_PRESENTATION_CONFIG}
      />,
    );
    const picture = document.querySelector(
      "[data-global-background-layer] picture",
    );
    expect(
      picture
        ?.querySelector('source[media="(max-width: 767px)"][type="image/webp"]')
        ?.getAttribute("srcset"),
    ).toContain(mobileId);
    expect(
      picture
        ?.querySelector('source[media="(max-width: 767px)"][type="image/jpeg"]')
        ?.getAttribute("srcset"),
    ).toContain(mobileId);
    expect(
      picture
        ?.querySelector('source:not([media])[type="image/webp"]')
        ?.getAttribute("srcset"),
    ).toContain(desktopId);
    const image = screen.getByAltText("");
    expect(image.getAttribute("src")).toContain(desktopId);
    expect(
      (image as HTMLImageElement).style.getPropertyValue(
        "--global-bg-position",
      ),
    ).toBe("25% 60%");
    expect(
      (image as HTMLImageElement).style.getPropertyValue(
        "--global-bg-position-mobile",
      ),
    ).toBe("70% 35%");
    expect(image.getAttribute("src")).not.toContain("animated");
    expect(
      document
        .querySelector("[data-global-background-overlay]")
        ?.getAttribute("style"),
    ).toContain("opacity: 0.35");
    expect(
      document
        .querySelector("[data-global-background-layer]")
        ?.getAttribute("data-has-mobile"),
    ).toBe("");
  });

  it("falls back to the desktop still when the mobile derivative is absent", () => {
    render(
      <GlobalBackgroundLayer
        background={background}
        resolved={{ "background.media": media["background.media"] }}
        presentation={DEFAULT_PRESENTATION_CONFIG}
      />,
    );
    expect(
      document
        .querySelector("[data-global-background-layer]")
        ?.getAttribute("data-has-mobile"),
    ).toBeNull();
    expect(
      document.querySelector('source[media="(max-width: 767px)"]'),
    ).toBeNull();
  });

  it("fails closed if no server-resolved media exists", () => {
    const { container } = render(
      <GlobalBackgroundLayer
        background={background}
        resolved={{}}
        presentation={DEFAULT_PRESENTATION_CONFIG}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("does not expose presentation media on account routes", () => {
    pathname.value = "/sa/en/account/orders";
    const { container } = render(
      <GlobalBackgroundLayer
        background={background}
        resolved={media}
        presentation={DEFAULT_PRESENTATION_CONFIG}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("has no animation behavior even if a resolved map carries animation metadata", () => {
    render(
      <GlobalBackgroundLayer
        background={background}
        resolved={media}
        presentation={DEFAULT_PRESENTATION_CONFIG}
      />,
    );
    expect(document.querySelector("video")).toBeNull();
    expect(document.querySelector("[data-motion-toggle]")).toBeNull();
    expect(document.querySelector("img")?.getAttribute("src")).not.toContain(
      "animated",
    );
  });
});
