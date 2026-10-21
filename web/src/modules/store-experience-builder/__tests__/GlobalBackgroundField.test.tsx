/**
 * @vitest-environment jsdom
 *
 * P3-A-05 — the global background control inside the Appearance panel, driven through the real
 * `ControlPanels` with a stateful host (so each edit feeds the next render exactly as in the editor).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "@/modules/commerce-workspace/storefront-media";
import { ControlPanels } from "../ControlPanels";
import { clearDesignClipboard } from "../design/design-clipboard";
import { DesignInspector } from "../design/DesignInspector";
import { customizerMessage } from "../messages";
import type { SectionDesign } from "../presentation/section-design";
import type { DesignContext } from "../presentation/section-design-resolve";
import {
  DEFAULT_PRESENTATION_CONFIG,
  DEFAULT_STORE_BACKGROUND_COLOR,
  type StorefrontPresentationConfig,
} from "../presentation/config";
import { MEDIA_ID, MEDIA_ID_2, asset, usage } from "./media-fixtures";

vi.mock("@/modules/commerce-workspace/storefront-media", async (original) => ({
  ...(await original<typeof import("@/modules/commerce-workspace/storefront-media")>()),
  listStorefrontMedia: vi.fn(),
  fetchStorefrontMediaAsset: vi.fn(),
  ensureUsage: vi.fn(),
  usageStatus: vi.fn(),
}));
const list = vi.mocked(client.listStorefrontMedia);
const fetchAsset = vi.mocked(client.fetchStorefrontMediaAsset);
const status = vi.mocked(client.usageStatus);

type Config = StorefrontPresentationConfig;
const LEGACY: Config = { ...DEFAULT_PRESENTATION_CONFIG, backgroundColor: "#ffeedd" };

function Host({
  initial = LEGACY,
  locale = "en",
  onChange,
}: {
  initial?: Config;
  locale?: "en" | "ar";
  onChange?: (next: Config) => void;
}) {
  const [config, setConfig] = useState<Config>(initial);
  return (
    <>
      <ControlPanels
        panel="theme"
        config={config}
        locale={locale}
        liveStoreName={null}
        onChange={(next) => {
          onChange?.(next);
          setConfig(next);
        }}
      />
      <output data-testid="cfg">{JSON.stringify(config)}</output>
    </>
  );
}
const cfg = () => JSON.parse(screen.getByTestId("cfg").textContent ?? "{}") as Config;
const field = () => document.querySelector("[data-global-background]") as HTMLElement;
const type = (name: string) => within(field()).getByRole("button", { name });
const pressed = (el: HTMLElement) => el.getAttribute("aria-pressed") === "true";

const withBackground = (background: Config["background"], over: Partial<Config> = {}): Config => ({
  ...LEGACY,
  ...over,
  background,
});

beforeEach(() => {
  clearDesignClipboard();
  window.localStorage.clear();
  [list, fetchAsset, status].forEach((m) => m.mockReset());
  fetchAsset.mockResolvedValue(asset());
  status.mockResolvedValue(usage());
  list.mockResolvedValue({
    items: [asset({ id: MEDIA_ID_2, name: "second.jpg" }), asset({ id: MEDIA_ID, name: "first.jpg" })],
    meta: {
      nextCursor: null,
      hasMore: false,
      uploadsEnabled: true,
      maxFilesPerRequest: 5,
      maxBytes: 20_000_000,
      library: { assets: 2, maxAssets: 500, bytes: 0, maxBytes: 1_000_000_000 },
    },
  });
});
afterEach(cleanup);

async function pick(slot: string, name: RegExp) {
  const slotEl = document.querySelector(`[data-media-field="${slot}"]`) as HTMLElement;
  // an empty slot offers the pick button; a filled one offers Replace
  const opener = slotEl.querySelector(`[data-media-pick="${slot}"]`) ?? within(slotEl).getByRole("button", { name: "Replace" });
  fireEvent.click(opener as HTMLElement);
  fireEvent.click(await screen.findByRole("button", { name }));
}

describe("Appearance — global background: one control, three types", () => {
  it("is a single control; a legacy document opens as Solid with its colour and is not edited by opening", () => {
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    expect(document.querySelectorAll("[data-global-background]")).toHaveLength(1);
    expect(pressed(type("Solid colour"))).toBe(true);
    expect(pressed(type("Gradient"))).toBe(false);
    expect(pressed(type("Background image"))).toBe(false);
    expect((screen.getByRole("textbox", { name: "Store background" }) as HTMLInputElement).value).toBe("#ffeedd");
    expect(onChange).not.toHaveBeenCalled();
    // only the Solid fields are shown
    expect(field().querySelector('[data-global-bg-panel="gradient"]')).toBeNull();
    expect(field().querySelector('[data-global-bg-panel="image"]')).toBeNull();
  });

  it("Solid → Gradient → Image → Solid swaps the fields shown and the effective background", async () => {
    render(<Host />);
    fireEvent.click(type("Gradient"));
    expect(cfg().background).toMatchObject({ kind: "gradient", from: { hex: "#ffeedd" }, direction: "to-bottom" });
    expect(field().querySelector('[data-global-bg-panel="gradient"]')).toBeTruthy();
    expect(field().querySelector('[data-global-bg-panel="solid"]')).toBeNull();

    // Image is UI state only until a picture is picked: the gradient stays the effective background.
    fireEvent.click(type("Background image"));
    expect(cfg().background?.kind).toBe("gradient");
    expect(field().querySelector('[data-global-bg-panel="image"]')).toBeTruthy();
    expect(field().querySelector("[data-global-bg-pending]")).toBeTruthy();
    expect(pressed(type("Background image"))).toBe(true);

    fireEvent.click(type("Solid colour"));
    expect("background" in cfg()).toBe(false);
    expect(cfg().backgroundColor).toBe("#ffeedd");
    expect(field().querySelector('[data-global-bg-panel="solid"]')).toBeTruthy();
  });
});

describe("Appearance — Solid (existing picker + safe HEX)", () => {
  it("a valid HEX commits to the legacy colour; an invalid one is held as a draft with an error, never written", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    const box = screen.getByRole("textbox", { name: "Store background" }) as HTMLInputElement;

    await user.clear(box);
    await user.type(box, "#12");
    expect(onChange).not.toHaveBeenCalled(); // nothing half-typed reaches the document
    expect(screen.getByRole("alert").textContent).toMatch(/HEX/);
    expect(box.getAttribute("aria-invalid")).toBe("true");

    await user.type(box, "3456");
    expect(cfg().backgroundColor).toBe("#123456");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the colour picker writes the legacy colour and drops any advanced object", () => {
    render(<Host initial={withBackground({ kind: "gradient", from: { hex: "#000000" }, to: { hex: "#ffffff" }, direction: "to-end" })} />);
    fireEvent.click(type("Solid colour"));
    const picker = document.querySelector('[data-global-bg-panel="solid"] input[type="color"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { value: "#0a0b0c" } });
    expect(cfg().backgroundColor).toBe("#0a0b0c");
    expect("background" in cfg()).toBe(false);
  });

  it("editing the colour after an advanced background was selected changes what is painted (not only the legacy field)", () => {
    render(<Host initial={withBackground({ kind: "gradient", from: { hex: "#112233" }, to: { hex: "#445566" }, direction: "to-end" })} />);
    fireEvent.click(type("Solid colour"));
    expect(cfg().backgroundColor).toBe("#112233");
    expect("background" in cfg()).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: "Store background" }), { target: { value: "#778899" } });
    expect(cfg().backgroundColor).toBe("#778899");
    expect("background" in cfg()).toBe(false);
  });
});

describe("Appearance — Gradient", () => {
  const gradient = () => withBackground({ kind: "gradient", from: { hex: "#112233" }, to: { hex: "#445566" }, direction: "to-end" });

  it("two colour controls and the approved direction list (logical names), no free text for CSS", () => {
    render(<Host initial={gradient()} />);
    expect(field().querySelector('[data-colour-field="global-bg-from"]')).toBeTruthy();
    expect(field().querySelector('[data-colour-field="global-bg-to"]')).toBeTruthy();
    const select = field().querySelector("[data-global-bg-direction]") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "to-end", "to-start", "to-bottom", "to-top", "to-bottom-end", "to-bottom-start", "to-top-end", "to-top-start",
    ]);
    expect(Array.from(select.options).map((o) => o.textContent)).toContain("Towards line end");
  });

  it("editing colours and direction updates the document and the in-panel preview immediately", async () => {
    const user = userEvent.setup();
    render(<Host initial={gradient()} />);
    const toField = field().querySelector('[data-colour-field="global-bg-to"]') as HTMLElement;
    const hex = within(toField).getByRole("textbox", { name: /colour code/i });
    await user.clear(hex);
    await user.type(hex, "#abcdef");
    expect(cfg().background).toMatchObject({ kind: "gradient", to: { hex: "#abcdef" }, from: { hex: "#112233" } });

    fireEvent.change(field().querySelector("[data-global-bg-direction]") as HTMLSelectElement, { target: { value: "to-top-start" } });
    expect(cfg().background).toMatchObject({ direction: "to-top-start" });
    const preview = field().querySelector("[data-global-bg-gradient-preview]") as HTMLElement;
    expect(preview.style.backgroundImage).toContain("linear-gradient");
    expect(preview.style.backgroundImage).toContain("rgb(171, 205, 239)"); // #abcdef (jsdom serialises colours as rgb())
  });

  it("a role colour is stored as a role reference (follows the palette), not a copied hex", () => {
    render(<Host initial={gradient()} />);
    const fromField = field().querySelector('[data-colour-field="global-bg-from"]') as HTMLElement;
    fireEvent.click(fromField.querySelector('[data-colour-role="brand"]') as HTMLElement);
    expect(cfg().background).toMatchObject({ from: { role: "brand" } });
  });

  it("the in-panel preview mirrors a logical direction under Arabic (RTL) versus English (LTR)", () => {
    const { unmount } = render(<Host initial={gradient()} locale="en" />);
    const ltr = (field().querySelector("[data-global-bg-gradient-preview]") as HTMLElement).style.backgroundImage;
    unmount();
    render(<Host initial={gradient()} locale="ar" />);
    const rtl = (field().querySelector("[data-global-bg-gradient-preview]") as HTMLElement).style.backgroundImage;
    expect(ltr).not.toBe(rtl);
  });
});

describe("Appearance — Image", () => {
  it("choosing Image writes nothing; picking stores a decorative id-only reference and shows the draft-only note", async () => {
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    fireEvent.click(type("Background image"));
    expect(onChange).not.toHaveBeenCalled();
    expect(field().querySelector("[data-global-bg-pending]")?.textContent).toMatch(/Pick an image/);
    // the draft-only explanation is there before any picture is chosen
    expect(field().querySelector("[data-global-bg-draft-only]")?.textContent).toMatch(/not enabled yet/);

    await pick("global-background", /Use: second\.jpg/);
    await waitFor(() => expect(cfg().background).toEqual({ kind: "media", media: { mediaId: MEDIA_ID_2, decorative: true } }));
    expect(field().querySelector("[data-global-bg-pending]")).toBeNull();
    // the legacy colour remains the fallback beneath the picture
    expect(cfg().backgroundColor).toBe("#ffeedd");
    expect(field().querySelector("[data-global-bg-draft-only]")).toBeTruthy();
  });

  it("offers a clean image slot: no alt fields (decoration), no crop/rotate editor, no animation controls", async () => {
    render(<Host initial={withBackground({ kind: "media", media: { mediaId: MEDIA_ID, decorative: true } })} />);
    await waitFor(() => expect(field().querySelector('[data-media-field="global-background"]')).toBeTruthy());
    expect(field().querySelector("[data-media-alt]")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /decorative/i })).toBeNull();
    expect(field().querySelector("[data-media-edit]")).toBeNull();
    expect(field().textContent ?? "").not.toMatch(/animat|motion|video|autoplay/i);
  });

  it("desktop image, optional phone image, and clearing / replacing each", async () => {
    render(<Host initial={withBackground({ kind: "media", media: { mediaId: MEDIA_ID, decorative: true } })} />);
    await pick("global-background-phone", /Use: second\.jpg/);
    await waitFor(() =>
      expect(cfg().background).toMatchObject({ mobile: { mediaId: MEDIA_ID_2, decorative: true }, media: { mediaId: MEDIA_ID } }),
    );

    // replace the desktop image: the phone image is untouched
    await pick("global-background", /Use: second\.jpg/);
    await waitFor(() =>
      expect(cfg().background).toMatchObject({ media: { mediaId: MEDIA_ID_2 }, mobile: { mediaId: MEDIA_ID_2 } }),
    );

    // clear the phone image: the main image stays
    fireEvent.click(document.querySelector('[data-media-remove="global-background-phone"]') as HTMLElement);
    await waitFor(() => expect(cfg().background && "mobile" in cfg().background!).toBe(false));
    expect(cfg().background).toMatchObject({ kind: "media", media: { mediaId: MEDIA_ID_2 } });

    // clear the main image: back to the legacy colour, Image tab stays open for a new pick
    fireEvent.click(document.querySelector('[data-media-remove="global-background"]') as HTMLElement);
    await waitFor(() => expect("background" in cfg()).toBe(false));
    expect(cfg().backgroundColor).toBe("#ffeedd");
    expect(pressed(type("Background image"))).toBe(true);
    expect(field().querySelector("[data-global-bg-pending]")).toBeTruthy();
  });

  it("focal point per image through a keyboard-reachable 3×3 grid; centre is the default and is not stored", async () => {
    render(
      <Host
        initial={withBackground({
          kind: "media",
          media: { mediaId: MEDIA_ID, decorative: true },
          mobile: { mediaId: MEDIA_ID_2, decorative: true },
        })}
      />,
    );
    // Focal coordinates are physical, so the grid is left-to-right even in an RTL page.
    expect(field().querySelector("[data-global-bg-focal-grid]")?.getAttribute("dir")).toBe("ltr");
    const desktop = field().querySelector('[data-global-bg-focal="desktop"]') as HTMLElement;
    const phone = field().querySelector('[data-global-bg-focal="phone"]') as HTMLElement;
    expect(within(desktop).getAllByRole("button")).toHaveLength(9);
    // centred by default
    expect(pressed(within(desktop).getByRole("button", { name: /Main image focal point: middle center/i }))).toBe(true);

    fireEvent.click(within(desktop).getByRole("button", { name: /Top Right/i }));
    fireEvent.click(within(phone).getByRole("button", { name: /Bottom Left/i }));
    const bg = cfg().background as Extract<NonNullable<Config["background"]>, { kind: "media" }>;
    expect(bg.media.focal).toEqual({ x: 100, y: 0 });
    expect(bg.mobile?.focal).toEqual({ x: 0, y: 100 });

    // back to centre: the default is dropped, not stored
    fireEvent.click(within(desktop).getByRole("button", { name: /middle center/i }));
    const after = cfg().background as Extract<NonNullable<Config["background"]>, { kind: "media" }>;
    expect("focal" in after.media).toBe(false);
    expect(after.mobile?.focal).toEqual({ x: 0, y: 100 });
  });

  it("overlay: approved strengths only, 'none' clears it, and a colour appears once it is on", () => {
    render(<Host initial={withBackground({ kind: "media", media: { mediaId: MEDIA_ID, decorative: true } })} />);
    const alpha = field().querySelector("[data-global-bg-overlay-alpha]") as HTMLSelectElement;
    expect(Array.from(alpha.options).map((o) => o.value)).toEqual(["0", ...[5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90].map(String)]);
    expect(field().querySelector('[data-colour-field="global-bg-overlay-color"]')).toBeNull();

    fireEvent.change(alpha, { target: { value: "35" } });
    expect(cfg().background).toMatchObject({ overlay: { color: { role: "overlay" }, alpha: 35 } });
    const colour = field().querySelector('[data-colour-field="global-bg-overlay-color"]') as HTMLElement;
    fireEvent.change(within(colour).getByRole("textbox", { name: /colour code/i }), { target: { value: "#102030" } });
    expect(cfg().background).toMatchObject({ overlay: { color: { hex: "#102030" }, alpha: 35 } });

    fireEvent.change(alpha, { target: { value: "0" } });
    expect("overlay" in (cfg().background as object)).toBe(false);
  });

  it("the draft-only explanation never claims the image is publishable", () => {
    render(<Host initial={withBackground({ kind: "media", media: { mediaId: MEDIA_ID, decorative: true } })} />);
    const note = field().querySelector("[data-global-bg-draft-only]") as HTMLElement;
    expect(note.getAttribute("role")).toBe("note");
    expect(note.textContent).toMatch(/drafts and the preview only/);
    expect(note.textContent).toMatch(/rejected/);
    expect(field().textContent ?? "").not.toMatch(/ready to publish|publishable now|will be published/i);
    // the image note no longer offers a gradient as a way to publish (gradients are gated too)
    expect(note.textContent).not.toMatch(/gradient to publish/i);
    // solid never shows a draft-only note; a gradient shows its *own* (contrast) note, not the image one
    fireEvent.click(type("Gradient"));
    expect(field().querySelector('[data-global-bg-draft-only="image"]')).toBeNull();
    fireEvent.click(type("Solid colour"));
    expect(field().querySelector("[data-global-bg-draft-only]")).toBeNull();
  });

  it("a gradient is flagged draft-only: saved and previewed, publishing deferred until the contrast check", () => {
    render(<Host />);
    expect(field().querySelector("[data-global-bg-draft-only]")).toBeNull(); // solid: nothing to warn about
    fireEvent.click(type("Gradient"));
    const note = field().querySelector('[data-global-bg-draft-only="gradient"]') as HTMLElement;
    expect(note.getAttribute("role")).toBe("note");
    expect(note.textContent).toMatch(/drafts and the preview only/);
    expect(note.textContent).toMatch(/deferred until the text-contrast check is ready/);
    expect(note.textContent).toMatch(/Choose a solid colour to publish/);
    expect(field().textContent ?? "").not.toMatch(/ready to publish|publishable now|will be published/i);
    // the draft itself is still written and previewed normally
    expect(cfg().background?.kind).toBe("gradient");
    expect(field().querySelector("[data-global-bg-gradient-preview]")).toBeTruthy();
    // every direction keeps the note (it is about the type, not a particular value)
    fireEvent.change(field().querySelector("[data-global-bg-direction]") as HTMLSelectElement, { target: { value: "to-top-start" } });
    expect(field().querySelector('[data-global-bg-draft-only="gradient"]')).toBeTruthy();
    // switching back to Solid removes it
    fireEvent.click(type("Solid colour"));
    expect(field().querySelector("[data-global-bg-draft-only]")).toBeNull();
  });

  it("the gradient draft-only note is shown in Arabic as well", () => {
    render(<Host locale="ar" />);
    fireEvent.click(type("تدرج لوني"));
    const note = field().querySelector('[data-global-bg-draft-only="gradient"]') as HTMLElement;
    expect(note.textContent).toMatch(/المسودة والمعاينة فقط/);
    expect(note.textContent).toMatch(/فحص تباين النصوص/);
    expect(note.textContent).toMatch(/لوناً ثابتاً/);
  });

  it("a removed library image is reported by the slot itself, not silently", async () => {
    fetchAsset.mockResolvedValue(null);
    render(<Host initial={withBackground({ kind: "media", media: { mediaId: MEDIA_ID, decorative: true } })} />);
    await waitFor(() => expect(field().querySelector("[data-media-stale]")).toBeTruthy());
  });
});

describe("Appearance — Restore default vs switching type", () => {
  it("is disabled at the default and states how it differs from switching type", () => {
    render(<Host initial={{ ...LEGACY, backgroundColor: DEFAULT_STORE_BACKGROUND_COLOR }} />);
    const reset = field().querySelector("[data-global-bg-reset]") as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
    expect(reset.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(reset.getAttribute("aria-describedby") as string)?.textContent).toMatch(
      /Switching type replaces .*Restore default.* removes any gradient or image/,
    );
  });

  it("from a gradient or an image it removes the advanced object and returns the default colour", async () => {
    for (const background of [
      { kind: "gradient", from: { hex: "#112233" }, to: { hex: "#445566" }, direction: "to-end" } as const,
      { kind: "media", media: { mediaId: MEDIA_ID, decorative: true }, overlay: { color: { role: "overlay" }, alpha: 30 } } as const,
    ]) {
      render(<Host initial={withBackground(background, { backgroundColor: "#ff0000" })} />);
      const reset = field().querySelector("[data-global-bg-reset]") as HTMLButtonElement;
      expect(reset.disabled).toBe(false);
      fireEvent.click(reset);
      expect("background" in cfg()).toBe(false);
      expect(cfg().backgroundColor).toBe(DEFAULT_STORE_BACKGROUND_COLOR);
      expect(pressed(type("Solid colour"))).toBe(true);
      expect((field().querySelector("[data-global-bg-reset]") as HTMLButtonElement).disabled).toBe(true);
      cleanup();
    }
  });

  it("switching type is not a reset: it keeps the colour the merchant had", () => {
    render(<Host initial={{ ...LEGACY, backgroundColor: "#ff0000" }} />);
    fireEvent.click(type("Gradient"));
    fireEvent.click(type("Solid colour"));
    expect(cfg().backgroundColor).toBe("#ff0000");
  });
});

describe("Appearance — Arabic and keyboard", () => {
  it("shows the Arabic labels in an RTL page", () => {
    render(
      <div dir="rtl">
        <Host locale="ar" />
      </div>,
    );
    for (const name of ["لون ثابت", "تدرج لوني", "صورة خلفية"]) expect(type(name)).toBeTruthy();
    expect(within(field()).getByRole("group", { name: "نوع الخلفية" })).toBeTruthy();
    expect(within(field()).getByRole("button", { name: "استعادة الافتراضي" })).toBeTruthy();
    fireEvent.click(type("تدرج لوني"));
    const options = Array.from((field().querySelector("[data-global-bg-direction]") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toContain("نحو نهاية السطر");
    fireEvent.click(type("صورة خلفية"));
    expect(field().querySelector("[data-global-bg-draft-only]")?.textContent).toMatch(/المسودة والمعاينة فقط/);
    // the hex field stays left-to-right inside an RTL page
    fireEvent.click(type("لون ثابت"));
    expect(screen.getByRole("textbox", { name: "خلفية المتجر" }).getAttribute("dir")).toBe("ltr");
  });

  it("every control is a native, keyboard-operable element with an accessible name", async () => {
    const user = userEvent.setup();
    render(<Host />);
    expect(field().tagName).toBe("FIELDSET");
    expect(field().getAttribute("aria-labelledby")).toBeTruthy();
    const solid = type("Solid colour");
    solid.focus();
    await user.tab();
    expect(document.activeElement).toBe(type("Gradient"));
    await user.keyboard("{Enter}");
    expect(cfg().background?.kind).toBe("gradient");
    // the gradient's own controls are reachable by Tab and operable by keyboard
    const select = field().querySelector("[data-global-bg-direction]") as HTMLSelectElement;
    select.focus();
    await user.selectOptions(select, "to-top");
    expect(cfg().background).toMatchObject({ direction: "to-top" });
    // every button and select in the control has a name
    for (const el of field().querySelectorAll("button, select, input")) {
      const named =
        el.getAttribute("aria-label") ||
        (el as HTMLElement).textContent?.trim() ||
        el.closest("label")?.textContent?.trim() ||
        (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent);
      expect(named, el.outerHTML).toBeTruthy();
    }
  });
});

describe("Appearance — section-level backgrounds are untouched", () => {
  it("the section inspector keeps its own None / Solid / Gradient / Picture choice and writes only the section design", async () => {
    const ctx: DesignContext = { primaryColor: "#12372a", accentColor: null, dir: "ltr" };
    const designs: Array<SectionDesign | undefined> = [];
    function SectionHost() {
      const [design, setDesign] = useState<SectionDesign | undefined>(undefined);
      return (
        <DesignInspector
          type="hero"
          design={design}
          ctx={ctx}
          t={(key) => customizerMessage("en", key)}
          onChange={(next) => {
            designs.push(next);
            setDesign(next);
          }}
          locale="en"
        />
      );
    }
    render(<SectionHost />);
    const background = screen.getByRole("group", { name: "Background" });
    for (const name of ["None", "Solid", "Gradient", "Picture"]) {
      expect(within(background).getByRole("button", { name })).toBeTruthy();
    }
    fireEvent.click(within(background).getByRole("button", { name: "Solid" }));
    expect(designs.at(-1)?.background).toMatchObject({ kind: "solid" });
    // it is a different control: no global-background markup is rendered by the section inspector
    expect(document.querySelector("[data-global-background]")).toBeNull();
  });

  it("the Appearance panel offers exactly one background control and no section controls", () => {
    render(<Host />);
    expect(document.querySelectorAll("[data-global-background]")).toHaveLength(1);
    expect(document.querySelector("[data-design-picture]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Picture" })).toBeNull();
  });
});
