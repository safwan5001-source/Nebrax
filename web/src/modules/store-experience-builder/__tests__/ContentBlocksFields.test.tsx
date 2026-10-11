/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentBlocksFields } from "../ContentBlocksFields";
import { customizerMessage } from "../messages";
import type { ContentBlocks } from "../presentation/content-blocks";
import { normalizeContentBlocks } from "../presentation/content-blocks";
import { sanitizeContentHref } from "../presentation/section-content";

vi.mock("../media/use-media-ref-preview", () => ({
  useMediaRefPreview: (ref: { mediaId: string } | null) => (ref ? `https://signed.example/${ref.mediaId}.jpg` : null),
}));
vi.mock("../media/MediaPicker", () => ({
  MediaPicker: ({ open, onSelect }: { open: boolean; onSelect: (asset: { id: string }) => void }) =>
    open ? (
      <button type="button" data-testid="pick-asset" onClick={() => onSelect({ id: "2d0b8e4a-5f5c-4c75-9e9a-ab3c4d5e6f70" })}>
        pick
      </button>
    ) : null,
}));
vi.mock("../media/MediaRefField", () => ({
  MediaRefField: ({ slot, value, onChange }: { slot: string; value: { mediaId: string } | null; onChange: (next: unknown) => void }) => (
    <div data-testid={`field-${slot}`}>
      <span>{value?.mediaId ?? "none"}</span>
      <button type="button" onClick={() => onChange({ mediaId: "9999aaaa-3d3a-4a53-9c7e-8f1a2b3c4d5e", decorative: true })}>
        replace
      </button>
      <button type="button" onClick={() => onChange(null)}>
        remove-picture
      </button>
    </div>
  ),
}));

afterEach(cleanup);

const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", key);
const A = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";

function Harness({ initial, onContent }: { initial: ContentBlocks; onContent?: (c: ContentBlocks) => void }) {
  const [content, setContent] = useState(initial);
  const [active, setActive] = useState<string | null>(null);
  return (
    <ContentBlocksFields
      content={content}
      locale="en"
      t={t}
      activeBlockId={active}
      onActiveBlockChange={setActive}
      onChange={(next) => {
        setContent(next);
        onContent?.(next);
      }}
    />
  );
}

const rows = () => [...document.querySelectorAll("[data-content-block-row]")];
const addSelect = (where = "top") => document.querySelector(`[data-content-add-block="${where}"]`) as HTMLSelectElement;

