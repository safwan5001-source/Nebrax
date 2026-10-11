/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasGallery, type CanvasGalleryLabels } from "../CanvasGallery";

// the signed workspace preview URL is the editor's only picture source
vi.mock("../media/use-media-ref-preview", () => ({
  useMediaRefPreview: (ref: { mediaId: string } | null) => (ref ? `https://signed.example/${ref.mediaId}.jpg` : null),
}));

afterEach(cleanup);

const A = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const B = "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f";
const labels: CanvasGalleryLabels = { label: "Gallery", empty: "Add at least two pictures", item: "Picture {number}" };
const images = (n = 3) =>
  Array.from({ length: n }, (_, i) => ({
    id: `i${i}`,
    media: { mediaId: i % 2 ? B : A },
    ...(i === 0 ? { caption: "Spring" } : {}),
  })) as never;

function mount(extra: Partial<React.ComponentProps<typeof CanvasGallery>> = {}) {
  return render(
    <CanvasGallery images={images()} options={undefined} layout="grid" dir="ltr" viewport="desktop" labels={labels} {...extra} />,
  );
}

describe("CanvasGallery (CUST-HV V8f)", () => {
  it("draws the storefront's DOM: a named region, a list of figures, the device on data-vp and the options as closed-list attributes", () => {
    const { container } = mount({ viewport: "tablet", options: { columns: 4, aspect: "16:9", gap: "lg" } });
    const root = container.querySelector("[data-gallery]") as HTMLElement;
    expect(root.getAttribute("aria-label")).toBe("Gallery");
    expect(root.getAttribute("data-vp")).toBe("tablet");
    expect(root.getAttribute("data-cols")).toBe("4");
    expect(root.getAttribute("data-aspect")).toBe("16-9");
    expect(root.getAttribute("data-gap")).toBe("lg");
    expect(root.getAttribute("data-layout")).toBe("grid");
    expect(container.querySelectorAll("ul > li figure")).toHaveLength(3);
  });

  it("pictures come from the signed preview; the preview names them 'Picture n' and decorative ones are empty", () => {
    const { container } = mount({
      images: [
        { id: "a", media: { mediaId: A } },
        { id: "b", media: { mediaId: B, decorative: true } },
      ] as never,
    });
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([`https://signed.example/${A}.jpg`, `https://signed.example/${B}.jpg`]);
    expect(imgs.map((i) => i.getAttribute("alt"))).toEqual(["Picture 1", ""]);
  });

  it("captions only when switched on; fit and focal reach the markup as data / position", () => {
    const off = mount();
    expect(off.container.querySelector("figcaption")).toBeNull();
    cleanup();
    const on = mount({ options: { captions: true } });
    expect(on.container.querySelector("figcaption")?.textContent).toBe("Spring");
    cleanup();
    const framed = mount({
      images: [
        { id: "a", media: { mediaId: A, fit: "contain", focal: { x: 20, y: 70 } } },
        { id: "b", media: { mediaId: B } },
      ] as never,
    });
    expect(framed.container.querySelector("[data-gallery-frame]")?.getAttribute("data-fit")).toBe("contain");
    expect((framed.container.querySelector("img") as HTMLElement).style.objectPosition).toBe("20% 70%");
  });

  it("the editor's selection is marked (aria-current + data-selected) and brought into view", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { container } = mount({ activeImageId: "i1" });
    const selected = container.querySelectorAll("[data-gallery-item][data-selected]");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-image-id")).toBe("i1");
    expect(selected[0].getAttribute("aria-current")).toBe("true");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("nothing opens a viewer and nothing is interactive in the preview", () => {
    const { container } = mount({ options: { lightbox: true, captions: true } });
    expect(container.querySelector("a, button, [data-gallery-open]")).toBeNull();
  });

  it("the layout and direction come from the section: a strip and an RTL document", () => {
    const { container } = mount({ layout: "carousel", dir: "rtl" });
    const root = container.querySelector("[data-gallery]") as HTMLElement;
    expect(root.getAttribute("data-layout")).toBe("carousel");
    expect(root.getAttribute("dir")).toBe("rtl");
  });

  it("an incomplete gallery says what it needs", () => {
    const { container } = mount({ images: [] });
    expect(container.querySelector("[data-gallery]")).toBeNull();
    expect(container.querySelector("[data-gallery-empty]")?.textContent).toBe("Add at least two pictures");
  });
});
