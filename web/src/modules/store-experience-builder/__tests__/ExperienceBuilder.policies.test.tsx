/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();
const showMock = vi.fn();
const saveMock = vi.fn();

vi.mock("@/modules/commerce-workspace/presentation-versions", () => ({
  listPresentationVersions: (...args: unknown[]) => listMock(...args),
  showPresentationVersion: (...args: unknown[]) => showMock(...args),
  createPresentationVersion: vi.fn(),
  savePresentationVersion: (...args: unknown[]) => saveMock(...args),
  renamePresentationVersion: vi.fn(),
  deletePresentationVersion: vi.fn(),
}));

import { ExperienceBuilder } from "../ExperienceBuilder";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation";

const summary = {
  id: "v1",
  storefrontId: "store-1",
  name: "Current design",
  state: "draft",
  schemaVersion: 1,
  revision: 4,
  scheduledFor: null,
  lastPublishedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  listMock.mockReset();
  showMock.mockReset();
  saveMock.mockReset();
});

async function openPrivacyEditor() {
  listMock.mockResolvedValue({ ok: true, data: [summary] });
  showMock.mockResolvedValue({ ok: true, data: { ...summary, config: DEFAULT_PRESENTATION_CONFIG } });
  const user = userEvent.setup();
  render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" liveStoreName="Al-Noor Store" />);
  await waitFor(() => expect(showMock).toHaveBeenCalledWith("store-1", "v1"));
  await user.click(screen.getByRole("button", { name: "Content" }));
  const li = (await screen.findAllByRole("button", { name: "Edit text" }))[1].closest("li") as HTMLElement;
  await user.click(within(li).getByRole("button", { name: "Edit text" }));
  await user.click(within(li).getByRole("button", { name: "العربية" }));
  return { user, li };
}

describe("Policy editor — Customizer save integration (B8-3)", () => {
  it("marks the draft dirty, saves pages[].content with the version revision, then clears dirty", async () => {
    const { li } = await openPrivacyEditor();
    expect(screen.getByText("No changes")).toBeTruthy();

    fireEvent.change(within(li).getByLabelText("Policy text"), { target: { value: "نحمي بياناتك" } });
    expect(screen.getByText("Unsaved draft")).toBeTruthy();

    saveMock.mockResolvedValue({ ok: true, data: { ...summary, revision: 5, config: DEFAULT_PRESENTATION_CONFIG } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const [storefrontId, versionId, config, revision] = saveMock.mock.calls[0];
    expect([storefrontId, versionId, revision]).toEqual(["store-1", "v1", 4]);
    const privacy = config.pages.find((p: { slug: string }) => p.slug === "privacy-policy");
    expect(privacy.content).toEqual({ ar: { title: "", body: "نحمي بياناتك" } });
    expect(config.pages.filter((p: { content?: unknown }) => p.content)).toHaveLength(1);
    await waitFor(() => expect(screen.getByText("Version saved.")).toBeTruthy());
  });

  it("maps a 422 over-limit rejection to the policy, language and field, and keeps the draft dirty", async () => {
    const { li } = await openPrivacyEditor();
    fireEvent.change(within(li).getByLabelText("Policy text"), { target: { value: "x".repeat(20001) } });

    saveMock.mockResolvedValue({
      ok: false,
      reason: "validation",
      message: "x",
      issues: { "pages.4.content.ar.body": "policy_body_too_long" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "Could not save: a policy text is longer than allowed. Privacy (العربية): policy text is over 20,000 characters",
        ),
      ).toBeTruthy(),
    );
    // over-limit text is sent as typed (the server is the authority) — never silently truncated
    const sent = saveMock.mock.calls[0][2].pages.find((p: { slug: string }) => p.slug === "privacy-policy");
    expect(sent.content.ar.body).toHaveLength(20001);
    expect(screen.getByText("Unsaved draft")).toBeTruthy();
    expect(screen.getAllByRole("alert").some((a) => /Over the limit by 1 characters/.test(a.textContent ?? "")).valueOf()).toBe(true);
  });

  it("falls back to the generic message when a failure carries no issues", async () => {
    const { li } = await openPrivacyEditor();
    fireEvent.change(within(li).getByLabelText("Policy text"), { target: { value: "ok" } });
    saveMock.mockResolvedValue({ ok: false, reason: "failed", message: "boom" });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(screen.getByText(/Could not save the version/)).toBeTruthy());
  });
});