describe("ContentBlocksFields (CUST-HV V9c-2)", () => {
  it("starts empty with an explanation, the counter and every kind to add", () => {
    render(<Harness initial={{ blocks: [] }} />);
    expect(document.querySelector("[data-content-blocks-empty]")).not.toBeNull();
    expect(document.querySelector("[data-content-blocks-count]")?.textContent).toBe("0 of 12");
    expect([...addSelect().options].map((o) => o.value)).toEqual(["", "heading", "paragraph", "image", "button", "divider", "spacer", "callout", "columns"]);
  });

  it("adds a block from the menu, selects it and shows its own fields", () => {
    const seen: ContentBlocks[] = [];
    render(<Harness initial={{ blocks: [] }} onContent={(c) => seen.push(c)} />);
    fireEvent.change(addSelect(), { target: { value: "heading" } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].getAttribute("data-selected")).toBe("");
    expect(document.querySelector('[data-content-block-editor][data-kind="heading"]')).not.toBeNull();
    expect(seen.at(-1)?.blocks[0]).toMatchObject({ kind: "heading", text: "" });
  });

  it("an image is added through the picker, a button starts as a named draft, a divider needs nothing", () => {
    const seen: ContentBlocks[] = [];
    render(<Harness initial={{ blocks: [] }} onContent={(c) => seen.push(c)} />);
    fireEvent.change(addSelect(), { target: { value: "image" } });
    expect(rows()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("pick-asset"));
    expect(seen.at(-1)?.blocks[0]).toMatchObject({ kind: "image", media: { mediaId: "2d0b8e4a-5f5c-4c75-9e9a-ab3c4d5e6f70" } });
    fireEvent.change(addSelect(), { target: { value: "button" } });
    expect(seen.at(-1)?.blocks[1]).toMatchObject({ kind: "button", label: t("cbButtonDefault"), href: "" });
    expect(document.querySelector("[data-content-button-incomplete]")).not.toBeNull();
    fireEvent.change(addSelect(), { target: { value: "divider" } });
    expect(seen.at(-1)?.blocks[2]).toEqual({ id: expect.any(String), kind: "divider" });
  });

  it("typing keeps the spaces the merchant types even though the stored text is trimmed", () => {
    // the real draft is normalised on every keystroke (it trims heading text): simulate it
    const normalise = (c: ContentBlocks) => normalizeContentBlocks(c, sanitizeContentHref) ?? { blocks: [] };
    function Real() {
      const [content, setContent] = useState<ContentBlocks>({ blocks: [{ id: "h", kind: "heading", text: "" }] });
      return (
        <ContentBlocksFields content={content} locale="en" t={t} activeBlockId="h" onActiveBlockChange={() => {}} onChange={(next) => setContent(normalise(next))} />
      );
    }
    render(<Real />);
    const input = document.querySelector("[data-content-text]") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Hello " } });
    expect(input.value).toBe("Hello ");
    fireEvent.change(input, { target: { value: "Hello world" } });
    expect(input.value).toBe("Hello world");
  });

  it("level, alignment and the other kinds' fields write the canonical form", () => {
    const seen: ContentBlocks[] = [];
    render(<Harness initial={{ blocks: [{ id: "h", kind: "heading", text: "Title" }] }} onContent={(c) => seen.push(c)} />);
    const editor = () => within(document.querySelector("[data-content-block-editor]") as HTMLElement);
    fireEvent.click(editor().getByRole("button", { name: t("cbHeadingLevel3") }));
    expect(seen.at(-1)?.blocks[0]).toEqual({ id: "h", kind: "heading", text: "Title", level: 3 });
    fireEvent.click(editor().getByRole("button", { name: t("cbAlignCenter") }));
    expect(seen.at(-1)?.blocks[0]).toEqual({ id: "h", kind: "heading", text: "Title", level: 3, align: "center" });
    fireEvent.click(editor().getByRole("button", { name: t("cbAlignStart") }));
    fireEvent.click(editor().getByRole("button", { name: t("cbHeadingLevel2") }));
    expect(seen.at(-1)?.blocks[0]).toEqual({ id: "h", kind: "heading", text: "Title" });
  });

  it("button: label, link (committed on blur) and style; the incomplete note goes away with the link", () => {
    const seen: ContentBlocks[] = [];
    render(<Harness initial={{ blocks: [{ id: "b", kind: "button", label: "Go", href: "" }] }} onContent={(c) => seen.push(c)} />);
    const editor = () => within(document.querySelector("[data-content-block-editor]") as HTMLElement);
    expect(document.querySelector("[data-content-button-incomplete]")).not.toBeNull();
    const link = editor().getByLabelText(new RegExp(t("cbButtonHref"))) as HTMLInputElement;
    fireEvent.change(link, { target: { value: "/shop" } });
    fireEvent.blur(link);
    expect(seen.at(-1)?.blocks[0]).toMatchObject({ href: "/shop" });
    expect(document.querySelector("[data-content-button-incomplete]")).toBeNull();
    fireEvent.click(editor().getByRole("button", { name: t("cbButtonStyleLink") }));
    expect(seen.at(-1)?.blocks[0]).toEqual({ id: "b", kind: "button", label: "Go", href: "/shop", style: "link" });
    fireEvent.click(editor().getByRole("button", { name: t("cbButtonStyleSolid") }));
    expect(seen.at(-1)?.blocks[0]).toEqual({ id: "b", kind: "button", label: "Go", href: "/shop" });
  });

  it("image: the full media field, caption and link", () => {
    const seen: ContentBlocks[] = [];
    render(<Harness initial={{ blocks: [{ id: "i", kind: "image", media: { mediaId: A } }] }} onContent={(c) => seen.push(c)} />);
    expect(screen.getByTestId("field-content-block-image").textContent).toContain(A);
    fireEvent.click(screen.getByText("replace"));
    expect(seen.at(-1)?.blocks[0]).toEqual({ id: "i", kind: "image", media: { mediaId: "9999aaaa-3d3a-4a53-9c7e-8f1a2b3c4d5e", decorative: true } });
    fireEvent.change(document.querySelector("[data-content-caption]") as HTMLInputElement, { target: { value: "Spring" } });
    expect(seen.at(-1)?.blocks[0]).toMatchObject({ caption: "Spring" });
  });

  it("callout: tone and icon from the registry; 'No icon' removes it", () => {
    const seen: ContentBlocks[] = [];
    render(<Harness initial={{ blocks: [{ id: "k", kind: "callout", text: "Careful" }] }} onContent={(c) => seen.push(c)} />);
    fireEvent.click(within(document.querySelector("[data-content-block-editor]") as HTMLElement).getByRole("button", { name: t("cbToneWarning") }));
    fireEvent.change(document.querySelector("[data-content-callout-icon]") as HTMLSelectElement, { target: { value: "lock" } });
    expect(seen.at(-1)?.blocks[0]).toEqual({ id: "k", kind: "callout", text: "Careful", tone: "warning", icon: "lock" });
    fireEvent.change(document.querySelector("[data-content-callout-icon]") as HTMLSelectElement, { target: { value: "" } });
    expect(seen.at(-1)?.blocks[0]).toEqual({ id: "k", kind: "callout", text: "Careful", tone: "warning" });
  });

  it("reorder, duplicate and delete follow, with names that say which block", () => {
    const seen: ContentBlocks[] = [];
    render(
      <Harness
        initial={{ blocks: [{ id: "a", kind: "paragraph", text: "one" }, { id: "b", kind: "paragraph", text: "two" }] }}
        onContent={(c) => seen.push(c)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Move block 2 (Paragraph) up" }));
    expect(seen.at(-1)?.blocks.map((b) => b.id)).toEqual(["b", "a"]);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate block 1 (Paragraph)" }));
    expect(seen.at(-1)?.blocks).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Delete block 1 (Paragraph)" }));
    expect(seen.at(-1)?.blocks).toHaveLength(2);
    expect((screen.getByRole("button", { name: "Move block 1 (Paragraph) up" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a columns block lists its two columns, each with its own add menu limited to four and no nested columns", () => {
    const seen: ContentBlocks[] = [];
    render(
      <Harness
        initial={{
          blocks: [
            {
              id: "cols",
              kind: "columns",
              columns: [
                [{ id: "x1", kind: "spacer" }, { id: "x2", kind: "spacer" }, { id: "x3", kind: "spacer" }, { id: "x4", kind: "spacer" }],
                [],
              ],
            },
          ],
        }}
        onContent={(c) => seen.push(c)}
      />,
    );
    const columns = [...document.querySelectorAll("[data-content-column-editor]")];
    expect(columns).toHaveLength(2);
    // column 1 is full: its menu is disabled and says why
    const full = addSelect("cols:0");
    expect(full.disabled).toBe(true);
    // column 2 offers every leaf kind and never `columns`
    const open = addSelect("cols:1");
    expect([...open.options].map((o) => o.value)).toEqual(["", "heading", "paragraph", "image", "button", "divider", "spacer", "callout"]);
    fireEvent.change(open, { target: { value: "paragraph" } });
    const block = seen.at(-1)?.blocks[0];
    if (block?.kind !== "columns") throw new Error("columns");
    expect(block.columns[1]).toHaveLength(1);
    expect(block.columns[0]).toHaveLength(4);
  });

  it("the top-level menu is disabled at twelve blocks", () => {
    const blocks = Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, kind: "divider" as const }));
    render(<Harness initial={{ blocks }} />);
    expect(addSelect().disabled).toBe(true);
    expect(document.querySelector("[data-content-blocks-count]")?.textContent).toBe("12 of 12");
  });

  it("has Arabic copy for every new key", () => {
    const keys = Object.keys(customizerMessage as unknown as object);
    expect(keys).toBeDefined();
    for (const key of [
      "cbTitle",
      "cbAdd",
      "cbKindColumns",
      "cbToneWarning",
      "cbCanvasEmpty",
      "cbButtonIncomplete",
    ] as const) {
      expect(customizerMessage("ar", key)).toBeTruthy();
      expect(customizerMessage("ar", key)).not.toBe(customizerMessage("en", key));
    }
  });
});

describe("text fields respect the stored limits, by code point (V9c review)", () => {
  it("a heading stops at 120 code points and a paragraph at 600 — an emoji counts once, so nothing is shown that Save would drop", () => {
    const seen: ContentBlocks[] = [];
    render(
      <Harness
        initial={{
          blocks: [
            { id: "h", kind: "heading", text: "x" },
            { id: "p", kind: "paragraph", text: "y" },
          ],
        }}
        onContent={(c) => seen.push(c)}
      />,
    );
    fireEvent.click(rows()[0].querySelector("button") as HTMLElement);
    const heading = document.querySelector<HTMLInputElement>("input[data-content-text]") as HTMLInputElement;
    fireEvent.change(heading, { target: { value: "😀".repeat(130) } });
    expect(Array.from(heading.value)).toHaveLength(120);
    const storedHeading = seen.at(-1)?.blocks[0] as { text: string };
    expect(Array.from(storedHeading.text)).toHaveLength(120);

    fireEvent.click(rows()[1].querySelector("button") as HTMLElement);
    const paragraph = document.querySelector<HTMLTextAreaElement>("textarea[data-content-text]") as HTMLTextAreaElement;
    fireEvent.change(paragraph, { target: { value: "س".repeat(700) } });
    expect(Array.from(paragraph.value)).toHaveLength(600);
  });

  it("removing an image block's picture deletes the block (the field's Remove is not a silent no-op)", () => {
    render(<Harness initial={{ blocks: [{ id: "i", kind: "image", media: { mediaId: A } }, { id: "h", kind: "heading", text: "Keep" }] }} />);
    fireEvent.click(rows()[0].querySelector("button") as HTMLElement);
    expect(document.querySelector('[data-testid="field-content-block-image"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "remove-picture" }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("Keep");
  });
});

describe("a button's label while it has no link (V9c review, round 3)", () => {
  it("clearing the label of an unlinked button keeps the block and the field so replacement text can be typed", () => {
    const seen: ContentBlocks[] = [];
    render(<Harness initial={{ blocks: [] }} onContent={(c) => seen.push(c)} />);
    fireEvent.change(addSelect(), { target: { value: "button" } });
    const input = () => document.querySelector<HTMLInputElement>("input[data-content-button-label]") as HTMLInputElement;
    fireEvent.change(input(), { target: { value: "" } });
    expect(rows()).toHaveLength(1);
    expect(input().value).toBe("");
    expect(seen.at(-1)?.blocks[0]).toMatchObject({ kind: "button", label: t("cbButtonDefault") });
    fireEvent.change(input(), { target: { value: "Shop now" } });
    expect(seen.at(-1)?.blocks[0]).toMatchObject({ kind: "button", label: "Shop now", href: "" });
    expect(rows()).toHaveLength(1);
  });
});
