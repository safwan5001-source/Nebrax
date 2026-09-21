import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SBC_SEAL_SCRIPT_URL, SbcSeal } from "./SbcSeal";

describe("SbcSeal", () => {
  it("keeps the fallback when the script loads without seal content", async () => {
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
      expect(getByTestId("sbc-text-fallback")).toBeTruthy();
      expect(container).toHaveClass("hidden");
    });

    unmount();
    expect(document.getElementById("awj-sbc-seal-loader")).toBeNull();
  });

  it("hides the fallback when the government loader adds seal content", async () => {
    const { getByTestId } = render(
      <SbcSeal token="opaque-token" fallbackLabel="sbcVerified" />,
    );
    const container = getByTestId("sbc-official-seal");

    container.appendChild(document.createElement("iframe"));

    await waitFor(() => {
      expect(getByTestId("sbc-official-seal")).not.toHaveClass("hidden");
      expect(
        document.querySelector('[data-testid="sbc-text-fallback"]'),
      ).toBeNull();
    });
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

  it("disconnects the content observer on token change and unmount", () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const { rerender, unmount } = render(
      <SbcSeal token="first-token" fallbackLabel="sbcVerified" />,
    );

    rerender(<SbcSeal token="second-token" fallbackLabel="sbcVerified" />);
    expect(disconnect).toHaveBeenCalledTimes(1);

    unmount();
    expect(disconnect).toHaveBeenCalledTimes(2);
    disconnect.mockRestore();
  });
});
