/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

function withContact(
  contact: Partial<typeof DEFAULT_PRESENTATION_CONFIG.contact>,
) {
  const config = structuredClone(DEFAULT_PRESENTATION_CONFIG);
  config.contact = { ...config.contact, ...contact };
  return config;
}

describe("web customizer preview contact icons", () => {
  afterEach(() => {
    cleanup();
  });

  it("matches the published icon set and does not add links", () => {
    const blank = render(
      <StorefrontPreviewCanvas
        config={withContact({})}
        locale="en"
        viewport="mobile"
      />,
    );
    expect(blank.container.querySelector("[data-contact-icon]")).toBeNull();
    blank.unmount();

    const view = render(
      <StorefrontPreviewCanvas
        config={withContact({
          phone: "+966500000000",
          address: "الدمام",
        })}
        locale="ar"
        viewport="desktop"
      />,
    );
    expect(view.container.querySelector("[dir='rtl']")).not.toBeNull();
    expect(view.getByText("+966500000000")).toBeTruthy();
    expect(view.getByText("الدمام")).toBeTruthy();
    expect(
      view.container.querySelector("[data-contact-icon='phone']"),
    ).not.toBeNull();
    expect(
      view.container.querySelector("[data-contact-icon='address']"),
    ).not.toBeNull();
    expect(view.container.querySelector("[data-contact-icon='email']")).toBeNull();
    expect(view.container.querySelector("[data-contact-icon='hours']")).toBeNull();
    expect(view.container.querySelector("a[href^='tel:']")).toBeNull();
  });
});
