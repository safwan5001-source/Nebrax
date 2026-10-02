/**
 * @vitest-environment jsdom
 *
 * CUST-H4-4 — Banner `imageAlt` and App Promo's own Content tab. Both reuse
 * existing fields/validators (no new contract); this covers the merchant
 * editing surface directly, parallel to the renderer-level tests in
 * section-content.h4-4.test.ts / BannerBand.test.tsx / StorefrontPreviewCanvas.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPanels } from "../ControlPanels";
import {
  DEFAULT_PRESENTATION_CONFIG,
  normalizePresentationConfig,
} from "../presentation/config";
import type { StorefrontPresentationConfig } from "../presentation/config";

function withSections(
  sections: StorefrontPresentationConfig["homepage"]["sections"],
  apps?: Partial<StorefrontPresentationConfig["apps"]>,
): StorefrontPresentationConfig {
  return {
    ...DEFAULT_PRESENTATION_CONFIG,
    homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, sections },
    apps: { ...DEFAULT_PRESENTATION_CONFIG.apps, ...apps },
  };
}

describe("Store Customizer — Banner imageAlt field (CUST-H4-4)", () => {
  afterEach(() => cleanup());

  it("renders the alt-text field empty when the stored banner has no imageAlt", () => {
    const config = withSections([
      {
        id: "banner-1",
        type: "banner",
        visible: true,
        content: {
          title: "عرض الصيف",
          subtitle: "",
          ctaLabel: "",
          ctaHref: "",
          imageUrl: "https://example.com/banner.jpg",
        },
      },
    ]);
    render(
      <ControlPanels
        panel="homepage"
        config={config}
        locale="en"
        liveStoreName={null}
        onChange={() => {}}
        selectedSection="banner-1"
      />,
    );
    const alt = screen.getByLabelText(/Image alt text/) as HTMLInputElement;
    expect(alt.value).toBe("");
  });

  it("patches only imageAlt, leaving every other banner field untouched", () => {
    const onChange = vi.fn();
    const config = withSections([
      {
        id: "banner-1",
        type: "banner",
        visible: true,
        content: {
          title: "عرض الصيف",
          subtitle: "خصم يصل إلى 30%",
          ctaLabel: "تسوق الآن",
          ctaHref: "/sale",
          imageUrl: "https://example.com/banner.jpg",
          imageAlt: "",
        },
      },
    ]);
    render(
      <ControlPanels
        panel="homepage"
        config={config}
        locale="en"
        liveStoreName={null}
        onChange={onChange}
        selectedSection="banner-1"
      />,
    );

    const alt = screen.getByLabelText(/Image alt text/);
    fireEvent.change(alt, { target: { value: "صورة لمنتجات الصيف" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as StorefrontPresentationConfig;
    const section = next.homepage.sections.find((s) => s.id === "banner-1");
    const content = section?.content as
      | { title: string; imageAlt?: string; imageUrl: string | null }
      | undefined;
    expect(content?.imageAlt).toBe("صورة لمنتجات الصيف");
    expect(content?.title).toBe("عرض الصيف");
    expect(content?.imageUrl).toBe("https://example.com/banner.jpg");
  });
});

describe("Store Customizer — App Promo's own Content tab (CUST-H4-4)", () => {
  afterEach(() => cleanup());

  it("shows the real config.apps fields inline instead of the old static note", () => {
    const config = withSections(
      [{ id: "appPromo-1", type: "appPromo", visible: true }],
      {
        appName: "My Store App",
        iosUrl: "https://apps.apple.com/app/id123",
        androidUrl: "",
      },
    );
    render(
      <ControlPanels
        panel="homepage"
        config={config}
        locale="en"
        liveStoreName={null}
        onChange={() => {}}
        selectedSection="appPromo-1"
      />,
    );

    expect(
      (screen.getByLabelText("App name") as HTMLInputElement).value,
    ).toBe("My Store App");
    expect(
      (screen.getByLabelText("App Store URL") as HTMLInputElement).value,
    ).toBe("https://apps.apple.com/app/id123");
    expect(
      (screen.getByLabelText("Google Play URL") as HTMLInputElement).value,
    ).toBe("");
    // The old leave-the-section note is gone — editing happens right here.
    expect(
      screen.queryByText(
        "App links come from the Apps settings. The section appears only when an Apple or Google store link is real.",
      ),
    ).toBeNull();
  });

  it("editing a field patches only config.apps, never homepage.sections or visible", () => {
    const onChange = vi.fn();
    const config = withSections([
      { id: "appPromo-1", type: "appPromo", visible: true },
    ]);
    render(
      <ControlPanels
        panel="homepage"
        config={config}
        locale="en"
        liveStoreName={null}
        onChange={onChange}
        selectedSection="appPromo-1"
      />,
    );

    fireEvent.change(screen.getByLabelText("App name"), {
      target: { value: "AWJ" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as StorefrontPresentationConfig;
    expect(next.apps.appName).toBe("AWJ");
    expect(next.homepage.sections).toEqual(config.homepage.sections);
  });

  it("toggling the footer-links switch patches apps.showFooterLinks without touching the homepage section's visible flag", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const config = withSections([
      { id: "appPromo-1", type: "appPromo", visible: true },
    ]);
    render(
      <ControlPanels
        panel="homepage"
        config={config}
        locale="en"
        liveStoreName={null}
        onChange={onChange}
        selectedSection="appPromo-1"
      />,
    );

    await user.click(screen.getByLabelText("Footer app links"));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as StorefrontPresentationConfig;
    expect(next.apps.showFooterLinks).toBe(true);
    const section = next.homepage.sections.find((s) => s.id === "appPromo-1");
    expect(section?.visible).toBe(true);
  });
});

/**
 * CUST-H4-4 review fix — reproduces the exact real-world pipeline
 * (`ExperienceBuilder.updateDraft`: every `onChange` re-normalizes the
 * whole config synchronously) rather than a bare `vi.fn()` spy, so these
 * tests prove the actual reported bug is fixed: a plain controlled input
 * bound to `config.apps.iosUrl`/`androidUrl` got wiped to `""` after the
 * first keystroke, because the apps normalizer replaces any not-yet-complete
 * URL with `""`. `AppUrlField` now keeps a local draft and only commits
 * (and therefore only normalizes) on blur.
 */
