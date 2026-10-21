/**
 * @vitest-environment jsdom
 *
 * P3-A-05 — the global background in the real editor: immediate canvas preview, Undo / Redo, dirty state,
 * Save → reload consistency, and the merchant message for the temporary image-publish gate.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();
const showMock = vi.fn();
const saveMock = vi.fn();
const publishMock = vi.fn();

vi.mock("@/modules/commerce-workspace/presentation-versions", () => ({
  listPresentationVersions: (...args: unknown[]) => listMock(...args),
  showPresentationVersion: (...args: unknown[]) => showMock(...args),
  createPresentationVersion: vi.fn(),
  savePresentationVersion: (...args: unknown[]) => saveMock(...args),
  renamePresentationVersion: vi.fn(),
  deletePresentationVersion: vi.fn(),
  publishPresentationVersion: (...args: unknown[]) => publishMock(...args),
}));

import { describePublishIssues } from "../announcement-status";
import { ExperienceBuilder } from "../ExperienceBuilder";
import { customizerMessage } from "../messages";
import { DEFAULT_PRESENTATION_CONFIG, type StorefrontPresentationConfig } from "../presentation";

const LEGACY: StorefrontPresentationConfig = { ...DEFAULT_PRESENTATION_CONFIG, backgroundColor: "#ffeedd" };

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: "v1",
    storefrontId: "store-1",
    name: "رمضان 1448",
    state: "draft",
    schemaVersion: 2,
    revision: 1,
    scheduledFor: null,
    lastPublishedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    publishedRevision: null,
    scheduleToken: "opaque-token-0",
    schedulingRuntimeActive: true,
    ...overrides,
  };
}
const detail = (config: StorefrontPresentationConfig, overrides: Record<string, unknown> = {}) => ({
  ...summary(overrides),
  config,
});

async function mount(config: StorefrontPresentationConfig = LEGACY) {
  listMock.mockResolvedValue({ ok: true, data: [summary()] });
  showMock.mockResolvedValue({ ok: true, data: detail(config) });
  const user = userEvent.setup();
  render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
  await waitFor(() => expect(document.querySelector('[data-selected-version-id="v1"]')).toBeTruthy());
  await user.click(screen.getByRole("button", { name: "المظهر" }));
  return user;
}

const root = () => document.querySelector("[data-experience-builder]") as HTMLElement;
const undoBtn = () => document.querySelector('[data-history-action="undo"]') as HTMLButtonElement;
const redoBtn = () => document.querySelector('[data-history-action="redo"]') as HTMLButtonElement;
const isDisabled = (el: HTMLElement) => el.getAttribute("aria-disabled") === "true";
const canvas = () => document.querySelector(".awj-store-preview") as HTMLElement;
const typeBtn = (name: string) =>
  within(document.querySelector("[data-global-background]") as HTMLElement).getByRole("button", { name });

afterEach(() => {
  cleanup();
  [listMock, showMock, saveMock, publishMock].forEach((m) => m.mockReset());
  vi.restoreAllMocks();
});

describe("ExperienceBuilder — global background (P3-A-05)", () => {
  it("shows the legacy colour on the canvas, and a gradient appears there at once (preview parity)", async () => {
    const user = await mount();
    await waitFor(() => expect(canvas()).toBeTruthy());
    expect(canvas().style.backgroundColor).toBeTruthy();
    expect(canvas().style.backgroundImage).toBe("");

    await user.click(typeBtn("تدرج لوني"));
    await waitFor(() => expect(canvas().style.backgroundImage).toContain("linear-gradient"));
  });

  it("a type change is one Undo step; Undo is clean again, Redo restores it; Reset is its own step", async () => {
    const user = await mount();
    expect(root().getAttribute("data-lifecycle")).toBe("clean");

    await user.click(typeBtn("تدرج لوني"));
    expect(root().getAttribute("data-lifecycle")).toBe("dirty");
    expect(isDisabled(undoBtn())).toBe(false);

    await user.click(undoBtn());
    expect(root().getAttribute("data-lifecycle")).toBe("clean");
    expect(typeBtn("لون ثابت").getAttribute("aria-pressed")).toBe("true");
    expect(canvas().style.backgroundImage).toBe("");

    await user.click(redoBtn());
    expect(typeBtn("تدرج لوني").getAttribute("aria-pressed")).toBe("true");
    expect(canvas().style.backgroundImage).toContain("linear-gradient");

    await user.click(screen.getByRole("button", { name: "استعادة الافتراضي" }));
    expect(canvas().style.backgroundImage).toBe("");
    await user.click(undoBtn());
    expect(canvas().style.backgroundImage).toContain("linear-gradient");
  });

  it("Save persists the normalised document, and reopening it shows the same control state", async () => {
    saveMock.mockImplementation((_s: string, _v: string, config: StorefrontPresentationConfig) =>
      Promise.resolve({ ok: true, data: detail(config, { revision: 2 }) }),
    );
    const user = await mount();
    await user.click(typeBtn("تدرج لوني"));
    fireEvent.change(document.querySelector("[data-global-bg-direction]") as HTMLSelectElement, {
      target: { value: "to-top-end" },
    });
    await user.click(document.querySelector("[data-save]") as HTMLElement);
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const saved = saveMock.mock.calls[0][2] as StorefrontPresentationConfig;
    expect(saved.background).toMatchObject({ kind: "gradient", direction: "to-top-end" });
    expect(saved.backgroundColor).toBe("#ffeedd"); // legacy colour retained as the fallback
    expect(JSON.stringify(saved)).not.toMatch(/https?:|url\(|linear-gradient/);
    await waitFor(() => expect(document.querySelector('[data-selected-version-revision="2"]')).toBeTruthy());
    expect(root().getAttribute("data-lifecycle")).toBe("clean");

    // "Reload": a fresh editor opening the stored document shows the same state.
    cleanup();
    const reopened = await mount(JSON.parse(JSON.stringify(saved)));
    expect(typeBtn("تدرج لوني").getAttribute("aria-pressed")).toBe("true");
    expect((document.querySelector("[data-global-bg-direction]") as HTMLSelectElement).value).toBe("to-top-end");
    expect(root().getAttribute("data-lifecycle")).toBe("clean");
    expect(reopened).toBeTruthy();
  });

  it("Save after Solid ← Gradient persists no `background` key (the colour alone is the truth)", async () => {
    saveMock.mockImplementation((_s: string, _v: string, config: StorefrontPresentationConfig) =>
      Promise.resolve({ ok: true, data: detail(config, { revision: 2 }) }),
    );
    const gradient: StorefrontPresentationConfig = {
      ...LEGACY,
      background: { kind: "gradient", from: { hex: "#112233" }, to: { hex: "#445566" }, direction: "to-end" },
    };
    const user = await mount(gradient);
    await user.click(typeBtn("لون ثابت"));
    await user.click(document.querySelector("[data-save]") as HTMLElement);
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const saved = saveMock.mock.calls[0][2] as StorefrontPresentationConfig;
    expect("background" in saved).toBe(false);
    expect(saved.backgroundColor).toBe("#112233");
  });
});

describe("Publish rejection of a global gradient background (contrast policy, P3-A-06)", () => {
  const GRADIENT: StorefrontPresentationConfig = {
    ...LEGACY,
    background: { kind: "gradient", from: { hex: "#0b0b0b" }, to: { hex: "#1a1a1a" }, direction: "to-bottom" },
  };

  it("a rejected publish tells the merchant gradients are deferred — not a generic failure — and nothing is retried", async () => {
    publishMock.mockResolvedValue({
      ok: false,
      reason: "validation",
      message: "rejected",
      issues: { background: "global_gradient_contrast_insufficient" },
    });
    const user = await mount(GRADIENT);
    // the draft itself opens, previews and is editable as usual
    expect(typeBtn("تدرج لوني").getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(canvas().style.backgroundImage).toContain("linear-gradient"));

    await user.click(screen.getByRole("button", { name: "نشر" }));
    await user.click(screen.getByRole("button", { name: "نشر الآن" }));

    await waitFor(() => expect(screen.getByText(/نصوص المتجر لا تُقرأ بوضوح مؤكَّد فوق هذا التدرج على كامل مداه/)).toBeTruthy());
    expect(screen.queryByText(/تعذّر النشر\.$/)).toBeNull();
    expect(publishMock).toHaveBeenCalledTimes(1);
    // the document is not touched by the rejection: still the same gradient draft, still clean
    expect(typeBtn("تدرج لوني").getAttribute("aria-pressed")).toBe("true");
    expect(root().getAttribute("data-lifecycle")).toBe("clean");
  });

  it("a gradient that is not publishable keeps the draft: preview, Save and Undo/Redo all still work", async () => {
    saveMock.mockImplementation((_s: string, _v: string, config: StorefrontPresentationConfig) =>
      Promise.resolve({ ok: true, data: detail(config, { revision: 2 }) }),
    );
    const user = await mount({ ...LEGACY, backgroundColor: "#f8f9fa" });
    await user.click(typeBtn("تدرج لوني"));
    expect(document.querySelector('[data-global-bg-readiness="ready"]')).toBeTruthy();

    // make it dark: the editor says it cannot be published, but nothing is lost or disabled
    const toField = document.querySelector('[data-colour-field="global-bg-to"]') as HTMLElement;
    fireEvent.change(within(toField).getByRole("textbox", { name: /رمز اللون|colour code/i }), { target: { value: "#1a1a1a" } });
    expect(document.querySelector('[data-global-bg-readiness="blocked"]')).toBeTruthy();
    await waitFor(() => expect(canvas().style.backgroundImage).toContain("linear-gradient"));
    expect(root().getAttribute("data-lifecycle")).toBe("dirty");

    // Undo returns to the light (ready) gradient, Redo to the dark one — the history is unaffected by readiness
    await user.click(undoBtn());
    expect(document.querySelector('[data-global-bg-readiness="ready"]')).toBeTruthy();
    await user.click(redoBtn());
    expect(document.querySelector('[data-global-bg-readiness="blocked"]')).toBeTruthy();

    // Save still persists the draft exactly (the server, not the editor, decides at publish)
    await user.click(document.querySelector("[data-save]") as HTMLElement);
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const saved = saveMock.mock.calls[0][2] as StorefrontPresentationConfig;
    expect(saved.background).toMatchObject({ kind: "gradient", to: { hex: "#1a1a1a" } });
    expect(JSON.stringify(saved)).not.toMatch(/https?:|url\(|linear-gradient/);
  });

  it("describePublishIssues maps each stable gradient code to its own actionable sentence (AR + EN)", () => {
    const en = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", key);
    const ar = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("ar", key);
    const insufficient = describePublishIssues({ background: "global_gradient_contrast_insufficient" }, en);
    expect(insufficient).toBe(en("storeBackgroundGradientContrastBlocked"));
    expect(insufficient).toMatch(/not proven readable over this gradient across its whole range/);
    expect(describePublishIssues({ background: "global_gradient_contrast_insufficient" }, ar)).toMatch(/فوق هذا التدرج على كامل مداه/);
    expect(describePublishIssues({ background: "global_gradient_colour_unresolved" }, en)).toBe(en("storeBackgroundGradientUnresolvedBlocked"));
    expect(describePublishIssues({ "homepage.sections[0].design.text.body": "global_background_text_contrast_insufficient" }, en)).toBe(
      en("storeBackgroundSectionTextBlocked"),
    );
    // image codes keep their own sentence and are never confused with the gradient's
    const image = describePublishIssues({ background: "global_media_background_not_ready" }, en);
    expect(image).toBe(en("storeBackgroundPublishBlocked"));
    expect(image).not.toBe(insufficient);
    // listed once beside other publish problems
    const both = describePublishIssues(
      { background: "global_gradient_contrast_insufficient", "announcements.items[0].window.endsAt": "window_end_not_after_start" },
      en,
    );
    expect(both).toContain(en("storeBackgroundGradientContrastBlocked"));
    expect(both).toContain(en("annPublishBlocked"));
  });
});

describe("Publish rejection of a global image background (temporary gate, P3-A-06)", () => {
  const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", key);

  it("explains the rejection in plain words instead of a generic failure", () => {
    const text = describePublishIssues({ background: "global_media_background_not_ready" }, t);
    expect(text).toBe(t("storeBackgroundPublishBlocked"));
    expect(text).toMatch(/image background cannot be published yet/);
    expect(describePublishIssues({ background: "global_media_background_not_ready" }, (k) => customizerMessage("ar", k))).toMatch(
      /خلفية الصورة غير متاحة للنشر/,
    );
  });

  it("is reported next to other publish problems, and an unknown code on the same path stays generic (null)", () => {
    const both = describePublishIssues(
      { background: "global_media_background_not_ready", "announcements.items[0].window.endsAt": "window_end_not_after_start" },
      t,
    );
    expect(both).toContain(t("storeBackgroundPublishBlocked"));
    expect(both).toContain(t("annPublishBlocked"));
    expect(describePublishIssues({ background: "something_else" }, t)).toBeNull();
  });
});
