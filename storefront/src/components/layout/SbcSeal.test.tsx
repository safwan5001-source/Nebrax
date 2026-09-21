import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SBC_SEAL_SCRIPT_URL, SbcSeal } from "./SbcSeal";

describe("SbcSeal", () => {
  it("keeps the approved fallback until the official seal loads", async () => {
    const { getByTestId, unmount } = render(
      <SbcSeal token="opaque-token" fallbackLabel="sbcVerified" />,
    );
    const container = getByTestId("sbc-official-seal");

    expect(getByTestId("sbc-text-fallback")).toHaveTextContent("sbcVerified");
    expect(container).toHaveClass("hidden");
    expect(container).toHaveAttribute("data-token", "opaque-token");
    await waitFor(() =>
      expect(document.getElementById("awj-sbc-seal-loader")).toHaveAttribute(
        "src",
        SBC_SEAL_SCRIPT_URL,
      ),
    );
    expect(document.querySelectorAll("#awj-sbc-seal-loader")).toHaveLength(1);

    document
      .getElementById("awj-sbc-seal-loader")
      ?.dispatchEvent(new Event("load"));
    await waitFor(() => {
      expect(container).not.toHaveClass("hidden");
      expect(
        document.querySelector('[data-testid="sbc-text-fallback"]'),
      ).toBeNull();
    });

    unmount();
    expect(document.getElementById("awj-sbc-seal-loader")).toBeNull();
  });

  it("keeps the approved fallback when the government script fails", async () => {
    const { getByTestId } = render(
      <SbcSeal token="opaque-token" fallbackLabel="sbcVerified" />,
    );
    const script = document.getElementById("awj-sbc-seal-loader");
    script?.dispatchEvent(new Event("error"));

    await waitFor(() => {
      expect(getByTestId("sbc-text-fallback")).toHaveTextContent("sbcVerified");
      expect(getByTestId("sbc-official-seal")).toHaveClass("hidden");
    });
  });

  it("does not load the government script without a token", () => {
    render(<SbcSeal token="   " fallbackLabel="sbcVerified" />);
    expect(document.getElementById("awj-sbc-seal-loader")).toBeNull();
  });
});
