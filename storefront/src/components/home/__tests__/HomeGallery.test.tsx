/**
 * @vitest-environment jsdom
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { GalleryLabels } from "@/components/home/GalleryClient";
import { HomeGallery } from "@/components/home/HomeGallery";
import { resolveGalleryOptions } from "@/lib/presentation/gallery-content";
import type {
  GalleryImageView,
  GalleryView,
} from "@/lib/presentation/gallery-resolve";
import type { ResolvedMedia } from "@/lib/presentation/media-ref";

afterEach(() => {
  cleanup();
  document.documentElement.style.overflow = "";
});

const labels: GalleryLabels = {
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

const picture = (id: string): ResolvedMedia => ({
  width: 1600,
  height: 900,
  decorative: false,
  alt: { ar: null, en: "Pic" },
  sources: [
    {
      kind: "w",
      width: 800,
      height: 450,
      format: "webp",
      src: `/api/storefront/media/customizer/${id}/800w.webp`,
    },
    {
      kind: "w",
      width: 800,
      height: 450,
      format: "jpg",
      src: `/api/storefront/media/customizer/${id}/800w.jpg`,
    },
    {
      kind: "w",
      width: 1600,
      height: 900,
      format: "jpg",
      src: `/api/storefront/media/customizer/${id}/1600w.jpg`,
    },
  ],
});

function image(
  i: number,
  extra: Partial<GalleryImageView> = {},
): GalleryImageView {
  return {
    id: `i${i}`,
    position: i + 1,
    media: picture(`m${i}`),
    fit: "cover",
    alt: `Alt ${i + 1}`,
    caption: "",
    link: null,
    ...extra,
  };
}

function view(
  images: GalleryImageView[],
  options: Parameters<typeof resolveGalleryOptions>[0] = undefined,
  layout: "grid" | "carousel" = "grid",
): GalleryView {
  return { images, options: resolveGalleryOptions(options), layout };
}

function mount(v: GalleryView, dir: "ltr" | "rtl" = "ltr", priority = false) {
  return render(
    <HomeGallery
      view={v}
      labels={labels}
      basePath="/sa/en"
      dir={dir}
      priority={priority}
      sectionId="g"
    />,
  );
}

const three = () => [image(0), image(1), image(2)];

describe("HomeGallery — server markup (CUST-HV V8e)", () => {
  it("is complete without JavaScript: a named region, a list of figures, real pictures with their intrinsic size", () => {
    const html = renderToString(
      <HomeGallery
        view={view(three(), { columns: 4, aspect: "4:3", gap: "lg" })}
        labels={labels}
        basePath="/sa/en"
        dir="ltr"
        priority={false}
        sectionId="g"
      />,
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    const root = doc.querySelector("[data-gallery]");
    expect(root?.getAttribute("aria-label")).toBe("Gallery");
    expect(root?.getAttribute("data-cols")).toBe("4");
    expect(root?.getAttribute("data-aspect")).toBe("4-3");
    expect(root?.getAttribute("data-gap")).toBe("lg");
    expect(root?.getAttribute("data-layout")).toBe("grid");
    expect(doc.querySelectorAll("ul > li figure")).toHaveLength(3);
    const img = doc.querySelector("img");
    expect(img?.getAttribute("width")).toBe("1600");
    expect(img?.getAttribute("height")).toBe("900");
    expect(img?.getAttribute("alt")).toBe("Alt 1");
    expect(doc.querySelector("source")?.getAttribute("type")).toBe(
      "image/webp",
    );
    // no controls and no viewer are rendered by the server
    expect(doc.querySelector("button")).toBeNull();
    expect(doc.querySelector("[data-gallery-viewer]")).toBeNull();
  });

  it("only the first row loads eagerly, and only when the gallery opens the page", () => {
    const eagers = (priority: boolean) =>
      [
        ...mount(
          view(three(), { columns: 2 }),
          "ltr",
          priority,
        ).container.querySelectorAll("img"),
      ].map((img) => img.getAttribute("loading"));
    expect(eagers(true)).toEqual(["eager", "eager", "lazy"]);
    cleanup();
    expect(eagers(false)).toEqual(["lazy", "lazy", "lazy"]);
  });

  it("captions are drawn only when switched on", () => {
    const withCaptions = [image(0, { caption: "Spring" }), image(1)];
    const off = mount(view(withCaptions));
    expect(off.container.querySelector("figcaption")).toBeNull();
    cleanup();
    const on = mount(view(withCaptions, { captions: true }));
    expect(on.container.querySelectorAll("figcaption")).toHaveLength(1);
    expect(on.container.querySelector("figcaption")?.textContent).toBe(
      "Spring",
    );
  });

  it("a merchant link is a real link through the store's destination rules; an unsafe one draws no link", () => {
    const { container } = mount(
      view([
        image(0, { link: "/products", alt: "Shop" }),
        image(1, { link: "https://example.com/x", alt: "", caption: "Out" }),
        image(2, { link: "javascript:alert(1)" }),
      ]),
    );
    const links = [...container.querySelectorAll("a[data-gallery-link]")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/sa/en/products",
      "https://example.com/x",
    ]);
    expect(links[1].getAttribute("rel")).toBe("noopener noreferrer");
    // a linked picture is always named: alt, else caption, else "Picture n"
    expect(links[0].getAttribute("aria-label")).toBe("Shop");
    expect(links[1].getAttribute("aria-label")).toBe("Out");
    expect(container.querySelectorAll("a")).toHaveLength(2);
  });

  it("with the viewer on, an unlinked picture is an anchor to the large picture file (a no-JS visitor opens it); a linked one stays a link", () => {
    const { container } = mount(
      view([image(0), image(1, { link: "/products" }), image(2)], {
        lightbox: true,
      }),
    );
    const openers = [...container.querySelectorAll("a[data-gallery-open]")];
    expect(openers.map((a) => a.getAttribute("data-gallery-open"))).toEqual([
      "0",
      "2",
    ]);
    expect(openers[0].getAttribute("href")).toBe(
      "/api/storefront/media/customizer/m0/1600w.jpg",
    );
    expect(openers[0].getAttribute("aria-label")).toBe(
      "View picture 1 larger: Alt 1",
    );
    expect(container.querySelectorAll("a[data-gallery-link]")).toHaveLength(1);
  });

  it("without the viewer an unlinked picture is not interactive at all", () => {
    const { container } = mount(view(three()));
    expect(container.querySelector("a")).toBeNull();
  });

  it("a contain-fit picture and a focal point reach the markup as data, not as authored CSS", () => {
    const { container } = mount(
      view([image(0, { fit: "contain", focal: { x: 20, y: 70 } }), image(1)]),
    );
    expect(
      container.querySelector("[data-gallery-frame]")?.getAttribute("data-fit"),
    ).toBe("contain");
    expect(
      (container.querySelector("img") as HTMLElement).style.objectPosition,
    ).toBe("20% 70%");
  });
});

describe("HomeGallery — the viewer (CUST-HV V8e)", () => {
  const withViewer = () =>
    mount(view(three(), { lightbox: true, captions: true }));

  it("a plain click on a picture opens a modal viewer on that picture; the page is scroll-locked", async () => {
    const { container } = withViewer();
    fireEvent.click(
      container.querySelector('a[data-gallery-open="1"]') as HTMLElement,
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Picture viewer",
    });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByRole("img").getAttribute("alt")).toBe("Alt 2");
    expect(within(dialog).getByRole("status").textContent).toBe("2 of 3");
    expect(document.documentElement.style.overflow).toBe("hidden");
  });

  it("a modified click (new tab, download) is left to the browser", () => {
    const { container } = withViewer();
    const anchor = container.querySelector(
      'a[data-gallery-open="0"]',
    ) as HTMLElement;
    fireEvent.click(anchor, { ctrlKey: true });
    fireEvent.click(anchor, { metaKey: true });
    fireEvent.click(anchor, { shiftKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Esc closes the viewer, restores the scroll and returns focus to the picture that opened it", async () => {
    const { container } = withViewer();
    const anchor = container.querySelector(
      'a[data-gallery-open="2"]',
    ) as HTMLElement;
    anchor.focus();
    fireEvent.click(anchor);
    await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.activeElement).toBe(anchor);
  });

  it("with the viewer off or nothing to open there is no dialog and no dead control", () => {
    const { container } = mount(view(three()));
    expect(container.querySelector("a, button")).toBeNull();
  });
});
