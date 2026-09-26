import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "@/lib/presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

function withContact(
  contact: Partial<typeof DEFAULT_PRESENTATION_CONFIG.contact>,
) {
  const config = structuredClone(DEFAULT_PRESENTATION_CONFIG);
  config.contact = { ...config.contact, ...contact };
  return config;
}

describe("storefront preview contact icons", () => {
  it("renders no contact row when every field is blank", () => {
    render(
      <StorefrontPreviewCanvas
        config={withContact({ phone: "  ", email: "", address: "", hours: "" })}
        locale="en"
        viewport="mobile"
      />,
    );
    expect(document.querySelector("[data-contact-icon]")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Contact" })).toBeNull();
  });

  it("shows one icon and the text for a single field", () => {
    render(
      <StorefrontPreviewCanvas
        config={withContact({ email: "owner@awj.dev" })}
        locale="en"
        viewport="desktop"
      />,
    );
    expect(screen.getByText("owner@awj.dev")).toBeTruthy();
    expect(
      document.querySelector("[data-contact-icon='email']"),
    ).not.toBeNull();
    expect(document.querySelectorAll("[data-contact-icon]")).toHaveLength(1);
    expect(document.querySelector("a[href^='mailto:']")).toBeNull();
  });

  it("aligns the full set in Arabic and English without turning rows into links", () => {
    const config = withContact({
      phone: "+966500000000",
      email: "owner@awj.dev",
      address: "Dammam",
      hours: "9–5",
    });
    const english = render(
      <StorefrontPreviewCanvas
        config={config}
        locale="en"
        viewport="desktop"
      />,
    );
    expect(english.container.querySelector("[dir='ltr']")).not.toBeNull();
    expect(
      english.container.querySelectorAll("[data-contact-icon]"),
    ).toHaveLength(4);

    english.unmount();
    const arabic = render(
      <StorefrontPreviewCanvas config={config} locale="ar" viewport="mobile" />,
    );
    expect(arabic.container.querySelector("[dir='rtl']")).not.toBeNull();
    expect(arabic.getByText("Dammam").className).toContain("break-words");
    expect(arabic.container.querySelector("a[href^='tel:']")).toBeNull();
  });
});
