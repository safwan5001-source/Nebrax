import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SBC_SEAL_SCRIPT_URL, SbcSeal } from "./SbcSeal";

describe("SbcSeal", () => {
  it("renders only the official container and loader URL for a token", async () => {
    const { getByTestId, unmount } = render(<SbcSeal token="opaque-token" />);
    const container = getByTestId("sbc-official-seal");

    expect(container).toHaveAttribute("class", "sbc-verify-seal");
    expect(container).toHaveAttribute("data-token", "opaque-token");
    await waitFor(() =>
      expect(document.getElementById("awj-sbc-seal-loader")).toHaveAttribute(
        "src",
        SBC_SEAL_SCRIPT_URL,
      ),
    );
    expect(document.querySelectorAll("#awj-sbc-seal-loader")).toHaveLength(1);

    unmount();
    expect(document.getElementById("awj-sbc-seal-loader")).toBeNull();
  });

  it("does not load the government script without a token", () => {
    render(<SbcSeal token="   " />);
    expect(document.getElementById("awj-sbc-seal-loader")).toBeNull();
  });
});
