/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SectionBackdropData } from "@/lib/presentation/background-media";
import type { ResolvedMedia } from "@/lib/presentation/media-ref";
import { SectionBackdrop } from "../SectionBackdrop";

afterEach(cleanup);

const ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const sources = (tag: string): ResolvedMedia["sources"] => [
  {
    kind: "w",
    width: 640,
    height: 360,
    format: "webp",
    src: `/api/storefront/media/customizer/${ID}/${tag}-640.webp`,
  },
  {
    kind: "w",
    width: 1280,
    height: 720,
    format: "webp",
    src: `/api/storefront/media/customizer/${ID}/${tag}-1280.webp`,
  },
  {
    kind: "w",
    width: 1280,
    height: 720,
    format: "jpg",
    src: `/api/storefront/media/customizer/${ID}/${tag}-1280.jpg`,
  },
  {
    kind: "thumb",
    width: 160,
    height: 90,
    format: "jpg",
    src: `/api/storefront/media/customizer/${ID}/${tag}-thumb.jpg`,
  },
];
const media = (tag: string): ResolvedMedia => ({
  width: 1600,
  height: 900,
  decorative: true,
  alt: { ar: "x", en: "y" },
  sources: sources(tag),
});

describe("SectionBackdrop (CUST-HV V6b-3)", () => {
  it("is a purely decorative layer: aria-hidden, empty alt, no text, only width sources in srcset", () => {
    const { container } = render(
      <SectionBackdrop data={{ media: media("d"), overlay: false }} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("data-sd-backdrop")).toBe("");
    expect(root.getAttribute("aria-hidden")).toBe("true");
    const img = root.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("src")).toContain("d-1280.jpg");
    expect(img.getAttribute("srcset")).not.toContain("thumb");
    expect(root.querySelector("source")?.getAttribute("srcset")).not.toContain(
      "thumb",
    );
    expect(root.textContent).toBe("");
    expect(root.querySelector("[data-sd-overlay]")).toBeNull();
  });

  it("the phone picture is art direction: media-conditioned sources first, then the default ones — one image on the page", () => {
    const data: SectionBackdropData = {
      media: media("d"),
      mobile: media("m"),
      focal: { x: 25, y: 75 },
      overlay: true,
    };
    const { container } = render(<SectionBackdrop data={data} />);
    const sourcesEls = [...container.querySelectorAll("source")];
    expect(
      sourcesEls.map((s) => [s.getAttribute("media"), s.getAttribute("type")]),
    ).toEqual([
      ["(max-width: 767px)", "image/webp"],
      ["(max-width: 767px)", "image/jpeg"],
      [null, "image/webp"],
    ]);
    expect(sourcesEls[0].getAttribute("srcset")).toContain("/m-");
    expect(sourcesEls[2].getAttribute("srcset")).toContain("/d-");
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(
      (container.querySelector("img") as HTMLImageElement).style.objectPosition,
    ).toBe("25% 75%");
    expect(container.querySelector("[data-sd-overlay]")).toBeTruthy();
  });

  it("only the page's first hero loads eagerly with high priority; the rest are lazy", () => {
    const eager = render(
      <SectionBackdrop data={{ media: media("d"), overlay: false }} priority />,
    ).container.querySelector("img") as HTMLImageElement;
    expect(eager.getAttribute("loading")).toBe("eager");
    expect(eager.getAttribute("fetchpriority")).toBe("high");
    cleanup();
    const lazy = render(
      <SectionBackdrop data={{ media: media("d"), overlay: false }} />,
    ).container.querySelector("img") as HTMLImageElement;
    expect(lazy.getAttribute("loading")).toBe("lazy");
    expect(lazy.hasAttribute("fetchpriority")).toBe(false);
  });
});
