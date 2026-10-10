import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AnnouncementsDoc,
  announcementContentHash,
  announcementDismissKey,
  announcementPageKind,
  announcementWindowState,
  autoForeground,
  eligibleAnnouncements,
  nextAnnouncementBoundary,
  normalizeAnnouncements,
  parseAnnouncementInstant,
  resolveAnnouncementSurface,
} from "../announcements";
import { normalizePresentationConfig } from "../config";
import { contrastRatio } from "../tokens";

/**
 * CUST-HV V3 — twin of the PHP authority. Every case below is the same JSON
 * the PHP suite (`StorefrontPresentationAnnouncementsTest`) and the other app
 * read: tests/Fixtures/presentation/announcements.json. A change to the
 * contract is therefore a change to one file and three green suites.
 */
interface Fixture {
  cases: { name: string; input: unknown; expected: unknown }[];
  contrast: {
    fg: string;
    bg: string;
    ratio: number;
    passesNormalText: boolean;
  }[];
  autoForeground: { background: string; foreground: string }[];
  windows: {
    name: string;
    window: { startsAt?: string; endsAt?: string } | null;
    now: string;
    eligible: boolean;
  }[];
}

// Both apps run vitest from their own directory (one level below the repo root).
const fixture = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "..",
      "tests/Fixtures/presentation/announcements.json",
    ),
    "utf8",
  ),
) as Fixture;

describe("announcements — normaliser parity with PHP (shared fixture)", () => {
  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      expect(normalizeAnnouncements(testCase.input)).toEqual(testCase.expected);
    });
  }

  it("is a fixed point: normalising a normalised document changes nothing", () => {
    for (const testCase of fixture.cases) {
      const once = normalizeAnnouncements(testCase.input);
      expect(normalizeAnnouncements(once)).toEqual(once);
    }
  });

  it("an absent document stays absent through the whole config normaliser", () => {
    expect("announcements" in normalizePresentationConfig({})).toBe(false);
    expect(
      "announcements" in normalizePresentationConfig({ announcements: null }),
    ).toBe(false);
    expect(
      "announcements" in
        normalizePresentationConfig({
          announcements: { enabled: false, items: [] },
        }),
    ).toBe(false);
  });

  it("a present document survives the whole config normaliser untouched", () => {
    const doc = fixture.cases.find((c) =>
      c.name.startsWith("behaviour: only non-default"),
    );
    const config = normalizePresentationConfig({ announcements: doc?.input });
    expect(config.announcements).toEqual(doc?.expected);
  });
});

