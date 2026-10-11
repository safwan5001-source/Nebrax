/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasContentBlocks } from "../CanvasContentBlocks";
import type { ContentBlock } from "../presentation/content-blocks";

vi.mock("../media/use-media-ref-preview", () => ({
  useMediaRefPreview: (ref: { mediaId: string } | null) => (ref ? `https://signed.example/${ref.mediaId}.jpg` : null),
}));

afterEach(cleanup);

const A = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const labels = { note: "Note", success: "Success", warning: "Warning", empty: "Add a block", item: "Picture {number}" };

function mount(blocks: ContentBlock[], extra: Partial<React.ComponentProps<typeof CanvasContentBlocks>> = {}) {
  return render(<CanvasContentBlocks blocks={blocks} dir="ltr" viewport="desktop" labels={labels} {...extra} />);
}

describe("CanvasContentBlocks (CUST-HV V9c-2)", () => {
  it("draws the storefront's decisions: h2 / h3, logical alignment, line breaks kept, the device on data-vp", () => {
    const { container } = mount(
      [
        { id: "a", kind: "heading", text: "Plain" },
        { id: "b", kind: "heading", text: "Sub", level: 3, align: "center" },
        { id: "c", kind: "paragraph", text: "one\ntwo", align: "end" },
      ],
      { viewport: "tablet" },
    );
    expect(container.querySelector("[data-content-blocks]")?.getAttribute("data-vp")).toBe("tablet");
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("h2")?.textContent).toBe("Plain");
    expect(container.querySelector("h3")?.className).toContain("text-center");
    const p = container.querySelector("p") as HTMLElement;
    expect(p.className).toContain("whitespace-pre-line");
    expect(p.className).toContain("text-end");
    expect(container.innerHTML).not.toMatch(/text-(left|right)\b/);
  });

  it("an image uses the signed preview, is named by its position (decorative ⇒ empty alt) and carries its caption", () => {
    const { container } = mount([
      { id: "a", kind: "image", media: { mediaId: A }, caption: "Spring" },
      { id: "b", kind: "image", media: { mediaId: A, decorative: true } },
    ]);
    const imgs = container.querySelectorAll("img");
    expect(imgs[0].getAttribute("src")).toBe(`https://signed.example/${A}.jpg`);
    expect(imgs[0].getAttribute("alt")).toBe("Picture 1");
    expect(imgs[1].getAttribute("alt")).toBe("");
    expect(container.querySelector("figcaption")?.textContent).toBe("Spring");
  });

  it("a button is a look, not a link: nothing navigates in the editor; an incomplete one is not drawn", () => {
    const { container } = mount([
      { id: "a", kind: "button", label: "Shop", href: "/shop" },
      { id: "b", kind: "button", label: "Learn", href: "/learn", style: "outline" },
      { id: "c", kind: "button", label: "Draft", href: "" },
    ]);
    expect(container.querySelector("a")).toBeNull();
    const buttons = [...container.querySelectorAll("[data-content-button] [data-cta-style]")];
    expect(buttons.map((b) => b.getAttribute("data-cta-style"))).toEqual(["solid", "outline"]);
  });

  it("dividers, spacers and callouts follow the storefront (tone as text and as an accent, registry icon decorative)", () => {
    const { container } = mount([
      { id: "d", kind: "divider", style: "dots" },
      { id: "s", kind: "spacer", size: "lg" },
      { id: "k", kind: "callout", text: "Careful", tone: "warning", icon: "lock" },
    ]);
    expect(container.querySelector('[data-content-divider="dots"]')?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector('[data-content-spacer="lg"]')?.className).toContain("h-14");
    const callout = container.querySelector("aside") as HTMLElement;
    expect(callout.querySelector(".sr-only")?.textContent).toBe("Warning: ");
    expect(callout.className).toContain("border-s-store-warning");
    expect(callout.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("columns hold their blocks in reading order and never set a responsive column count of their own", () => {
    const { container } = mount([
      {
        id: "c",
        kind: "columns",
        columns: [
          [{ id: "l", kind: "paragraph", text: "left" }],
          [{ id: "r", kind: "paragraph", text: "right" }],
        ],
      },
    ]);
    const cells = container.querySelectorAll("[data-content-column]");
    expect([...cells].map((c) => c.textContent)).toEqual(["left", "right"]);
    expect((container.querySelector("[data-content-columns]") as HTMLElement).className).not.toMatch(/grid-cols/);
  });

  it("rings the editor's selected block (also inside a column) and keeps it in view", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const blocks: ContentBlock[] = [
      { id: "a", kind: "paragraph", text: "one" },
      { id: "c", kind: "columns", columns: [[{ id: "x", kind: "paragraph", text: "in a column" }], []] },
    ];
    const { container, rerender } = mount(blocks, { activeBlockId: "x" });
    const selected = container.querySelectorAll("[data-content-block][data-selected]");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-content-block")).toBe("x");
    expect(scroll).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    rerender(<CanvasContentBlocks blocks={blocks} dir="ltr" viewport="desktop" labels={labels} activeBlockId="a" />);
    expect(container.querySelector("[data-content-block][data-selected]")?.getAttribute("data-content-block")).toBe("a");
  });

  it("with nothing to draw it says what to do instead of an empty band", () => {
    const { container } = mount([
      { id: "a", kind: "paragraph", text: "   " },
      { id: "b", kind: "button", label: "x", href: "" },
    ]);
    expect(container.querySelector("[data-content-blocks-empty]")?.textContent).toBe("Add a block");
    expect(container.querySelector("[data-content-blocks]")).toBeNull();
  });
});
