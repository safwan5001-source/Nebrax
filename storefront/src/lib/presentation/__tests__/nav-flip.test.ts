import { describe, expect, it } from "vitest";
import { NAV_PANEL_MARGIN, shouldFlipPanel } from "../nav-flip";

const frame = { left: 0, right: 1000 };

describe("shouldFlipPanel (V7d-4)", () => {
  it("LTR: flips only when the panel would pass the right edge (with margin)", () => {
    expect(shouldFlipPanel({ left: 100, right: 300 }, frame, false)).toBe(
      false,
    );
    expect(
      shouldFlipPanel(
        { left: 800, right: 1000 - NAV_PANEL_MARGIN },
        frame,
        false,
      ),
    ).toBe(false);
    expect(
      shouldFlipPanel(
        { left: 800, right: 1000 - NAV_PANEL_MARGIN + 1 },
        frame,
        false,
      ),
    ).toBe(true);
    expect(shouldFlipPanel({ left: 900, right: 1100 }, frame, false)).toBe(
      true,
    );
  });

  it("RTL: flips only when the panel would pass the left edge (with margin)", () => {
    expect(shouldFlipPanel({ left: 700, right: 900 }, frame, true)).toBe(false);
    expect(
      shouldFlipPanel({ left: NAV_PANEL_MARGIN, right: 200 }, frame, true),
    ).toBe(false);
    expect(
      shouldFlipPanel({ left: NAV_PANEL_MARGIN - 1, right: 200 }, frame, true),
    ).toBe(true);
    expect(shouldFlipPanel({ left: -40, right: 160 }, frame, true)).toBe(true);
  });

  it("the other direction's overflow is not its concern", () => {
    expect(shouldFlipPanel({ left: 900, right: 1100 }, frame, true)).toBe(
      false,
    );
    expect(shouldFlipPanel({ left: -40, right: 160 }, frame, false)).toBe(
      false,
    );
  });

  it("respects a container that does not start at 0", () => {
    const inner = { left: 200, right: 700 };
    expect(shouldFlipPanel({ left: 500, right: 720 }, inner, false)).toBe(true);
    expect(shouldFlipPanel({ left: 190, right: 400 }, inner, true)).toBe(true);
  });
});
