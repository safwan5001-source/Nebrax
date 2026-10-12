import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaGallery } from "@/components/products/MediaGallery";
import { resolvePublicProductZoom } from "@/lib/presentation/page-runtime";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/components/products/MediaLightbox", () => ({
  MediaLightbox: () => <div data-testid="lightbox" />,
}));
vi.mock("@/components/ui/product-image", () => ({
  ProductImage: ({ alt }: { alt: string }) => <span data-img={alt} />,
}));

const images = [
  {
    id: "i1",
    original_url: "https://cdn.example.test/a.jpg",
    xlarge_url: "https://cdn.example.test/a-x.jpg",
    alt: "A",
  },
  {
    id: "i2",
    original_url: "https://cdn.example.test/b.jpg",
    xlarge_url: "https://cdn.example.test/b-x.jpg",
    alt: "B",
  },
] as never;

/** CUST-HV V9e — the product image zoom is a presentation choice; the picture itself and the thumbnails never change. */
describe("MediaGallery — zoom on / off", () => {
  afterEach(() => cleanup());

  it("default (and on): the main image opens the zoom, with the hint", () => {
    render(<MediaGallery images={images} productName="P" />);
    expect(screen.getByRole("button", { name: "openImageZoom" })).toBeTruthy();
    expect(screen.getByText("clickToZoom")).toBeTruthy();
    expect(document.querySelector("[data-zoom]")).toBeNull();
  });

  it("off: a plain picture — no zoom button, no hint, no lightbox", () => {
    render(
      <MediaGallery images={images} productName="P" zoomEnabled={false} />,
    );
    expect(screen.queryByRole("button", { name: "openImageZoom" })).toBeNull();
    expect(screen.queryByText("clickToZoom")).toBeNull();
    const plain = document.querySelector('[data-zoom="off"]');
    expect(plain).not.toBeNull();
    expect(plain?.querySelector('[data-img="A"]')).not.toBeNull();
    fireEvent.click(plain as Element);
    expect(screen.queryByTestId("lightbox")).toBeNull();
  });

  it("off: swiping the picture still navigates between media", () => {
    render(
      <MediaGallery images={images} productName="P" zoomEnabled={false} />,
    );
    const plain = document.querySelector('[data-zoom="off"]') as Element;
    fireEvent.touchStart(plain, { touches: [{ clientX: 200, clientY: 10 }] });
    fireEvent.touchEnd(plain, {
      changedTouches: [{ clientX: 100, clientY: 12 }],
    });
    expect(
      document.querySelector('[data-zoom="off"] [data-img="B"]'),
    ).not.toBeNull();
  });

  it("off: the thumbnails still switch the picture", () => {
    render(
      <MediaGallery images={images} productName="P" zoomEnabled={false} />,
    );
    const thumbs = screen
      .getAllByRole("button")
      .filter((b) => b.querySelector("[data-img]"));
    expect(thumbs).toHaveLength(2);
    fireEvent.click(thumbs[1]);
    expect(
      document.querySelector('[data-zoom="off"] [data-img="B"]'),
    ).not.toBeNull();
  });
});

describe("resolvePublicProductZoom", () => {
  it("is on unless the product page says off", () => {
    expect(resolvePublicProductZoom(undefined)).toBe(true);
    expect(resolvePublicProductZoom({})).toBe(true);
    expect(
      resolvePublicProductZoom({ product: { version: 1, regions: [] } }),
    ).toBe(true);
    expect(
      resolvePublicProductZoom({
        product: { version: 1, regions: [], zoom: "off" },
      }),
    ).toBe(false);
  });
});
