/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OFFICIAL_SOCIAL_MARKS } from "../OfficialSocialMark";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

const SOCIAL = [
  ["instagram", "https://instagram.com/awj", "Instagram", "إنستغرام"],
  ["x", "https://x.com/awj", "X", "إكس"],
  ["tiktok", "https://www.tiktok.com/@awj", "TikTok", "تيك توك"],
  ["snapchat", "https://www.snapchat.com/add/awj", "Snapchat", "سناب شات"],
  ["youtube", "https://www.youtube.com/@awj", "YouTube", "يوتيوب"],
  ["linkedin", "https://www.linkedin.com/company/awj", "LinkedIn", "لينكدإن"],
  ["facebook", "https://www.facebook.com/awj", "Facebook", "فيسبوك"],
] as const;

function configWithSocial() {
  const config = structuredClone(DEFAULT_PRESENTATION_CONFIG);
  config.whatsapp = {
    enabled: true,
    phone: "+966500000000",
    message: "",
    placement: "both",
  };
  config.social = [
    ...SOCIAL.map(([network, url], index) => ({
      id: `social-${index}`,
      network,
      url,
      enabled: true,
    })),
    {
      id: "invalid",
      network: "instagram",
      url: "http://instagram.com/insecure",
      enabled: true,
    },
    {
      id: "unknown",
      network: "myspace" as never,
      url: "https://example.com/awj",
      enabled: true,
    },
  ];
  return config;
}

describe("web customizer preview official social marks", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the same official marks and does not navigate", () => {
    const config = configWithSocial();
    const view = render(
      <StorefrontPreviewCanvas
        config={config}
        locale="en"
        viewport="desktop"
        onSelectChrome={() => undefined}
      />,
    );

    for (const [network, href, label] of SOCIAL) {
      const link = view.getByRole("link", { name: label });
      expect(link.getAttribute("href")).toBe(href);
      expect(link.getAttribute("target")).toBeNull();
      expect(link.querySelector("img")?.getAttribute("src")).toBe(
        OFFICIAL_SOCIAL_MARKS[network].src,
      );
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      link.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }

    const floating = view.getByRole("link", { name: "Contact on WhatsApp" });
    expect(floating.getAttribute("href")).toBe("https://wa.me/966500000000");
    const floatEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    floating.dispatchEvent(floatEvent);
    expect(floatEvent.defaultPrevented).toBe(true);
    expect(
      view.getByRole("link", { name: "WhatsApp" }).querySelector("img")?.getAttribute(
        "data-official-social",
      ),
    ).toBe("whatsapp");
    expect(view.container.querySelectorAll('[data-official-social="x"]')).toHaveLength(
      1,
    );

    view.unmount();
    const arabic = render(
      <StorefrontPreviewCanvas config={config} locale="ar" viewport="mobile" />,
    );
    expect(arabic.getByRole("link", { name: "سناب شات" })).toBeTruthy();
    expect(arabic.container.firstElementChild?.getAttribute("dir")).toBe("rtl");
  });

  it("hides marks when links are absent", () => {
    render(
      <StorefrontPreviewCanvas
        config={DEFAULT_PRESENTATION_CONFIG}
        locale="en"
        viewport="tablet"
      />,
    );
    expect(screen.queryByRole("link", { name: "WhatsApp" })).toBeNull();
    expect(document.querySelector("[data-official-social]")).toBeNull();
  });
});
