import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductImage } from "@/components/ui/product-image";

/**
 * AWJ-R2-5 — this overrides the global `next/image` mock
 * (`src/__tests__/setup.tsx`) for this file only, because that mock
 * discards `unoptimized` entirely (it always renders the raw `src`
 * regardless), which hides exactly the prop this fix depends on. Real
 * `next/image` behaves the opposite way when `unoptimized` is *not* set:
 * it rewrites `src` to its own `/_next/image?url=...` optimizer endpoint,
 * which — for a local/relative URL like our AWJ media proxy — resolves
 * in-process via a headerless mocked request (see `ProductImage`'s and
 * `mappers.ts`'s comments) and 404s before ever reaching the AWJ API. This
 * mock renders `unoptimized` as an inspectable attribute so the test proves
 * the actual decision our code makes, not Next's internal plumbing.
 */
const imageSpy = vi.fn();

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    imageSpy(props);
    const {
      fill,
      priority,
      fetchPriority,
      blurDataURL,
      placeholder,
      unoptimized,
      ...rest
    } = props;
    // biome-ignore lint/performance/noImgElement: test mock for next/image
    // biome-ignore lint/a11y/useAltText: test mock passes through all props including alt
    return <img data-unoptimized={unoptimized ? "true" : "false"} {...rest} />;
  },
}));

describe("ProductImage — AWJ-R2-5 same-origin media proxy", () => {
  it("marks the AWJ same-origin media proxy URL as unoptimized, so the browser fetches it directly instead of Next's headerless internal proxy", () => {
    const { getByRole } = render(
      <ProductImage src="/api/storefront/media/abc-123" alt="product" fill />,
    );

    const img = getByRole("img");
    expect(img).toHaveAttribute("data-unoptimized", "true");
    expect(imageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        unoptimized: true,
        src: "/api/storefront/media/abc-123",
      }),
    );
  });

  it("does not force unoptimized for a genuinely external image URL (e.g. the wholesale Spree CDN)", () => {
    const { getByRole } = render(
      <ProductImage
        src="https://cdn.example.com/products/shirt.jpg"
        alt="product"
        fill
      />,
    );

    expect(getByRole("img")).toHaveAttribute("data-unoptimized", "false");
  });

  it("respects an explicit unoptimized override from the caller", () => {
    const { getByRole } = render(
      <ProductImage
        src="https://cdn.example.com/products/shirt.jpg"
        alt="product"
        fill
        unoptimized
      />,
    );

    expect(getByRole("img")).toHaveAttribute("data-unoptimized", "true");
  });

  it("still renders the placeholder icon, unaffected, when there is no src", () => {
    const { queryByRole, container } = render(
      <ProductImage src={null} alt="product" fill />,
    );

    expect(queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
