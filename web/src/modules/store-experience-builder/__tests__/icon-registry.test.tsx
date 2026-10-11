/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ICON_GLYPHS, StoreIcon } from "../StoreIcon";
import {
  ICON_KEYS,
  ICON_REGISTRY,
  iconLabel,
  isIconKey,
  normalizeIconKey,
} from "../presentation/icon-registry";

describe("icon registry (V7d-1)", () => {
  it("pins the ordered, append-only key list — removing or renaming a key is a breaking change", () => {
    expect([...ICON_KEYS]).toEqual([
      "truck",
      "shield-check",
      "credit-card",
      "gift",
      "clock",
      "phone",
      "message-circle",
      "mail",
      "map-pin",
      "store",
      "star",
      "heart",
      "tag",
      "percent",
      "package",
      "refresh-ccw",
      "headphones",
      "leaf",
      "sparkles",
      "badge-check",
      "calendar",
      "users",
      "lock",
      "globe",
    ]);
  });

  it("every key has labels in both languages, search tags, and no stray entries", () => {
    expect(Object.keys(ICON_REGISTRY).sort()).toEqual([...ICON_KEYS].sort());
    for (const key of ICON_KEYS) {
      const info = ICON_REGISTRY[key];
      expect(info.label.ar.trim().length).toBeGreaterThan(0);
      expect(info.label.en.trim().length).toBeGreaterThan(0);
      expect(info.tags.length).toBeGreaterThan(0);
      expect(iconLabel(key, "ar")).toBe(info.label.ar);
      expect(iconLabel(key, "en")).toBe(info.label.en);
    }
    expect(new Set(ICON_KEYS).size).toBe(ICON_KEYS.length);
  });

  it("an unknown or hostile key normalises to nothing", () => {
    expect(normalizeIconKey("truck")).toBe("truck");
    for (const bad of [
      "Truck",
      " truck",
      "trucks",
      "<svg onload=x>",
      "../etc/passwd",
      "javascript:alert(1)",
      "",
      null,
      undefined,
      7,
      {},
      ["truck"],
    ]) {
      expect(normalizeIconKey(bad)).toBeUndefined();
      expect(isIconKey(bad)).toBe(false);
    }
  });
});

describe("Canvas StoreIcon (V7d-1)", () => {
  it("draws every registry key, decorative by default, mirrored only when directional", () => {
    expect(Object.keys(ICON_GLYPHS).sort()).toEqual([...ICON_KEYS].sort());
    for (const key of ICON_KEYS) {
      const { container, unmount } = render(<StoreIcon name={key} />);
      const svg = container.querySelector("svg");
      expect(svg, key).not.toBeNull();
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      expect((svg?.getAttribute("class") ?? "").includes("rtl:-scale-x-100")).toBe(ICON_REGISTRY[key].directional);
      unmount();
    }
  });

  it("a labelled icon is an image; an unknown key draws nothing", () => {
    const { container } = render(<StoreIcon name="mail" label="Write to us" />);
    expect(container.querySelector("svg")?.getAttribute("role")).toBe("img");
    const none = render(<StoreIcon name="zzz" />);
    expect(none.container.innerHTML).toBe("");
  });
});