describe("announcements — contrast maths (shared fixture)", () => {
  for (const c of fixture.contrast) {
    it(`${c.fg} on ${c.bg} = ${c.ratio}`, () => {
      const ratio = contrastRatio(c.fg, c.bg);
      expect(Math.abs(ratio - c.ratio)).toBeLessThan(0.005);
      expect(ratio >= 4.5).toBe(c.passesNormalText);
    });
  }

  for (const c of fixture.autoForeground) {
    it(`automatic foreground on ${c.background} is ${c.foreground}`, () => {
      expect(autoForeground(c.background)).toBe(c.foreground);
    });
  }

  it("a custom text colour that fails 4.5:1 is replaced by the automatic one (never rendered)", () => {
    const resolved = resolveAnnouncementSurface({
      background: { hex: "#ffffff" },
      text: { hex: "#777777" },
      link: { hex: "#767676" },
    });
    expect(resolved?.foreground).toBe("#000000");
    expect(resolved?.link).toBe("#767676");
    expect(resolved?.failsContrast).toBe(true);
    for (const value of [resolved?.foreground, resolved?.link]) {
      expect(contrastRatio(value as string, "#ffffff")).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("no custom background means the theme surface applies", () => {
    expect(resolveAnnouncementSurface(undefined)).toBeNull();
  });

  it("a custom background without a text colour always gets a readable one — across the whole grey ramp and the saturated primaries", () => {
    const ramp = Array.from(
      { length: 256 },
      (_, v) => `#${v.toString(16).padStart(2, "0").repeat(3)}`,
    );
    for (const hex of [
      ...ramp,
      "#d1456a",
      "#ff9900",
      "#0f766e",
      "#fde68a",
      "#ff0000",
      "#00ff00",
      "#0000ff",
    ]) {
      const resolved = resolveAnnouncementSurface({ background: { hex } });
      expect(resolved?.failsContrast).toBe(false);
      expect(
        contrastRatio(resolved?.foreground as string, hex),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("announcements — window evaluation (shared fixture)", () => {
  for (const c of fixture.windows) {
    it(c.name, () => {
      const now = Date.parse(c.now);
      const state = announcementWindowState(c.window ?? undefined, now);
      expect(state === "open").toBe(c.eligible);
      expect(state === "invalid").toBe(
        c.window !== null && /fails closed|invalid|malformed/.test(c.name),
      );
    });
  }

  it("reports scheduled / expired distinctly from invalid", () => {
    const now = Date.parse("2026-10-06T12:00:00Z");
    expect(
      announcementWindowState({ startsAt: "2026-11-01T00:00:00Z" }, now),
    ).toBe("scheduled");
    expect(
      announcementWindowState({ endsAt: "2026-09-01T00:00:00Z" }, now),
    ).toBe("expired");
  });

  it("parses only strict instants", () => {
    expect(parseAnnouncementInstant("2026-10-06T12:00:00Z")).toBe(
      Date.UTC(2026, 9, 6, 12),
    );
    expect(parseAnnouncementInstant("2026-10-06T15:00:00+03:00")).toBe(
      Date.UTC(2026, 9, 6, 12),
    );
    expect(parseAnnouncementInstant("2026-10-06T12:00:00.250Z")).toBe(
      Date.UTC(2026, 9, 6, 12, 0, 0, 250),
    );
    expect(parseAnnouncementInstant("2026-10-06")).toBeNull();
    expect(parseAnnouncementInstant("2026-10-06 12:00:00Z")).toBeNull();
    expect(parseAnnouncementInstant("")).toBeNull();
  });

  it("finds the next moment eligibility can change", () => {
    const doc = normalizeAnnouncements({
      enabled: true,
      items: [
        {
          id: "a",
          text: "x",
          window: {
            startsAt: "2026-10-07T00:00:00Z",
            endsAt: "2026-10-09T00:00:00Z",
          },
        },
        { id: "b", text: "x", window: { endsAt: "2026-10-06T18:00:00Z" } },
        { id: "c", text: "x", window: { startsAt: "garbage" } },
      ],
    });
    const now = Date.parse("2026-10-06T12:00:00Z");
    expect(nextAnnouncementBoundary(doc, now)).toBe(
      Date.parse("2026-10-06T18:00:00Z"),
    );
    expect(
      nextAnnouncementBoundary(doc, Date.parse("2026-10-10T00:00:00Z")),
    ).toBeNull();
    expect(nextAnnouncementBoundary(null, now)).toBeNull();
  });
});

describe("announcements — eligibility and page targeting", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  const doc = (items: unknown[], enabled = true): AnnouncementsDoc =>
    normalizeAnnouncements({ enabled, items }) as AnnouncementsDoc;

  it("the default display is the first eligible item, in document order", () => {
    const d = doc([
      { id: "a", text: "A", enabled: false },
      { id: "b", text: "B", window: { startsAt: "2027-01-01T00:00:00Z" } },
      { id: "c", text: "C" },
      { id: "d", text: "D" },
    ]);
    expect(eligibleAnnouncements(d, "home", now).map((i) => i.id)).toEqual([
      "c",
      "d",
    ]);
  });

  it("a disabled bar, an empty text and an invalid window never render", () => {
    expect(
      eligibleAnnouncements(doc([{ id: "a", text: "A" }], false), "home", now),
    ).toEqual([]);
    expect(
      eligibleAnnouncements(doc([{ id: "a", text: "   " }]), "home", now),
    ).toEqual([]);
    expect(
      eligibleAnnouncements(
        doc([{ id: "a", text: "A", window: { endsAt: "x" } }]),
        "home",
        now,
      ),
    ).toEqual([]);
    expect(eligibleAnnouncements(null, "home", now)).toEqual([]);
  });

  it("pages target home / product / category; absent or all = every eligible page", () => {
    const d = doc([
      { id: "h", text: "H", pages: ["home"] },
      { id: "p", text: "P", pages: ["product", "category"] },
      { id: "x", text: "X" },
      { id: "a", text: "A", pages: ["all"] },
    ]);
    expect(eligibleAnnouncements(d, "home", now).map((i) => i.id)).toEqual([
      "h",
      "x",
      "a",
    ]);
    expect(eligibleAnnouncements(d, "product", now).map((i) => i.id)).toEqual([
      "p",
      "x",
      "a",
    ]);
    expect(eligibleAnnouncements(d, "category", now).map((i) => i.id)).toEqual([
      "p",
      "x",
      "a",
    ]);
    // "other" (listing, policies…) only ever shows untargeted/all items.
    expect(eligibleAnnouncements(d, "other", now).map((i) => i.id)).toEqual([
      "x",
      "a",
    ]);
  });

  it("never renders where the page is not on the allow-list (cart, checkout, account, unknown)", () => {
    const d = doc([{ id: "a", text: "A", pages: ["all"] }]);
    expect(eligibleAnnouncements(d, null, now)).toEqual([]);
  });

  it("classifies storefront paths and fails closed on everything else", () => {
    const base = "/sa/ar";
    expect(announcementPageKind("/sa/ar", base)).toBe("home");
    expect(announcementPageKind("/sa/ar/", base)).toBe("home");
    expect(announcementPageKind("/sa/ar/products/blue-mug", base)).toBe(
      "product",
    );
    expect(announcementPageKind("/sa/ar/products", base)).toBe("other");
    expect(announcementPageKind("/sa/ar/c/mugs", base)).toBe("category");
    expect(announcementPageKind("/sa/ar/c/mugs/ceramic", base)).toBe(
      "category",
    );
    expect(announcementPageKind("/sa/ar/policies/shipping", base)).toBe(
      "other",
    );
    for (const blocked of [
      "/sa/ar/cart",
      "/sa/ar/checkout",
      "/sa/ar/checkout/payment",
      "/sa/ar/account",
      "/sa/ar/account/orders/1",
      "/sa/ar/account/register",
      "/sa/ar/anything-new",
      "/sa/ar/products/a/b",
      "/sa/en/products/x",
      "/other",
    ]) {
      expect(announcementPageKind(blocked, base), blocked).toBeNull();
    }
    expect(announcementPageKind("/", "")).toBe("home");
    expect(announcementPageKind("/cart", "")).toBeNull();
  });
});

describe("announcements — dismissal identity", () => {
  const item = (over: Record<string, unknown> = {}) =>
    (
      normalizeAnnouncements({
        enabled: true,
        items: [{ id: "promo", text: "خصم 20٪", ...over }],
      }) as AnnouncementsDoc
    ).items[0];

  it("keys on the announcement id and a hash of text / link / window only", () => {
    const key = announcementDismissKey(item());
    expect(key).toMatch(/^awj\.ann\.promo\.[0-9a-f]{8}$/);
    expect(announcementDismissKey(item())).toBe(key);
    expect(
      announcementDismissKey(
        item({ icon: "tag", surface: { background: { hex: "#112233" } } }),
      ),
    ).toBe(key);
  });

  it("editing the message, the link or the window makes it reappear", () => {
    const base = announcementContentHash(item());
    expect(announcementContentHash(item({ text: "خصم 25٪" }))).not.toBe(base);
    expect(announcementContentHash(item({ href: "/offers" }))).not.toBe(base);
    expect(
      announcementContentHash(
        item({ window: { endsAt: "2026-12-31T00:00:00Z" } }),
      ),
    ).not.toBe(base);
  });

  it("carries no user or tenant identifier", () => {
    expect(announcementDismissKey(item())).not.toMatch(/tenant|user|store/i);
  });
});

describe("announcements — low years and sub-ms precision (CUST-HV V6c-1)", () => {
  it("reads years 0001–0099 as written (Date.UTC would remap them to 19xx) and keeps the window open", () => {
    expect(parseAnnouncementInstant("0001-01-01T00:00:00Z")).toBe(
      -62135596800000,
    );
    expect(parseAnnouncementInstant("0099-12-31T23:59:59Z")).toBe(
      -59011459201000,
    );
    expect(parseAnnouncementInstant("0001-02-29T00:00:00Z")).toBeNull(); // year 1 is not a leap year
    expect(parseAnnouncementInstant("0000-01-01T00:00:00Z")).toBeNull(); // no year 0, as in the server gate
    expect(
      announcementWindowState(
        { startsAt: "0000-01-01T00:00:00Z", endsAt: "9999-01-01T00:00:00Z" },
        Date.parse("2026-10-10T00:00:00Z"),
      ),
    ).toBe("invalid");
    const now = Date.parse("2026-10-10T00:00:00Z");
    expect(
      announcementWindowState(
        { startsAt: "0001-01-01T00:00:00Z", endsAt: "2999-01-01T00:00:00Z" },
        now,
      ),
    ).toBe("open");
  });

  it("truncates fractional digits to milliseconds, as the server gate does", () => {
    expect(parseAnnouncementInstant("2026-10-06T10:00:00.0009Z")).toBe(
      parseAnnouncementInstant("2026-10-06T10:00:00.000Z"),
    );
    expect(parseAnnouncementInstant("2026-10-06T10:00:00.123456Z")).toBe(
      Date.UTC(2026, 9, 6, 10, 0, 0, 123),
    );
  });
});
