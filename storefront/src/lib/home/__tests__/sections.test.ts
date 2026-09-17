import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOME_SECTIONS,
  type HomeSection,
  resolveHomeSections,
} from "../sections";

describe("resolveHomeSections", () => {
  it("falls back to the default order when nothing is configured", () => {
    expect(resolveHomeSections()).toEqual([...DEFAULT_HOME_SECTIONS]);
    expect(resolveHomeSections([])).toEqual([...DEFAULT_HOME_SECTIONS]);
  });

  it("honours a configured order", () => {
    const configured: HomeSection[] = [
      { key: "newArrivals", visible: true },
      { key: "hero", visible: false },
    ];

    expect(resolveHomeSections(configured).slice(0, 2)).toEqual(configured);
  });

  it("drops keys this build does not implement", () => {
    const configured = [
      { key: "banner", visible: true },
      { key: "hero", visible: true },
    ] as unknown as HomeSection[];

    expect(
      resolveHomeSections(configured).some((s) => String(s.key) === "banner"),
    ).toBe(false);
  });

  it("keeps implemented sections a partial configuration omits", () => {
    // A stale configuration must not be able to blank the homepage.
    const resolved = resolveHomeSections([{ key: "hero", visible: true }]);
    expect(resolved.map((s) => s.key).sort()).toEqual(
      [...DEFAULT_HOME_SECTIONS].map((s) => s.key).sort(),
    );
  });
});
