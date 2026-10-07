/**
 * @vitest-environment jsdom
 *
 * CUST-HV V5c review — the empty banner placeholder carries the same content-box marker as
 * the authored banner, so designed inner spacing replaces (not doubles) its own padding.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StorefrontPresentationConfig } from "../presentation/config";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

function banner(content: Record<string, string>): StorefrontPresentationConfig {
  return {
    ...DEFAULT_PRESENTATION_CONFIG,
    homepage: {
      ...DEFAULT_PRESENTATION_CONFIG.homepage,
      sections: [
        {
          id: "b1",
          type: "banner",
          visible: true,
          design: { spacing: { inner: "none" } },
          content: { title: "", subtitle: "", ctaLabel: "", ctaHref: "", imageUrl: "", ...content },
        },
      ],
    },
  } as StorefrontPresentationConfig;
}

describe("Canvas banner content-box marker", () => {
  afterEach(() => cleanup());

  it("marks the empty-state placeholder as the section content", () => {
    const { container } = render(
      <StorefrontPreviewCanvas config={banner({})} locale="en" viewport="desktop" onSelectSection={() => {}} />,
    );
    const root = container.querySelector('[data-sd] > section');
    expect(root).not.toBeNull();
    expect(root?.querySelector(":scope > [data-section-content]")).not.toBeNull();
  });

  it("marks the authored content box too", () => {
    const { container } = render(
      <StorefrontPreviewCanvas config={banner({ title: "Hi" })} locale="en" viewport="desktop" onSelectSection={() => {}} />,
    );
    expect(container.querySelector("[data-sd] > section > [data-section-content]")).not.toBeNull();
  });
});
