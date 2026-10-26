import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const wholesale = vi.hoisted(() => ({ enabled: false }));

vi.mock("next/navigation", () => ({
  // Mirrors the framework: `notFound()` throws an error carrying the 404 fallback digest.
  notFound: () => {
    throw Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  },
}));
vi.mock("@/lib/spree", () => ({ isWholesaleEnabled: () => wholesale.enabled }));
const shell = vi.hoisted(() => vi.fn(() => null));
vi.mock("./CheckoutShell", () => ({ CheckoutShell: shell }));

import { CheckoutShell } from "./CheckoutShell";
import CheckoutLayout from "./layout";

describe("legacy Spree checkout route group (X5)", () => {
  beforeEach(() => {
    shell.mockClear();
    wholesale.enabled = false;
  });

  it("is a real 404 when the wholesale add-on is not enabled — the shell is never built", () => {
    expect(() => CheckoutLayout({ children: <p>page</p> })).toThrowError(
      expect.objectContaining({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" }),
    );
    expect(shell).not.toHaveBeenCalled();
  });

  it("keeps working exactly as before when wholesale is enabled (shell wraps the page)", () => {
    wholesale.enabled = true;
    const child = <p>wholesale checkout page</p>;
    const tree = CheckoutLayout({ children: child }) as ReactElement<{
      children: unknown;
    }>;

    expect(tree.type).toBe(CheckoutShell);
    expect(tree.props.children).toBe(child);
  });

  it("decides from configuration alone — the same for every country and locale prefix", () => {
    // The layout takes no params, so `/sa/ar`, `/us/en`, … cannot behave differently.
    expect(CheckoutLayout.length).toBe(1);
    for (const enabled of [false, true, false]) {
      wholesale.enabled = enabled;
      const run = () => CheckoutLayout({ children: null });
      if (enabled) expect(run).not.toThrow();
      else expect(run).toThrow();
    }
  });
});
