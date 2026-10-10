/**
 * @vitest-environment jsdom
 *
 * CUST-HV V6c-1 (V0 §8.4, D-15) — the merchant-side Banner display window: the same shared editor as
 * announcements, entered in the STORE's zone and stored as the exact UTC instant; the Canvas keeps a
 * scheduled/expired/invalid banner visible and editable and says why the storefront will hide it;
 * the publish-gate codes read as one merchant sentence naming the banner.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describePublishIssues } from "../announcement-status";
import { ControlPanels } from "../ControlPanels";
import { CUSTOMIZER_MESSAGES, customizerMessage } from "../messages";
import {
  DEFAULT_PRESENTATION_CONFIG,
  type PresentationHomeSection,
  type StorefrontPresentationConfig,
} from "../presentation/config";
import type { BannerContent } from "../presentation/section-content";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const banner = (content: Partial<BannerContent> = {}): PresentationHomeSection => ({
  id: "banner-1",
  type: "banner",
  visible: true,
  content: { title: "Summer sale", subtitle: "", ctaLabel: "", ctaHref: "", imageUrl: null, ...content },
});

const withSections = (sections: PresentationHomeSection[]): StorefrontPresentationConfig => ({
  ...DEFAULT_PRESENTATION_CONFIG,
  homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, sections },
});

function panel(section: PresentationHomeSection, onChange = vi.fn(), locale: "ar" | "en" = "en") {
  render(
    <ControlPanels
      panel="homepage"
      config={withSections([section])}
      locale={locale}
      liveStoreName={null}
      timezone="Asia/Riyadh"
      onChange={onChange}
      selectedSection="banner-1"
    />,
  );
  return onChange;
}

const lastBanner = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls.at(-1)?.[0].homepage.sections[0].content as BannerContent;

describe("Banner window editor (CUST-HV V6c-1)", () => {
  it("has AR and EN copy for every new key", () => {
    for (const key of [
      "bannerWindowHint",
      "bannerWindowNeedsContent",
      "bannerWindowScheduled",
      "bannerWindowExpired",
      "bannerWindowInvalid",
      "bannerLabel",
    ] as const) {
      expect(CUSTOMIZER_MESSAGES.ar[key]).toBeTruthy();
      expect(CUSTOMIZER_MESSAGES.en[key]).toBeTruthy();
    }
  });

  it("writes the exact UTC instant for wall-clock time entered in the store's zone (UTC+3), never the browser's", () => {
    const onChange = panel(banner());
    fireEvent.change(screen.getByLabelText("Starts — Date"), { target: { value: "2026-12-01" } });
    expect(onChange).not.toHaveBeenCalled(); // half an edge is held locally, never written
    fireEvent.change(screen.getByLabelText("Starts — Time"), { target: { value: "09:30" } });
    expect(lastBanner(onChange).window).toEqual({ startsAt: "2026-12-01T06:30:00.000Z" });
    expect(lastBanner(onChange).title).toBe("Summer sale"); // the rest of the banner untouched
  });

  it("clearing the only edge removes `window` entirely, key and all", () => {
    const onChange = panel(banner({ window: { endsAt: "2026-12-31T20:59:00.000Z" } }));
    fireEvent.click(screen.getAllByRole("button", { name: "Clear" })[1]);
    const content = lastBanner(onChange);
    expect("window" in content).toBe(false);
    expect(content.title).toBe("Summer sale");
  });

  it("shows the store zone and an alert for an inverted window, without blocking the edit", () => {
    panel(banner({ window: { startsAt: "2026-12-31T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" } }));
    expect(screen.getByRole("alert").textContent).toBe(customizerMessage("en", "annWindowInvalid"));
    expect(document.body.textContent).toContain("Riyadh");
  });

  it("offers no window on a banner with nothing to show (the normaliser would drop it)", () => {
    panel(banner({ title: "" }));
    expect(screen.queryByLabelText("Starts — Date")).toBeNull();
    expect(screen.getByText(customizerMessage("en", "bannerWindowNeedsContent"))).toBeTruthy();
  });
});

describe("Canvas banner window chip (CUST-HV V6c-1)", () => {
  const NOW = Date.parse("2026-06-15T12:00:00Z");
  const canvas = (content: Partial<BannerContent>) =>
    render(
      <StorefrontPreviewCanvas
        config={withSections([banner(content)])}
        locale="en"
        viewport="desktop"
        liveStoreName="Shop"
        onSelectSection={() => {}}
      />,
    ).container;

  const chip = (c: HTMLElement) => c.querySelector("[data-banner-window-status]");

  it("keeps the banner visible and labels scheduled / expired / invalid; an open window has no chip", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date", "setTimeout", "clearTimeout"] });
    for (const [window, state] of [
      [{ startsAt: "2026-07-01T00:00:00Z" }, "scheduled"],
      [{ endsAt: "2026-06-01T00:00:00Z" }, "expired"],
      [{ startsAt: "2026-07-01T00:00:00Z", endsAt: "2026-06-01T00:00:00Z" }, "invalid"],
    ] as const) {
      const c = canvas({ window });
      await act(async () => {});
      expect(chip(c)?.getAttribute("data-banner-window-status")).toBe(state);
      expect(c.textContent).toContain("Summer sale");
      cleanup();
    }
    const open = canvas({ window: { startsAt: "2026-06-01T00:00:00Z", endsAt: "2026-07-01T00:00:00Z" } });
    await act(async () => {});
    expect(chip(open)).toBeNull();
    expect(open.textContent).toContain("Summer sale");
  });

  it("flips the chip at the window edge without a reload (one timer)", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date", "setTimeout", "clearTimeout"] });
    const c = canvas({ window: { startsAt: "2026-06-15T12:00:30Z" } });
    await act(async () => {});
    expect(chip(c)?.getAttribute("data-banner-window-status")).toBe("scheduled");
    await act(async () => {
      vi.setSystemTime(NOW + 31_000);
      vi.advanceTimersByTime(31_000);
    });
    expect(chip(c)).toBeNull();
  });

  it("a banner without a window renders exactly as before", async () => {
    const c = canvas({});
    await act(async () => {});
    expect(chip(c)).toBeNull();
  });
});

describe("Publish-gate copy for banner windows (CUST-HV V6c-1)", () => {
  const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", key);

  it("names the banner and the problem; unknown codes never leak", () => {
    expect(
      describePublishIssues({ "homepage.sections[2].content.window.endsAt": "window_end_not_after_start" }, t),
    ).toContain(`${t("bannerLabel")}: ${t("annIssueWindowOrder")}`);
    expect(
      describePublishIssues({ "homepage.sections[0].content.window.startsAt": "window_invalid_timestamp" }, t),
    ).toContain(t("annIssueWindowInvalid"));
    const unknown = describePublishIssues({ "homepage.sections[0].content.window.startsAt": "something_new" }, t);
    expect(unknown).not.toContain("something_new");
  });
});
