/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnouncementPreview } from "../AnnouncementPreview";
import { ControlPanels } from "../ControlPanels";
import { describePublishIssues } from "../announcement-status";
import { CUSTOMIZER_MESSAGES, customizerMessage } from "../messages";
import type { AnnouncementsDoc } from "../presentation/announcements";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";

const NOW = Date.parse("2026-06-15T12:00:00Z");

function renderPanel(
  doc: AnnouncementsDoc | undefined,
  onChange = vi.fn(),
  locale: "ar" | "en" = "en",
) {
  render(
    <ControlPanels
      panel="announcements"
      config={{ ...DEFAULT_PRESENTATION_CONFIG, announcements: doc }}
      locale={locale}
      liveStoreName={null}
      timezone="Asia/Riyadh"
      onChange={onChange}
    />,
  );
  return onChange;
}

const lastDoc = (fn: ReturnType<typeof vi.fn>): AnnouncementsDoc =>
  fn.mock.calls.at(-1)?.[0].announcements;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Announcements panel (CUST-HV V3)", () => {
  it("has AR and EN copy for every key it uses (parity)", () => {
    const keys = Object.keys(CUSTOMIZER_MESSAGES.en).filter((k) => k.startsWith("ann"));
    for (const key of keys) {
      expect(Object.keys(CUSTOMIZER_MESSAGES.ar)).toContain(key);
    }
    expect(keys.length).toBeGreaterThan(60);
  });

  it("starts empty and adding a message creates a normaliser-valid item", async () => {
    const onChange = renderPanel(undefined);
    expect(screen.getByText(/No messages yet/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add message" }));
    const doc = lastDoc(onChange);
    expect(doc.enabled).toBe(false);
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0].id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(doc.items[0].enabled).toBe(true);
  });

  it("caps at five messages and says so", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, text: `m${i}`, enabled: true }));
    renderPanel({ enabled: true, items });
    const add = screen.getByRole("button", { name: "Add message" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.getByText(/Maximum reached/)).toBeTruthy();
  });

  it("reorders and removes with keyboard-operable buttons", async () => {
    const items = [
      { id: "a", text: "first", enabled: true },
      { id: "b", text: "second", enabled: true },
    ];
    const onChange = renderPanel({ enabled: true, items });
    const row = (id: string) => document.querySelector(`[data-announcement-item="${id}"]`) as HTMLElement;
    await userEvent.click(within(row("b")).getByRole("button", { name: "Move up" }));
    expect(lastDoc(onChange).items.map((i) => i.id)).toEqual(["b", "a"]);
    await userEvent.click(within(row("a")).getByRole("button", { name: "Remove message" }));
    expect(lastDoc(onChange).items.map((i) => i.id)).toEqual(["b"]);
    expect((within(row("a")).getByRole("button", { name: "Move up" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows live status per message and flags a disabled one", () => {
    renderPanel({
      enabled: true,
      items: [
        { id: "a", text: "on", enabled: true },
        { id: "b", text: "off", enabled: false },
        { id: "c", text: "later", enabled: true, window: { startsAt: "2999-01-01T00:00:00Z" } },
        { id: "d", text: "bad", enabled: true, window: { startsAt: "2026-02-31T00:00:00Z" } },
      ],
    });
    expect(screen.getByText("Live now")).toBeTruthy();
    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.getByText("Scheduled")).toBeTruthy();
    expect(screen.getByText("Invalid window")).toBeTruthy();
  });

  it("counts characters and writes text verbatim (the normaliser trims, not the editor)", () => {
    const onChange = renderPanel({ enabled: true, items: [{ id: "a", text: "", enabled: true }] });
    const box = screen.getByLabelText(/^Message text/);
    fireEvent.change(box, { target: { value: "  Free shipping  " } });
    expect(lastDoc(onChange).items[0].text).toBe("  Free shipping  ");
    expect(screen.getByText("0/120")).toBeTruthy();
  });

  it("custom colours show the contrast ratio and flag a pair that cannot publish", () => {
    renderPanel({
      enabled: true,
      items: [
        {
          id: "a",
          text: "x",
          enabled: true,
          surface: { background: { hex: "#777777" }, text: { hex: "#888888" } },
        },
      ],
    });
    const readout = document.querySelector("[data-announcement-contrast]") as HTMLElement;
    expect(readout.textContent).toMatch(/1\.\d\d:1/);
    expect(readout.textContent).toContain("will not publish");
  });

  it("an automatic text colour always reads as readable", () => {
    renderPanel({
      enabled: true,
      items: [{ id: "a", text: "x", enabled: true, surface: { background: { hex: "#777777" } } }],
    });
    const readout = document.querySelector("[data-announcement-contrast]") as HTMLElement;
    expect(readout.textContent).toContain("Readable");
    expect(Number.parseFloat(readout.textContent?.match(/(\d+\.\d+):1/)?.[1] ?? "0")).toBeGreaterThanOrEqual(4.5);
  });

  it("a link colour that cannot publish is visible and fixable, even when it came from an older draft or the API", async () => {
    const onChange = renderPanel({
      enabled: true,
      items: [
        {
          id: "a",
          text: "x",
          enabled: true,
          surface: { background: { hex: "#777777" }, link: { hex: "#888888" } },
        },
      ],
    });
    const readout = document.querySelector("[data-announcement-link-contrast]") as HTMLElement;
    expect(readout.textContent).toContain("will not publish");
    // Switching back to "same as text" drops the offending value entirely.
    await userEvent.click(screen.getByRole("button", { name: "Same as text" }));
    expect(lastDoc(onChange).items[0].surface?.link).toBeUndefined();
    expect(lastDoc(onChange).items[0].surface?.background.hex).toBe("#777777");
  });

  it("offers a link colour only where a link exists, and starts from the text colour", async () => {
    const onChange = renderPanel({
      enabled: true,
      items: [{ id: "a", text: "x", enabled: true, href: "/offers", surface: { background: { hex: "#0f766e" } } }],
    });
    await userEvent.click(screen.getAllByRole("button", { name: "Custom" })[1]);
    expect(lastDoc(onChange).items[0].surface?.link?.hex).toBe("#ffffff");
  });

  it("window edges are entered in store time and stored as a UTC instant; clearing removes them", () => {
    const onChange = renderPanel({ enabled: true, items: [{ id: "a", text: "x", enabled: true }] });
    fireEvent.change(screen.getByLabelText("Starts — Date"), { target: { value: "2026-07-01" } });
    expect(onChange).not.toHaveBeenCalled(); // half-filled edge is held, never written
    expect(screen.getByText("Enter both date and time.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Starts — Time"), { target: { value: "09:30" } });
    // 09:30 in Asia/Riyadh (UTC+3) = 06:30Z
    expect(lastDoc(onChange).items[0].window?.startsAt).toBe("2026-07-01T06:30:00.000Z");
  });

  it("an inverted window is called out in the panel", () => {
    renderPanel({
      enabled: true,
      items: [
        {
          id: "a",
          text: "x",
          enabled: true,
          window: { startsAt: "2026-07-02T00:00:00.000Z", endsAt: "2026-07-01T00:00:00.000Z" },
        },
      ],
    });
    expect(screen.getByRole("alert").textContent).toContain("end must be after the start");
  });

  it("choosing every page (or none) stores no `pages` — absent means all", async () => {
    const onChange = renderPanel({
      enabled: true,
      items: [{ id: "a", text: "x", enabled: true, pages: ["home", "product"] }],
    });
    await userEvent.click(screen.getByLabelText("Category"));
    expect(lastDoc(onChange).items[0].pages).toBeUndefined();
  });

  it("a ticker switches rotation off and disables its toggle", () => {
    renderPanel({ enabled: true, items: [], behaviour: { ticker: true } });
    const rotate = screen.getByLabelText("Rotate messages") as HTMLInputElement;
    expect(rotate.disabled).toBe(true);
  });

  it("turning the ticker on clears rotate/rotateInterval", async () => {
    const onChange = renderPanel({
      enabled: true,
      items: [],
      behaviour: { rotate: true, rotateInterval: 10 },
    });
    await userEvent.click(screen.getByLabelText("Scrolling ticker"));
    const behaviour = lastDoc(onChange).behaviour ?? {};
    expect(behaviour.ticker).toBe(true);
    expect(behaviour.rotate).toBeUndefined();
    expect(behaviour.rotateInterval).toBeUndefined();
  });

  it("renders in Arabic with the same structure", () => {
    renderPanel({ enabled: true, items: [{ id: "a", text: "x", enabled: true }] }, vi.fn(), "ar");
    expect(screen.getByRole("button", { name: "إضافة رسالة" })).toBeTruthy();
  });
});

describe("Announcement preview (Canvas)", () => {
  const doc: AnnouncementsDoc = {
    enabled: true,
    items: [
      { id: "a", text: "Home only", enabled: true, pages: ["home"] },
      { id: "b", text: "Everywhere", enabled: true, icon: "truck" },
      { id: "c", text: "Disabled", enabled: false },
    ],
    behaviour: { rotate: true, sticky: true },
  };

  it("shows the first message eligible for the previewed page and names behaviour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { rerender } = render(<AnnouncementPreview doc={doc} page="home" locale="en" />);
    expect(await screen.findByText("Home only")).toBeTruthy();
    expect(document.querySelector("[data-editor-only]")?.textContent).toContain("Rotate messages 1/2");
    rerender(<AnnouncementPreview doc={doc} page="product" locale="en" />);
    expect(await screen.findByText("Everywhere")).toBeTruthy();
    expect(screen.queryByText("Home only")).toBeNull();
  });

  it("re-evaluates at the next window boundary so an open builder keeps matching the storefront", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(Date.parse("2026-06-15T12:00:00Z"));
    const windowed: AnnouncementsDoc = {
      enabled: true,
      items: [
        { id: "a", text: "Launching soon", enabled: true, window: { startsAt: "2026-06-15T12:10:00.000Z" } },
        { id: "b", text: "Until launch", enabled: true, window: { endsAt: "2026-06-15T12:10:00.000Z" } },
      ],
    };
    render(<AnnouncementPreview doc={windowed} page="home" locale="en" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Until launch")).toBeTruthy();
    expect(screen.queryByText("Launching soon")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000 + 200);
    });
    expect(screen.getByText("Launching soon")).toBeTruthy();
    expect(screen.queryByText("Until launch")).toBeNull();
  });

  it("renders nothing when disabled and says so when nothing is eligible", async () => {
    const { container, rerender } = render(
      <AnnouncementPreview doc={{ ...doc, enabled: false }} page="home" locale="en" />,
    );
    expect(container.textContent).toBe("");
    rerender(
      <AnnouncementPreview
        doc={{ enabled: true, items: [{ id: "x", text: "off", enabled: false }] }}
        page="home"
        locale="en"
      />,
    );
    expect(await screen.findByText(/No eligible message/)).toBeTruthy();
  });

  it("is selectable like the other chrome and keyboard-reachable", async () => {
    const onSelect = vi.fn();
    render(<AnnouncementPreview doc={doc} page="home" locale="en" onSelect={onSelect} />);
    await screen.findByText("Home only");
    await userEvent.click(screen.getByRole("button", { name: "Announcement bar" }));
    expect(onSelect).toHaveBeenCalled();
  });
});

describe("describePublishIssues", () => {
  const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", key);
  it("names the message and the fix for every known code, ignoring unrelated paths", () => {
    const text = describePublishIssues(
      {
        "announcements.items[1].window.endsAt": "window_end_not_after_start",
        "announcements.items[0].surface.text": "contrast_insufficient",
        "announcements.items[2].text": "announcement_text_required",
        "announcements.items[3].window.startsAt": "window_invalid_timestamp",
        "header.style": "other",
      },
      t,
    );
    expect(text).toContain("Cannot publish: announcement bar problem");
    expect(text).toContain("Message 2: the end must be after the start");
    expect(text).toContain("(+1)");
  });
  it("returns null when nothing concerns announcements", () => {
    expect(describePublishIssues({ "header.style": "x" }, t)).toBeNull();
  });
  it("does not leak an unknown code or server text", () => {
    const text = describePublishIssues({ "announcements.items[0].x": "weird_code" }, t);
    expect(text).not.toContain("weird_code");
  });
});
