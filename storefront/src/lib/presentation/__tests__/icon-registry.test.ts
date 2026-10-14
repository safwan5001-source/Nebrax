import { describe, expect, it } from "vitest";
import {
  ICON_KEYS,
  ICON_REGISTRY,
  iconLabel,
  isIconKey,
  normalizeIconKey,
} from "../icon-registry";

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
      // AWJ-VD-H1 / VD-1a (D-10) — appended, never reordered.
      "cake",
      "graduation-cap",
      "baby",
      "flower",
      "gem",
      "party-popper",
      "user",
      "user-round",
      "briefcase",
      "house",
      "hand-heart",
      "heart-handshake",
      "moon",
      "sun",
      "coffee",
      "crown",
      "trophy",
      "smile",
      "paw-print",
      "shirt",
      "watch",
      "book-open",
      "music",
      "palette",
      "school",
      "stethoscope",
      "utensils",
      "snowflake",
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
