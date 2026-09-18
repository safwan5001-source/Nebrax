import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCartLineImages } from "../useCartLineImages";

const getCartLineImages = vi.hoisted(() => vi.fn());
vi.mock("@/lib/data/cart-media", () => ({ getCartLineImages }));

function Probe({ ids, enabled }: { ids: string[]; enabled?: boolean }) {
  const images = useCartLineImages(ids, enabled);
  return <output data-testid="out">{JSON.stringify(images)}</output>;
}

describe("useCartLineImages", () => {
  beforeEach(() => {
    getCartLineImages.mockReset();
  });

  /**
   * The defect this guards: the hook marked every requested id as "resolved"
   * before its request came back, and a teardown before that request settled
   * discarded the result while leaving the claim in place — so the id was
   * never looked up again and no image ever arrived.
   *
   * Reproduced here the way a shopper reaches it: a second line appears while
   * the first line's lookup is still in flight, which re-runs the effect. The
   * old implementation dropped the first image permanently.
   */
  it("keeps an in-flight result when the effect re-runs before it settles", async () => {
    let resolveFirst: (value: Record<string, string | null>) => void = () => {};
    getCartLineImages
      .mockImplementationOnce(
        () =>
          new Promise<Record<string, string | null>>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ "prd-2": "https://example.test/2.png" });

    const { rerender } = render(<Probe ids={["prd-1"]} />);
    await waitFor(() => expect(getCartLineImages).toHaveBeenCalledTimes(1));

    // The second line arrives before the first lookup answers.
    rerender(<Probe ids={["prd-1", "prd-2"]} />);
    await waitFor(() => expect(getCartLineImages).toHaveBeenCalledTimes(2));

    resolveFirst({ "prd-1": "https://example.test/1.png" });

    await waitFor(() => {
      expect(screen.getByTestId("out")).toHaveTextContent(
        "https://example.test/1.png",
      );
      expect(screen.getByTestId("out")).toHaveTextContent(
        "https://example.test/2.png",
      );
    });
  });

  it("requests each product once, not once per render", async () => {
    getCartLineImages.mockResolvedValue({ "prd-1": null });

    const { rerender } = render(<Probe ids={["prd-1"]} />);
    await waitFor(() => expect(getCartLineImages).toHaveBeenCalledTimes(1));

    rerender(<Probe ids={["prd-1"]} />);
    await waitFor(() => expect(getCartLineImages).toHaveBeenCalledTimes(1));
    // A product with no image is an answer, not a reason to retry.
    expect(getCartLineImages).toHaveBeenCalledWith(["prd-1"]);
  });

  it("requests nothing while disabled — a closed drawer fetches no imagery", async () => {
    render(<Probe ids={["prd-1"]} enabled={false} />);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getCartLineImages).not.toHaveBeenCalled();
  });

  it("leaves the placeholder in place when the lookup fails", async () => {
    getCartLineImages.mockRejectedValue(new Error("network"));

    render(<Probe ids={["prd-1"]} />);

    await waitFor(() => expect(getCartLineImages).toHaveBeenCalled());
    expect(screen.getByTestId("out")).toHaveTextContent("{}");
  });
});
