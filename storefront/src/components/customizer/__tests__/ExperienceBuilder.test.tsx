import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  DRAFT_PERSISTENCE_CAPABILITY,
  PUBLISH_CAPABILITY,
  VERSION_HISTORY_CAPABILITY,
} from "@/lib/presentation/capabilities";
import { DEFAULT_PRESENTATION_CONFIG } from "@/lib/presentation/config";
import { ExperienceBuilder } from "../ExperienceBuilder";

describe("ExperienceBuilder", () => {
  it("declares persistence and publish live, with version history still deferred", () => {
    expect(DRAFT_PERSISTENCE_CAPABILITY).toBe("live");
    expect(PUBLISH_CAPABILITY).toBe("live");
    expect(VERSION_HISTORY_CAPABILITY).toBe("deferred");
  });

  it("renders the two-pane workspace with a live preview", () => {
    render(
      <ExperienceBuilder initialLocale="en" liveStoreName="Al-Noor Store" />,
    );
    expect(screen.getByText("Store Experience Builder")).toBeInTheDocument();
    expect(screen.getByLabelText("Live store preview")).toBeInTheDocument();
    expect(screen.getAllByText("Al-Noor Store").length).toBeGreaterThan(0);
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });

  it("does not claim save or publish success", async () => {
    const user = userEvent.setup();
    render(<ExperienceBuilder initialLocale="en" />);
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(screen.getByRole("status")).toHaveTextContent(/nothing was stored/i);
    expect(screen.queryByText(/saved successfully/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Publish" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      /Publish is not enabled/i,
    );
    expect(
      screen.queryByText(/published successfully/i),
    ).not.toBeInTheDocument();
  });

  it("updates the preview when the merchant changes the primary colour", async () => {
    const user = userEvent.setup();
    render(<ExperienceBuilder initialLocale="en" />);
    await user.click(screen.getByRole("button", { name: "Navy" }));
    const canvas = document.querySelector(
      "[data-preview-canvas]",
    ) as HTMLElement;
    expect(canvas.style.getPropertyValue("--store-primary")).toBe("#1e3a5f");
  });

  it("never writes to browser storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const user = userEvent.setup();
    render(<ExperienceBuilder initialLocale="en" />);
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await user.click(screen.getByRole("button", { name: "Publish" }));
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("mirrors an additional navigation label in the preview", async () => {
    const user = userEvent.setup();
    render(<ExperienceBuilder initialLocale="en" />);
    await user.click(
      screen.getByRole("button", { name: "Header & navigation" }),
    );
    await user.type(screen.getByPlaceholderText("Label"), "About");
    expect(document.querySelector("[data-extra-nav]")?.textContent).toBe(
      "About",
    );
  });

  it("does not mint a Verified badge from a merchant request", async () => {
    const user = userEvent.setup();
    render(<ExperienceBuilder initialLocale="en" />);
    await user.click(
      screen.getByRole("button", { name: "Verification & trust" }),
    );
    await user.click(screen.getByLabelText("Request a verified badge"));
    const canvas = document.querySelector("[data-preview-canvas]");
    expect(canvas?.textContent).not.toMatch(/Verified/);
    expect(canvas?.textContent).not.toMatch(/موثّق/);
  });

  it("keeps the official seal out of the storefront customizer preview", () => {
    const token = "opaque-token-must-not-reach-the-preview-loader";
    render(
      <ExperienceBuilder
        initialLocale="en"
        initialConfig={{
          ...DEFAULT_PRESENTATION_CONFIG,
          sbc: {
            ...DEFAULT_PRESENTATION_CONFIG.sbc,
            seal_token: token,
            show_in_storefront: true,
          },
        }}
      />,
    );

    const canvas = document.querySelector("[data-preview-canvas]");
    expect(screen.getByTestId("sbc-seal-preview").textContent).toBe(
      "Editor preview: the official Saudi Business Center seal will appear on the published storefront.",
    );
    expect(canvas?.textContent).toContain(
      "Editor preview: the official Saudi Business Center seal will appear on the published storefront.",
    );
    expect(screen.queryByTestId("sbc-official-seal")).toBeNull();
    expect(canvas?.querySelector("[data-token]")).toBeNull();
    expect(canvas?.innerHTML ?? "").not.toContain(token);
    expect(document.querySelector("script")).toBeNull();
    expect(
      document.querySelector(
        'script[src="https://eauthenticate.saudibusiness.gov.sa/EAuthSealApi/seal.js"]',
      ),
    ).toBeNull();
    expect(document.getElementById("awj-sbc-seal-loader")).toBeNull();
  });

  it("keeps the approved SBC text when the preview has no seal token", () => {
    render(
      <ExperienceBuilder
        initialLocale="en"
        initialConfig={{
          ...DEFAULT_PRESENTATION_CONFIG,
          sbc: {
            ...DEFAULT_PRESENTATION_CONFIG.sbc,
            seal_token: "   ",
            show_in_storefront: true,
          },
        }}
      />,
    );

    const canvas = document.querySelector("[data-preview-canvas]");
    expect(canvas?.textContent).toContain("Verified in Saudi Business Center");
    expect(screen.queryByTestId("sbc-seal-preview")).toBeNull();
    expect(screen.queryByTestId("sbc-official-seal")).toBeNull();
    expect(canvas?.querySelector("[data-token]")).toBeNull();
    expect(
      document.querySelector(
        'script[src="https://eauthenticate.saudibusiness.gov.sa/EAuthSealApi/seal.js"]',
      ),
    ).toBeNull();
  });
});
