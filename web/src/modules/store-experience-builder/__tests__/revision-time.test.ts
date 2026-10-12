import { describe, expect, it } from "vitest";
import { absoluteTimeLabel, relativeTimeLabel } from "../history/revision-time";

const NOW = Date.parse("2026-10-12T12:00:00.000Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe("revision time labels (CUST-H5-4)", () => {
  it("English relative times use the largest whole unit", () => {
    expect(relativeTimeLabel(ago(20), "en", NOW)).toBe("now");
    expect(relativeTimeLabel(ago(5 * 60), "en", NOW)).toBe("5 minutes ago");
    expect(relativeTimeLabel(ago(3 * 3600), "en", NOW)).toBe("3 hours ago");
    expect(relativeTimeLabel(ago(26 * 3600), "en", NOW)).toBe("yesterday");
    expect(relativeTimeLabel(ago(3 * 24 * 3600), "en", NOW)).toBe("3 days ago");
    expect(relativeTimeLabel(ago(14 * 24 * 3600), "en", NOW)).toBe("2 weeks ago");
  });

  it("Arabic relative times are Arabic (no revision numbers)", () => {
    const label = relativeTimeLabel(ago(3 * 3600), "ar", NOW);
    expect(label).toMatch(/[؀-ۿ]/);
    expect(label).not.toMatch(/revision/i);
  });

  it("a timestamp slightly in the future or an invalid one never shows a negative or NaN label", () => {
    expect(relativeTimeLabel(new Date(NOW + 5000).toISOString(), "en", NOW)).toBe("now");
    expect(relativeTimeLabel(null, "en", NOW)).toBe("now");
    expect(relativeTimeLabel("not-a-date", "ar", NOW)).not.toMatch(/NaN/);
  });

  it("absolute labels carry date and time in the UI language, and invalid input is a dash", () => {
    expect(absoluteTimeLabel("2026-10-12T10:30:00.000Z", "en")).toMatch(/2026/);
    expect(absoluteTimeLabel("2026-10-12T10:30:00.000Z", "ar")).toMatch(/2026/);
    expect(absoluteTimeLabel(null, "en")).toBe("—");
    expect(absoluteTimeLabel("garbage", "ar")).toBe("—");
  });
});
