import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OFFICIAL_SOCIAL_MARKS } from "@/components/brand/OfficialSocialMark";
import { DEFAULT_PRESENTATION_CONFIG } from "@/lib/presentation/config";
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
      id: "script",
      network: "x",
      url: "javascript:alert(1)",
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

describe("storefront preview official social marks", () => {
  it("renders official marks in English and Arabic without navigating", () => {
    const config = configWithSocial();
    const english = render(
      <StorefrontPreviewCanvas
        config={config}
        locale="en"
        viewport="desktop"
      />,
    );

    for (const [network, href, label] of SOCIAL) {
      const link = english.getByRole("link", { name: label });
      expect(link.getAttribute("href")).toBe(href);
      expect(link.getAttribute("target")).toBeNull();
      expect(link.querySelector("img")?.getAttribute("src")).toBe(
        OFFICIAL_SOCIAL_MARKS[network].src,
      );
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      link.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }

    const floating = english.getByRole("link", { name: "Contact on WhatsApp" });
    expect(floating.getAttribute("href")).toBe("https://wa.me/966500000000");
    expect(floating.getAttribute("target")).toBeNull();
    expect(
      floating.querySelector("img")?.getAttribute("data-official-social"),
    ).toBe("whatsapp");
    const footerWhatsapp = english.getByRole("link", { name: "WhatsApp" });
    expect(footerWhatsapp.querySelector("img")?.getAttribute("src")).toBe(
      "/brand/social/whatsapp.svg",
    );
    const footerEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    footerWhatsapp.dispatchEvent(footerEvent);
    expect(footerEvent.defaultPrevented).toBe(true);
    expect(english.queryByRole("link", { name: "myspace" })).toBeNull();
    expect(
      english.container.querySelectorAll('[data-official-social="instagram"]'),
    ).toHaveLength(1);

    english.unmount();
    const arabic = render(
      <StorefrontPreviewCanvas config={config} locale="ar" viewport="mobile" />,
    );
    expect(arabic.getByRole("link", { name: "إنستغرام" })).toBeTruthy();
    expect(
      arabic.getByRole("link", { name: "التواصل عبر واتساب" }),
    ).toBeTruthy();
    expect(arabic.container.firstElementChild).toHaveAttribute("dir", "rtl");
    expect(arabic.container.querySelector(".flex-wrap")).toBeTruthy();
  });

  it("hides WhatsApp and social marks when nothing valid is configured", () => {
    render(
      <StorefrontPreviewCanvas
        config={DEFAULT_PRESENTATION_CONFIG}
        locale="en"
        viewport="desktop"
      />,
    );
    expect(
      screen.queryByRole("link", { name: "Contact on WhatsApp" }),
    ).toBeNull();
    expect(document.querySelector("[data-official-social]")).toBeNull();
  });
});
