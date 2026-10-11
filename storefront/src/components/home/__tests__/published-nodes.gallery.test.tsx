/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PresentationHomeSection } from "@/lib/presentation/config";
import { galleryImagePath } from "@/lib/presentation/gallery-resolve";
import type { ResolvedMedia } from "@/lib/presentation/media-ref";
import { publishedNodes } from "../published-nodes";

afterEach(cleanup);

const ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const labels = {
  label: "Gallery",
  item: "Picture {number}",
  previous: "Previous pictures",
  next: "Next pictures",
  open: "View picture {number} larger",
  viewer: "Picture viewer",
  close: "Close viewer",
  viewerPrevious: "Previous picture",
  viewerNext: "Next picture",
  counter: "{current} of {total}",
};

const resolved = (): ResolvedMedia => ({
  width: 1600,
  height: 900,
  decorative: false,
  alt: { ar: "صورة", en: "A picture" },
  sources: [
    {
      kind: "w",
      width: 800,
      height: 450,
      format: "webp",
      src: `/api/storefront/media/customizer/${ID}/800w.webp`,
    },
    {
      kind: "w",
      width: 800,
      height: 450,
      format: "jpg",
      src: `/api/storefront/media/customizer/${ID}/800w.jpg`,
    },
  ],
});

const gallery = (
  id: string,
  extra: Partial<PresentationHomeSection> = {},
): PresentationHomeSection => ({
  id,
  type: "gallery",
  visible: true,
  content: {
    images: [
      { id: "a", media: { mediaId: ID }, caption: "One" },
      { id: "b", media: { mediaId: ID } },
    ],
    options: { captions: true },
  },
  ...extra,
});

const base = {
  implemented: {},
  basePath: "/sa/en",
  locale: "en",
  apps: { iosUrl: "", androidUrl: "", appName: "" },
  benefitsTitle: "b",
  featuredTitle: "f",
  offersTitle: "o",
  appTitle: "a",
  appStoreLabel: "as",
  playStoreLabel: "ps",
  design: { primaryColor: "#12372a", accentColor: null, dir: "ltr" as const },
  galleryLabels: labels,
};

const mediaFor = (index: number) => ({
  [galleryImagePath(index, 0)]: resolved(),
  [galleryImagePath(index, 1)]: resolved(),
});

async function mount(
  sections: PresentationHomeSection[],
  media: Record<string, ResolvedMedia>,
  extra: Record<string, unknown> = {},
) {
  const nodes = await publishedNodes(sections, {
    ...base,
    media,
    ...extra,
  } as never);
  return render(<div>{nodes}</div>).container;
}

describe("publishedNodes — gallery (V8e)", () => {
  it("draws a visible gallery from the server's resolved pictures", async () => {
    const c = await mount([gallery("g")], mediaFor(0));
    const root = c.querySelector("[data-gallery]");
    expect(root).not.toBeNull();
    expect(root?.getAttribute("dir")).toBe("ltr");
    expect(c.querySelectorAll("[data-gallery-item]")).toHaveLength(2);
    expect(c.querySelector("figcaption")?.textContent).toBe("One");
  });

  it("omits a hidden gallery, one with no resolvable picture, and one without its labels", async () => {
    expect(
      (
        await mount([gallery("g", { visible: false })], mediaFor(0))
      ).querySelector("[data-gallery]"),
    ).toBeNull();
    expect(
      (await mount([gallery("g")], {})).querySelector("[data-gallery]"),
    ).toBeNull();
    expect(
      (
        await mount([gallery("g")], mediaFor(0), { galleryLabels: undefined })
      ).querySelector("[data-gallery]"),
    ).toBeNull();
  });

  it("keys pictures by the section's index in the WHOLE list (hidden sections included)", async () => {
    const hidden: PresentationHomeSection = {
      id: "x",
      type: "benefits",
      visible: false,
    };
    expect(
      (await mount([hidden, gallery("g")], mediaFor(1))).querySelector(
        "[data-gallery]",
      ),
    ).not.toBeNull();
    cleanup();
    expect(
      (await mount([hidden, gallery("g")], mediaFor(0))).querySelector(
        "[data-gallery]",
      ),
    ).toBeNull();
  });

  it("loads its first row eagerly only when the gallery opens the page", async () => {
    const first = await mount([gallery("g")], mediaFor(0));
    expect(first.querySelector("img")?.getAttribute("loading")).toBe("eager");
    cleanup();
    const second = await mount(
      [
        {
          id: "h",
          type: "benefits",
          visible: true,
          content: { items: [{ id: "i", title: "T", body: "B" }] },
        },
        gallery("g"),
      ],
      mediaFor(1),
    );
    expect(
      second.querySelector("[data-gallery] img")?.getAttribute("loading"),
    ).toBe("lazy");
  });

  it("the layout is the grid unless the section's design says carousel", async () => {
    expect(
      (await mount([gallery("g")], mediaFor(0)))
        .querySelector("[data-gallery]")
        ?.getAttribute("data-layout"),
    ).toBe("grid");
    cleanup();
    const strip = await mount(
      [gallery("g", { design: { layout: "carousel" } })],
      mediaFor(0),
    );
    expect(
      strip.querySelector("[data-gallery]")?.getAttribute("data-layout"),
    ).toBe("carousel");
  });

  it("a designed gallery is wrapped by its frame with the gallery as the frame's only child", async () => {
    const c = await mount(
      [
        gallery("g", {
          design: {
            background: { kind: "solid", color: { role: "surface" } },
            spacing: { top: "md" },
          },
        }),
      ],
      mediaFor(0),
    );
    const frame = c.querySelector("[data-sd]") as HTMLElement;
    expect(frame.getAttribute("data-design-type")).toBe("gallery");
    expect(frame.children).toHaveLength(1);
    expect(frame.firstElementChild?.hasAttribute("data-gallery")).toBe(true);
  });

  it("a document without a gallery renders exactly as before", async () => {
    const c = await mount(
      [
        {
          id: "b",
          type: "benefits",
          visible: true,
          content: { items: [{ id: "i", title: "T", body: "B" }] },
        },
      ],
      {},
    );
    expect(c.querySelector("[data-gallery]")).toBeNull();
  });
});