function StatefulHomepagePanel({
  initialConfig,
  selectedSection,
}: {
  initialConfig: StorefrontPresentationConfig;
  selectedSection: string;
}) {
  const [config, setConfig] = useState(initialConfig);
  return (
    <ControlPanels
      panel="homepage"
      config={config}
      locale="en"
      liveStoreName={null}
      onChange={(next) => setConfig(normalizePresentationConfig(next))}
      selectedSection={selectedSection}
    />
  );
}

describe("Store Customizer — App Promo URL fields tolerate normal typing (CUST-H4-4 review fix)", () => {
  afterEach(() => cleanup());

  it("typing a URL character-by-character does not clear the field", async () => {
    const user = userEvent.setup();
    const config = withSections([
      { id: "appPromo-1", type: "appPromo", visible: true },
    ]);
    render(
      <StatefulHomepagePanel initialConfig={config} selectedSection="appPromo-1" />,
    );

    const input = screen.getByLabelText("App Store URL") as HTMLInputElement;
    await user.type(input, "https://apps.apple.com/app/id123456789");

    // Every real `ExperienceBuilder.updateDraft`-style re-normalize would,
    // before this fix, have wiped the field back to "" after the very
    // first keystroke (an incomplete URL is not yet allow-listed). Since
    // AppUrlField only commits on blur, no re-normalize has happened yet
    // and the full typed text must still be present.
    expect(input.value).toBe("https://apps.apple.com/app/id123456789");
  });

  it("a valid App Store URL persists once typing is committed (blur)", async () => {
    const user = userEvent.setup();
    const config = withSections([
      { id: "appPromo-1", type: "appPromo", visible: true },
    ]);
    render(
      <StatefulHomepagePanel initialConfig={config} selectedSection="appPromo-1" />,
    );

    const input = screen.getByLabelText("App Store URL") as HTMLInputElement;
    await user.type(input, "https://apps.apple.com/app/id123456789");
    await user.tab();

    expect(input.value).toBe("https://apps.apple.com/app/id123456789");
  });

  it("a valid Google Play URL persists once typing is committed (blur)", async () => {
    const user = userEvent.setup();
    const config = withSections([
      { id: "appPromo-1", type: "appPromo", visible: true },
    ]);
    render(
      <StatefulHomepagePanel initialConfig={config} selectedSection="appPromo-1" />,
    );

    const input = screen.getByLabelText("Google Play URL") as HTMLInputElement;
    await user.type(input, "https://play.google.com/store/apps/details?id=sa.awj");
    await user.tab();

    expect(input.value).toBe(
      "https://play.google.com/store/apps/details?id=sa.awj",
    );
  });

  it("an invalid/not-allow-listed final URL is rejected and sanitized on commit, same as before this fix", async () => {
    const user = userEvent.setup();
    const config = withSections([
      { id: "appPromo-1", type: "appPromo", visible: true },
    ]);
    render(
      <StatefulHomepagePanel initialConfig={config} selectedSection="appPromo-1" />,
    );

    const input = screen.getByLabelText("App Store URL") as HTMLInputElement;
    await user.type(input, "https://not-a-real-app-store.example.com/app");
    await user.tab();

    // Not on `apps.apple.com` — the existing `isSafeAppStoreUrl` allow-list
    // still rejects it on commit, exactly as it always has. No weakening
    // of URL safety: the normalizer, not this component, makes that call.
    expect(input.value).toBe("");
  });

  it("one-platform-only still works: committing the App Store URL never touches the untouched Google Play field", async () => {
    const user = userEvent.setup();
    const config = withSections([
      { id: "appPromo-1", type: "appPromo", visible: true },
    ]);
    render(
      <StatefulHomepagePanel initialConfig={config} selectedSection="appPromo-1" />,
    );

    const ios = screen.getByLabelText("App Store URL") as HTMLInputElement;
    const android = screen.getByLabelText("Google Play URL") as HTMLInputElement;
    await user.type(ios, "https://apps.apple.com/app/id123456789");
    await user.tab();

    expect(ios.value).toBe("https://apps.apple.com/app/id123456789");
    expect(android.value).toBe("");
  });
});
