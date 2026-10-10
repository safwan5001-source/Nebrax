/**
 * @vitest-environment jsdom
 *
 * CUST-HV V6c-1 (V0 §8.4, D-15, AMEND-7) — the published storefront judges a banner's visibility window per
 * request (no second scheduler): `startsAt` inclusive, `endsAt` exclusive, a banner outside its window is
 * omitted outright (no wrapper, no empty band), and a malformed/inverted window never reads as "no window".
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PresentationHomeSection } from "@/lib/presentation/config";
import { publishedNodes } from "../published-nodes";

afterEach(cleanup);

const NOW = Date.parse("2026-12-15T12:00:00Z");

const ctx = {
  implemented: {},
  basePath: "/sa/en",
  locale: "en",
  themePreset: undefined,
  apps: { iosUrl: "", androidUrl: "", appName: "" },
  benefitsTitle: "b",
  featuredTitle: "f",
  offersTitle: "o",
  appTitle: "a",
  appStoreLabel: "as",
  playStoreLabel: "ps",
  design: { primaryColor: "#12372a", accentColor: null, dir: "ltr" as const },
};

const banner = (
  window?: { startsAt?: string; endsAt?: string },
  design?: PresentationHomeSection["design"],
): PresentationHomeSection =>
  ({
    id: "ban",
    type: "banner",
    visible: true,
    content: {
      title: "Winter sale",
      subtitle: "",
      ctaLabel: "",
      ctaHref: "",
      imageUrl: null,
      ...(window ? { window } : {}),
    },
    ...(design ? { design } : {}),
  }) as PresentationHomeSection;

async function mount(
  sections: PresentationHomeSection[],
  extra: Record<string, unknown> = { nowMs: NOW },
) {
  const nodes = await publishedNodes(sections, { ...ctx, ...extra } as never);
  return render(<div>{nodes}</div>).container;
}

const shown = (c: HTMLElement) => c.textContent?.includes("Winter sale");

describe("published banner window", () => {
  it("a banner without a window is shown exactly as before", async () => {
    expect(shown(await mount([banner()]))).toBe(true);
  });

  it("inside the window ⇒ shown; before it (scheduled) and after it (expired) ⇒ omitted", async () => {
    const inside = {
      startsAt: "2026-12-01T00:00:00Z",
      endsAt: "2026-12-31T00:00:00Z",
    };
    expect(shown(await mount([banner(inside)]))).toBe(true);

    const future = {
      startsAt: "2026-12-20T00:00:00Z",
      endsAt: "2026-12-31T00:00:00Z",
    };
    expect(shown(await mount([banner(future)]))).toBeFalsy();

    const past = {
      startsAt: "2026-11-01T00:00:00Z",
      endsAt: "2026-12-01T00:00:00Z",
    };
    expect(shown(await mount([banner(past)]))).toBeFalsy();
  });

  it("startsAt is inclusive and endsAt is exclusive, to the millisecond", async () => {
    const exactStart = { startsAt: "2026-12-15T12:00:00Z" };
    expect(shown(await mount([banner(exactStart)]))).toBe(true);
    const justBefore = { startsAt: "2026-12-15T12:00:00.001Z" };
    expect(shown(await mount([banner(justBefore)]))).toBeFalsy();

    const exactEnd = { endsAt: "2026-12-15T12:00:00Z" };
    expect(shown(await mount([banner(exactEnd)]))).toBeFalsy();
    const justAfter = { endsAt: "2026-12-15T12:00:00.001Z" };
    expect(shown(await mount([banner(justAfter)]))).toBe(true);
  });

  it("one open edge is enough; zone offsets compare as absolute instants", async () => {
    expect(
      shown(await mount([banner({ startsAt: "2026-12-15T14:00:00+03:00" })])),
    ).toBe(true); // 11:00Z ≤ now
    expect(
      shown(await mount([banner({ startsAt: "2026-12-15T16:00:00+03:00" })])),
    ).toBeFalsy(); // 13:00Z > now
    expect(
      shown(await mount([banner({ endsAt: "2027-01-01T00:00:00Z" })])),
    ).toBe(true);
  });

  it("a malformed or inverted window is NEVER read as 'no window' — the banner is omitted (fail-closed)", async () => {
    for (const window of [
      { startsAt: "next tuesday" },
      { endsAt: "2026-02-31T00:00:00Z" },
      { startsAt: "2026-12-31T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" },
      { startsAt: "2026-12-10T00:00:00Z", endsAt: "2026-12-10T00:00:00Z" },
    ]) {
      expect(shown(await mount([banner(window)]))).toBeFalsy();
    }
  });

  it("an omitted banner leaves no wrapper behind, even when it carries a design", async () => {
    const container = await mount([
      banner(
        { endsAt: "2026-12-01T00:00:00Z" },
        { background: { kind: "solid", color: { hex: "#fde68a" } } },
      ),
    ]);
    expect(container.querySelector("[data-sd]")).toBeNull();
    expect(container.querySelector("section")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("without an injected clock the request time is used", async () => {
    const wide = {
      startsAt: "2000-01-01T00:00:00Z",
      endsAt: "2999-01-01T00:00:00Z",
    };
    expect(shown(await mount([banner(wide)], {}))).toBe(true);
    const expired = {
      startsAt: "2000-01-01T00:00:00Z",
      endsAt: "2001-01-01T00:00:00Z",
    };
    expect(shown(await mount([banner(expired)], {}))).toBeFalsy();
    const scheduled = { startsAt: "2999-01-01T00:00:00Z" };
    expect(shown(await mount([banner(scheduled)], {}))).toBeFalsy();
  });

  it("only the banner with the closed window disappears; its neighbours are untouched", async () => {
    const container = await mount([
      { ...banner(), id: "open" },
      {
        ...banner({ endsAt: "2026-12-01T00:00:00Z" }),
        id: "closed",
      } as PresentationHomeSection,
    ]);
    expect(container.querySelectorAll("section")).toHaveLength(1);
  });
});
