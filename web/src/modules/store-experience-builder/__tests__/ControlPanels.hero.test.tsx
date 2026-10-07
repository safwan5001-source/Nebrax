/**
 * @vitest-environment jsdom
 *
 * CUST-HV V6a (V0 §8.1–8.2) — the hero editor: each instance edits its OWN content (headline,
 * supporting line, up to two buttons); a hero with no content starts from the legacy global text
 * and the first edit writes explicit content; added / duplicated heroes never silently share text.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPanels } from "../ControlPanels";
import {
  DEFAULT_PRESENTATION_CONFIG,
  type PresentationHomeSection,
  type StorefrontPresentationConfig,
} from "../presentation/config";

afterEach(cleanup);

const config = (
  sections: PresentationHomeSection[],
  homepage: Partial<StorefrontPresentationConfig["homepage"]> = {},
): StorefrontPresentationConfig => ({
  ...DEFAULT_PRESENTATION_CONFIG,
  homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, ...homepage, sections },
});

function mount(cfg: StorefrontPresentationConfig, selectedSection: string | null = "hero") {
  const onChange = vi.fn();
  render(
    <ControlPanels
      panel="homepage"
      config={cfg}
      locale="en"
      liveStoreName={null}
      onChange={onChange}
      selectedSection={selectedSection}
      onSelectSection={() => {}}
    />,
  );
  return onChange;
}
const sectionsOf = (onChange: ReturnType<typeof vi.fn>) =>
  (onChange.mock.calls.at(-1)![0] as StorefrontPresentationConfig).homepage.sections;
const input = (label: string, index = 0) =>
  screen.getAllByLabelText(label)[index] as HTMLInputElement;

describe("hero editor (CUST-HV V6a)", () => {
  it("a hero with no content starts from the legacy global text", () => {
    mount(
      config([{ id: "hero", type: "hero", visible: true }], {
        heroHeadline: "Legacy headline",
        heroSubheadline: "Legacy line",
      }),
    );
    expect(input("Hero headline").value).toBe("Legacy headline");
    expect(input("Supporting line").value).toBe("Legacy line");
  });

  it("the first edit writes the instance's own content (legacy text copied) and leaves the globals alone", () => {
    const onChange = mount(
      config([{ id: "hero", type: "hero", visible: true }], {
        heroHeadline: "Legacy headline",
        heroSubheadline: "Legacy line",
      }),
    );
    fireEvent.change(input("Hero headline"), { target: { value: "Legacy headline!" } });
    const next = onChange.mock.calls.at(-1)![0] as StorefrontPresentationConfig;
    expect(next.homepage.sections[0].content).toEqual({
      headline: "Legacy headline!",
      subheadline: "Legacy line",
    });
    expect(next.homepage.heroHeadline).toBe("Legacy headline");
    expect(next.homepage.heroSubheadline).toBe("Legacy line");
  });

  it("each instance shows and edits only its own content", () => {
    const onChange = mount(
      config(
        [
          { id: "hero", type: "hero", visible: true, content: { headline: "First" } },
          { id: "hero-2", type: "hero", visible: true, content: { headline: "Second" } },
        ],
        { heroHeadline: "ignored legacy" },
      ),
      "hero-2",
    );
    expect(input("Hero headline").value).toBe("Second");
    fireEvent.change(input("Hero headline"), { target: { value: "Second!" } });
    expect(sectionsOf(onChange).map((s) => s.content)).toEqual([
      { headline: "First" },
      { headline: "Second!" },
    ]);
  });

  it("writes up to two buttons, keeps an incomplete one as a draft, and drops an emptied slot", () => {
    const onChange = mount(
      config([{ id: "hero", type: "hero", visible: true, content: { headline: "H" } }]),
    );
    fireEvent.change(input("Button text", 0), { target: { value: "Shop " } });
    expect(sectionsOf(onChange)[0].content).toEqual({
      headline: "H",
      ctas: [{ label: "Shop ", href: "" }],
    });
    fireEvent.change(input("Link", 1), { target: { value: "/about" } });
    expect(sectionsOf(onChange)[0].content).toEqual({
      headline: "H",
      ctas: [{ label: "", href: "/about" }], // the empty first slot is not stored
    });
  });

  it("clearing every field leaves explicit empty content — the text does NOT fall back to the legacy globals", () => {
    const onChange = mount(
      config([{ id: "hero", type: "hero", visible: true, content: { headline: "H" } }], {
        heroHeadline: "Legacy",
      }),
    );
    fireEvent.change(input("Hero headline"), { target: { value: "" } });
    expect(sectionsOf(onChange)[0].content).toEqual({ headline: "" });
  });

  it("a hero added from the Library starts with its own empty content, never the legacy text", () => {
    const onChange = mount(
      config([{ id: "hero", type: "hero", visible: true }], { heroHeadline: "Legacy" }),
      null,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add section/i }));
    fireEvent.click(document.querySelector('[data-picker-option="hero"]') as HTMLElement);
    const added = sectionsOf(onChange).at(-1)!;
    expect(added.type).toBe("hero");
    expect(added.content).toEqual({ headline: "" });
  });

  it("duplicating a hero that still reads the legacy text makes that text explicit on the copy", () => {
    const onChange = mount(
      config([{ id: "hero", type: "hero", visible: true }], {
        heroHeadline: "Legacy",
        heroSubheadline: "Line",
      }),
      null,
    );
    fireEvent.click(screen.getByRole("button", { name: "Duplicate section" }));
    const [original, copy] = sectionsOf(onChange);
    expect(original.content).toBeUndefined(); // the original keeps reading the globals
    expect(copy.id).not.toBe("hero");
    expect(copy.content).toEqual({ headline: "Legacy", subheadline: "Line" });
  });

  it("deleting a hero asks first only once it says something", () => {
    const empty = mount(
      config([{ id: "hero", type: "hero", visible: true, content: { headline: "" } }]),
      null,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete section" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(sectionsOf(empty)).toEqual([]);
    cleanup();

    const authored = mount(
      config([{ id: "hero", type: "hero", visible: true, content: { headline: "Welcome" } }]),
      null,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete section" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(authored).not.toHaveBeenCalled();
  });
});
