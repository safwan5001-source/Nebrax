import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareButton } from "@/components/products/ShareButton";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...args: unknown[]) => toastSuccess(...args) },
}));

describe("ShareButton", () => {
  afterEach(() => {
    toastSuccess.mockClear();
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
  });

  it("prefers the platform share sheet when one exists, sharing only the current page — no product data", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    const user = userEvent.setup();

    render(<ShareButton title="منتج تجريبي" />);
    await user.click(screen.getByLabelText("share"));

    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ title: "منتج تجريبي" }),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("falls back to copying the URL and confirms it, when no share sheet exists", async () => {
    const user = userEvent.setup();
    // Must come after `userEvent.setup()`, which installs its own
    // `navigator.clipboard` stub for copy/paste simulation — defining these
    // afterward ensures this test's stubs are the ones actually read.
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<ShareButton title="منتج تجريبي" />);
    await user.click(screen.getByLabelText("share"));

    expect(writeText).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith("linkCopied");
  });
});
