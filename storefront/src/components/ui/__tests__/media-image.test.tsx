import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ResolvedMedia } from "@/lib/presentation/media-ref";
import { MediaImage, resolveMediaAlt } from "../media-image";

const ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const proxy = (file: string) =>
  `/api/storefront/media/customizer/${ID}/${file}`;

const media = (extra: Partial<ResolvedMedia> = {}): ResolvedMedia => ({
  width: 1600,
  height: 900,
  decorative: false,
  alt: { ar: "شعار", en: "Logo" },
  sources: [
    {
      kind: "w",
      width: 480,
      height: 270,
      format: "webp",
      src: proxy("480w.webp"),
    },
    {
      kind: "w",
      width: 1280,
      height: 720,
      format: "webp",
      src: proxy("1280w.webp"),
    },
    {
      kind: "w",
      width: 480,
      height: 270,
      format: "jpg",
      src: proxy("480w.jpg"),
    },
    {
      kind: "w",
      width: 1280,
      height: 720,
      format: "jpg",
      src: proxy("1280w.jpg"),
    },
    {
      kind: "thumb",
      width: 160,
      height: 90,
      format: "webp",
      src: proxy("thumb-160.webp"),
    },
  ],
  ...extra,
});

describe("MediaImage (V0 §7.8, AMEND-10/12/14)", () => {
  it("offers WebP and JPEG as separate explicit URLs, with real widths and no layout shift", () => {
    const { container } = render(
      <MediaImage media={media()} locale="en" sizes="100vw" />,
    );
    const source = container.querySelector("source") as HTMLSourceElement;
    const img = container.querySelector("img") as HTMLImageElement;

    expect(source.getAttribute("type")).toBe("image/webp");
    expect(source.getAttribute("srcset")).toBe(
      `${proxy("480w.webp")} 480w, ${proxy("1280w.webp")} 1280w`,
    );
    expect(img.getAttribute("srcset")).toBe(
      `${proxy("480w.jpg")} 480w, ${proxy("1280w.jpg")} 1280w`,
    );
    expect(img.getAttribute("src")).toBe(proxy("1280w.jpg"));
    expect(img.getAttribute("width")).toBe("1600");
    expect(img.getAttribute("height")).toBe("900");
    expect(img.getAttribute("sizes")).toBe("100vw");
    expect(container.innerHTML).not.toContain("/store/v1/");
    expect(container.innerHTML).not.toContain("thumb-"); // thumbnails never enter a srcset
  });

  it("resolves alt per locale and never substitutes one locale for the other", () => {
    expect(resolveMediaAlt(media(), "ar")).toBe("شعار");
    expect(resolveMediaAlt(media(), "en")).toBe("Logo");
    expect(
      resolveMediaAlt(media({ alt: { ar: "شعار", en: null } }), "en"),
    ).toBe("");
    expect(
      resolveMediaAlt(
        media({ alt: { ar: "شعار", en: null } }),
        "en",
        undefined,
        "Store",
      ),
    ).toBe("Store");
    // a usage override beats the resolved text for that locale only
    expect(resolveMediaAlt(media(), "en", { en: " Override " })).toBe(
      "Override",
    );
    expect(resolveMediaAlt(media(), "ar", { en: "Override" })).toBe("شعار");
  });

  it('a decorative usage always renders alt="" — present, never omitted', () => {
    const { container } = render(
      <MediaImage
        media={media({ decorative: true })}
        locale="en"
        fallbackAlt="Store"
      />,
    );
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.hasAttribute("alt")).toBe(true);
    expect(img.getAttribute("alt")).toBe("");
  });

  it("applies the usage's own fit and focal point", () => {
    const { container } = render(
      <MediaImage
        media={media()}
        locale="en"
        fit="contain"
        focal={{ x: 20, y: 80 }}
      />,
    );
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.style.objectFit).toBe("contain");
    expect(img.style.objectPosition).toBe("20% 80%");

    const plain = render(
      <MediaImage media={media()} locale="en" />,
    ).container.querySelector("img") as HTMLImageElement;
    expect(plain.style.objectFit).toBe("cover");
    expect(plain.style.objectPosition).toBe("");
  });

  it("lazy by default, eager on request", () => {
    const lazy = render(
      <MediaImage media={media()} locale="en" />,
    ).container.querySelector("img");
    expect(lazy?.getAttribute("loading")).toBe("lazy");
    const eager = render(
      <MediaImage media={media()} locale="en" loading="eager" />,
    ).container.querySelector("img");
    expect(eager?.getAttribute("loading")).toBe("eager");
  });
});
