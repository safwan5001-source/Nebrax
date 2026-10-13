/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PresentationVersionRevisionDetail,
  PresentationVersionRevisionSummary,
} from "@/modules/commerce-workspace/presentation-versions";
import { HistoryPreviewBar, groupMediaIssues } from "../history/HistoryPreviewBar";
import { RevisionHistoryDialog } from "../history/RevisionHistoryDialog";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation";

afterEach(cleanup);

function rev(overrides: Partial<PresentationVersionRevisionSummary> = {}): PresentationVersionRevisionSummary {
  return {
    id: "r1",
    versionId: "v1",
    versionRevision: 3,
    schemaVersion: 3,
    sizeBytes: 1500,
    createdAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    isCurrent: false,
    ...overrides,
  };
}

function setup(props: Partial<React.ComponentProps<typeof RevisionHistoryDialog>> = {}) {
  const handlers = { onPreview: vi.fn(), onRestore: vi.fn(), onRetry: vi.fn(), onClose: vi.fn() };
  render(
    <RevisionHistoryDialog
      locale="en"
      versionName="Ramadan"
      published={false}
      dirty={false}
      listState="ready"
      revisions={[rev({ id: "r2", isCurrent: true }), rev()]}
      busyId={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("RevisionHistoryDialog (CUST-H5-4)", () => {
  it("is an accessible modal dialog named by its title, with the focus moved inside on open", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Saved history" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("lists snapshots in merchant language (relative + absolute time), never revision numbers", () => {
    setup();
    const rows = document.querySelectorAll("[data-history-row]");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Same as current");
    expect(rows[1].textContent).toMatch(/3 hours ago/);
    expect(document.querySelector("[data-history-list]")?.textContent).not.toMatch(/revision|rev\.|#\d/i);
  });

  it("Preview and Restore call their handlers with the exact snapshot", () => {
    const h = setup();
    const row = document.querySelectorAll("[data-history-row]")[1] as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Preview" }));
    fireEvent.click(within(row).getByRole("button", { name: "Restore" }));
    expect(h.onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }));
    expect(h.onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }));
  });

  it("Restore is disabled, with the reason, for the snapshot identical to the current version", () => {
    setup();
    const current = document.querySelector("[data-history-current]") as HTMLElement;
    const restore = within(current).getByRole("button", { name: "Restore" }) as HTMLButtonElement;
    expect(restore.disabled).toBe(true);
    expect(restore.title).toMatch(/nothing to restore/i);
    // Preview stays available for it.
    expect((within(current).getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a Published version offers «Create draft» (never an in-place Restore) and explains why", () => {
    setup({ published: true });
    expect(screen.getAllByRole("button", { name: "Create draft" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
    expect(screen.getByRole("dialog").textContent).toMatch(/published and cannot be edited/i);
    // …and even the "current" snapshot can be turned into a draft.
    const current = document.querySelector("[data-history-current]") as HTMLElement;
    expect((within(current).getByRole("button", { name: "Create draft" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("warns that Restore replaces unsaved changes (and that Undo recovers them)", () => {
    setup({ dirty: true });
    expect(document.querySelector("[data-history-dirty-note]")?.textContent).toMatch(/unsaved changes.*Undo/i);
    cleanup();
    setup({ dirty: false });
    expect(document.querySelector("[data-history-dirty-note]")).toBeNull();
  });

  it("loading, error (with retry) and empty states are honest", () => {
    setup({ listState: "loading", revisions: [] });
    expect(screen.getByRole("status").textContent).toMatch(/Loading history/);
    cleanup();

    const h = setup({ listState: "error", revisions: [] });
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn't load/);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(h.onRetry).toHaveBeenCalled();
    cleanup();

    setup({ listState: "ready", revisions: [] });
    expect(document.querySelector("[data-history-empty]")?.textContent).toMatch(/No snapshots yet/);
  });

  it("disables every action while a snapshot is loading (no double requests)", () => {
    setup({ busyId: "r1" });
    const buttons = Array.from(document.querySelectorAll("[data-history-row] button")) as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });

  it("Escape and the close button close; clicking the backdrop closes; clicking inside does not", () => {
    const h = setup();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(h.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(h.onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("dialog"));
    expect(h.onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(h.onClose).toHaveBeenCalledTimes(3);
  });

  it("Tab wraps inside the dialog (focus trap, both directions)", () => {
    setup({ revisions: [rev()] });
    const dialog = screen.getByRole("dialog");
    const buttons = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled])"));
    const last = buttons[buttons.length - 1];
    last.focus();
    const forward = fireEvent.keyDown(last, { key: "Tab" });
    expect(forward).toBe(false); // default prevented — focus moved by the trap
    expect(document.activeElement).toBe(buttons[0]);
    const backward = fireEvent.keyDown(buttons[0], { key: "Tab", shiftKey: true });
    expect(backward).toBe(false);
    expect(document.activeElement).toBe(last);
  });

  it("renders in Arabic RTL strings", () => {
    setup({ locale: "ar" });
    expect(screen.getByRole("dialog", { name: "السجل المحفوظ" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "استرداد" }).length).toBeGreaterThan(0);
  });
});

function detail(overrides: Partial<PresentationVersionRevisionDetail> = {}): PresentationVersionRevisionDetail {
  return { ...rev(), config: DEFAULT_PRESENTATION_CONFIG, mediaIssues: [], ...overrides };
}

describe("HistoryPreviewBar (CUST-H5-4)", () => {
  function bar(props: Partial<React.ComponentProps<typeof HistoryPreviewBar>> = {}) {
    const h = { onRestore: vi.fn(), onExit: vi.fn() };
    render(<HistoryPreviewBar locale="en" revision={detail()} published={false} dirty={false} busy={false} {...h} {...props} />);
    return h;
  }

  it("states it is read-only and offers Restore + Exit", () => {
    const h = bar();
    expect(document.querySelector("[data-history-preview-bar]")?.textContent).toMatch(/Read-only/);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    fireEvent.click(screen.getByRole("button", { name: "Exit preview" }));
    expect(h.onRestore).toHaveBeenCalled();
    expect(h.onExit).toHaveBeenCalled();
  });

  it("shows no media warning when the snapshot's media is healthy", () => {
    bar();
    expect(document.querySelector("[data-history-media-issues]")).toBeNull();
  });

  it("groups current media issues by cause in merchant language (no technical paths)", () => {
    bar({
      revision: detail({
        mediaIssues: [
          { path: "branding.logoMedia.mediaId", code: "media_missing", message: "" },
          { path: "homepage.sections.0.design.background.media.mediaId", code: "media_missing", message: "" },
          { path: "branding.faviconMedia.mediaId", code: "media_not_ready", message: "" },
        ],
      }),
    });
    const box = document.querySelector("[data-history-media-issues]") as HTMLElement;
    expect(box.getAttribute("role")).toBe("alert");
    expect(box.textContent).toMatch(/3 image\(s\)/);
    expect(box.textContent).toMatch(/Image deleted or unavailable ×2/);
    expect(box.textContent).toMatch(/Image not ready yet/);
    expect(box.textContent).not.toMatch(/branding\.|homepage\.|mediaId/);
  });

  it("groupMediaIssues maps every restorable code and falls back to not-ready", () => {
    expect(groupMediaIssues([
      { path: "a", code: "media_missing", message: "" },
      { path: "b", code: "derivative_failed", message: "" },
      { path: "c", code: "something_new", message: "" },
    ])).toEqual([
      { key: "historyMediaMissing", count: 1 },
      { key: "historyMediaNotReady", count: 2 },
    ]);
  });

  it("a Published version's preview offers «Create draft»; the identical-to-current snapshot cannot be restored in place", () => {
    bar({ published: true });
    expect(screen.getByRole("button", { name: "Create draft" })).toBeTruthy();
    cleanup();
    bar({ revision: detail({ isCurrent: true }) });
    expect((screen.getByRole("button", { name: "Restore" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("«current» only means equal to the SAVED document: with unsaved edits its Restore stays available (preview bar and list)", () => {
    bar({ revision: detail({ isCurrent: true }), dirty: true });
    expect((screen.getByRole("button", { name: "Restore" }) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    setup({ dirty: true });
    const rows = document.querySelectorAll("[data-history-row]");
    expect((within(rows[0] as HTMLElement).getByRole("button", { name: "Restore" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables both actions while the restore is in flight", () => {
    bar({ busy: true });
    expect((screen.getByRole("button", { name: "Restore" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Exit preview" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
