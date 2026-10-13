/**
 * @vitest-environment jsdom
 *
 * Direct-typing regressions. `ExperienceBuilder.updateDraft` re-normalises the whole config on every change, and the
 * normaliser trims text / drops partial URLs. Every other test here uses a `vi.fn()` onChange, which never feeds the
 * normalised value back — so a field bound straight to the draft looked fine in tests and broke for a real keyboard
 * (Space at the end of a word vanished; a URL typed key by key was cleared after the first character).
 * This harness reproduces the real loop: onChange → normalizePresentationConfig → re-render.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ControlPanels } from "../ControlPanels";
import { BufferedText } from "../BufferedText";
import { CUSTOMIZER_MESSAGES } from "../messages";
import { normalizePresentationConfig, DEFAULT_PRESENTATION_CONFIG, type StorefrontPresentationConfig } from "../presentation/config";

afterEach(cleanup);

/** The verification panel's last text input is the source URL (labels are not `for`-bound in this panel). */
const sourceUrlField = () => {
  const inputs = Array.from(document.querySelectorAll("input[type=text], input:not([type])")) as HTMLInputElement[];
  return inputs[inputs.length - 1];
};

let latest: StorefrontPresentationConfig;

function Harness({
  panel,
  initial,
  selectedSection,
}: {
  panel: "announcements" | "social" | "verification" | "homepage";
  initial: StorefrontPresentationConfig;
  selectedSection?: string;
}) {
  const [config, setConfig] = useState(() => normalizePresentationConfig(initial));
  latest = config;
  return (
    <ControlPanels
      panel={panel}
      config={config}
      locale="en"
      liveStoreName={null}
      timezone="Asia/Riyadh"
      selectedSection={selectedSection}
      onChange={(next) => {
        latest = normalizePresentationConfig(next);
        setConfig(latest);
      }}
    />
  );
}

const withAnnouncement = (over: Record<string, unknown> = {}): StorefrontPresentationConfig => ({
  ...DEFAULT_PRESENTATION_CONFIG,
  announcements: { enabled: true, items: [{ id: "a1", text: "", enabled: true, ...over }] },
});

describe("announcement message text", () => {
  it("keeps typed spaces between words (EN)", async () => {
    render(<Harness panel="announcements" initial={withAnnouncement()} />);
    const field = document.querySelector("textarea") as HTMLTextAreaElement;
    await userEvent.type(field, "Free shipping today");
    expect(field.value).toBe("Free shipping today");
    expect(latest.announcements?.items[0].text).toBe("Free shipping today");
  });

  it("keeps typed spaces between Arabic words", async () => {
    render(<Harness panel="announcements" initial={withAnnouncement()} />);
    const field = document.querySelector("textarea") as HTMLTextAreaElement;
    await userEvent.type(field, "شحن مجاني اليوم");
    expect(field.value).toBe("شحن مجاني اليوم");
    expect(latest.announcements?.items[0].text).toBe("شحن مجاني اليوم");
  });

  it("stores the trimmed form but never rewrites what is being typed", async () => {
    render(<Harness panel="announcements" initial={withAnnouncement()} />);
    const field = document.querySelector("textarea") as HTMLTextAreaElement;
    await userEvent.type(field, "Hello ");
    expect(field.value).toBe("Hello ");
    expect(latest.announcements?.items[0].text).toBe("Hello");
  });

  it("supports Backspace and mid-text edits", async () => {
    render(<Harness panel="announcements" initial={withAnnouncement({ text: "Hello world" })} />);
    const field = document.querySelector("textarea") as HTMLTextAreaElement;
    await userEvent.type(field, "{Backspace}{Backspace}");
    expect(field.value).toBe("Hello wor");
    await userEvent.type(field, "{ArrowLeft}{ArrowLeft}{ArrowLeft} big", { initialSelectionStart: 9, initialSelectionEnd: 9 });
    expect(latest.announcements?.items[0].text).toContain("big");
  });
});

describe("announcement link", () => {
  it("accepts a link typed key by key", async () => {
    render(<Harness panel="announcements" initial={withAnnouncement()} />);
    const field = document.querySelector('input[inputmode="url"]') as HTMLInputElement;
    await userEvent.type(field, "https://shop.example.com/sale");
    expect(field.value).toBe("https://shop.example.com/sale");
    expect(latest.announcements?.items[0].href).toBe("https://shop.example.com/sale");
  });

  it("accepts an internal path typed key by key", async () => {
    render(<Harness panel="announcements" initial={withAnnouncement()} />);
    const field = document.querySelector('input[inputmode="url"]') as HTMLInputElement;
    await userEvent.type(field, "/offers");
    expect(field.value).toBe("/offers");
    expect(latest.announcements?.items[0].href).toBe("/offers");
  });
});

describe("announcement link validation hint", () => {
  const hint = (key: "annLinkInvalid" | "annLinkHint") => CUSTOMIZER_MESSAGES.en[key];

  it("warns about a typed link the draft will not store", async () => {
    render(<Harness panel="announcements" initial={withAnnouncement()} />);
    const field = document.querySelector('input[inputmode="url"]') as HTMLInputElement;
    await userEvent.type(field, "http://example.com");
    expect(field.value).toBe("http://example.com");
    expect(latest.announcements?.items[0].href).toBeUndefined();
    expect(screen.queryByText(hint("annLinkInvalid"))).not.toBeNull();
  });

  it("shows the neutral hint for a valid link", async () => {
    render(<Harness panel="announcements" initial={withAnnouncement()} />);
    const field = document.querySelector('input[inputmode="url"]') as HTMLInputElement;
    await userEvent.type(field, "/offers");
    expect(screen.queryByText(hint("annLinkInvalid"))).toBeNull();
    expect(screen.queryByText(hint("annLinkHint"))).not.toBeNull();
  });
});

describe("social links", () => {
  const social = (url = ""): StorefrontPresentationConfig => ({
    ...DEFAULT_PRESENTATION_CONFIG,
    social: [{ id: "s1", network: "instagram", url, enabled: true }],
  });

  it("accepts an Instagram URL typed key by key", async () => {
    render(<Harness panel="social" initial={social()} />);
    const field = screen.getByPlaceholderText("https://") as HTMLInputElement;
    await userEvent.type(field, "https://instagram.com/awj_store");
    expect(field.value).toBe("https://instagram.com/awj_store");
    expect(latest.social[0].url).toBe("https://instagram.com/awj_store");
  });

  it("accepts a Snapchat URL typed key by key", async () => {
    render(<Harness panel="social" initial={{ ...social(), social: [{ id: "s1", network: "snapchat", url: "", enabled: true }] }} />);
    const field = screen.getByPlaceholderText("https://") as HTMLInputElement;
    await userEvent.type(field, "https://www.snapchat.com/add/awj");
    expect(field.value).toBe("https://www.snapchat.com/add/awj");
    expect(latest.social[0].url).toBe("https://www.snapchat.com/add/awj");
  });

  it("still handles paste, select-all replace and Delete", async () => {
    render(<Harness panel="social" initial={social("https://instagram.com/old")} />);
    const field = screen.getByPlaceholderText("https://") as HTMLInputElement;
    await userEvent.clear(field);
    await userEvent.click(field);
    await userEvent.paste("https://instagram.com/new");
    expect(latest.social[0].url).toBe("https://instagram.com/new");
    await userEvent.type(field, "{Backspace}");
    expect(field.value).toBe("https://instagram.com/ne");
  });

  it("does not store an unsafe URL even though the field shows what was typed", async () => {
    render(<Harness panel="social" initial={social()} />);
    const field = screen.getByPlaceholderText("https://") as HTMLInputElement;
    await userEvent.type(field, "javascript:alert(1)");
    expect(latest.social[0].url).toBe("");
  });
});

describe("verification source URL", () => {
  it("accepts a URL typed key by key", async () => {
    render(<Harness panel="verification" initial={DEFAULT_PRESENTATION_CONFIG} />);
    const field = sourceUrlField();
    await userEvent.type(field, "https://example.gov.sa/cr/123");
    expect(field.value).toBe("https://example.gov.sa/cr/123");
    expect(latest.verification.sourceUrl).toBe("https://example.gov.sa/cr/123");
  });
});

describe("BufferedText external sync", () => {
  it("adopts a value that changed from elsewhere (undo / restored version)", async () => {
    function Wrapper() {
      const [v, setV] = useState("one");
      return (
        <>
          <BufferedText value={v} onCommit={setV} data-testid="f" />
          <button type="button" onClick={() => setV("restored")}>
            restore
          </button>
        </>
      );
    }
    render(<Wrapper />);
    await userEvent.type(screen.getByTestId("f"), " two");
    expect((screen.getByTestId("f") as HTMLInputElement).value).toBe("one two");
    await userEvent.click(screen.getByRole("button", { name: "restore" }));
    expect((screen.getByTestId("f") as HTMLInputElement).value).toBe("restored");
  });
});

describe("announcement length cap", () => {
  it("never shows more than the stored 120 code points", async () => {
    render(<Harness panel="announcements" initial={withAnnouncement()} />);
    const field = document.querySelector("textarea") as HTMLTextAreaElement;
    await userEvent.type(field, "ab ".repeat(60));
    expect(Array.from(field.value.trim()).length).toBeLessThanOrEqual(120);
    expect(latest.announcements?.items[0].text).toBe(field.value.trim());
  });
});

const withSection = (type: string, content: Record<string, unknown>): StorefrontPresentationConfig => ({
  ...DEFAULT_PRESENTATION_CONFIG,
  homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, sections: [{ id: "s1", type, visible: true, content } as never] },
});
const sectionContent = () => (latest.homepage.sections[0] as { content: Record<string, any> }).content;

describe("banner section fields", () => {
  const initial = () => withSection("banner", { title: "x", subtitle: "x", ctaLabel: "", ctaHref: "", imageUrl: null });
  const inputs = () => Array.from(document.querySelectorAll("input")) as HTMLInputElement[];
  const byLabel = (text: string) => {
    const label = Array.from(document.querySelectorAll("label")).find((l) => l.textContent?.startsWith(text));
    return label?.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement;
  };

  it("keeps spaces typed in the title and subtitle", async () => {
    render(<Harness panel="homepage" selectedSection="s1" initial={initial()} />);
    const title = byLabel("Title") as HTMLInputElement;
    await userEvent.type(title, " big summer sale");
    expect(title.value).toBe("x big summer sale");
    expect(sectionContent().title).toBe("x big summer sale");
    const subtitle = document.querySelector("textarea") as HTMLTextAreaElement;
    await userEvent.type(subtitle, " up to 50% off");
    expect(subtitle.value).toBe("x up to 50% off");
    expect(sectionContent().subtitle).toBe("x up to 50% off");
  });

  it("accepts the image URL typed key by key", async () => {
    render(<Harness panel="homepage" selectedSection="s1" initial={initial()} />);
    const image = byLabel("Image URL") as HTMLInputElement;
    await userEvent.type(image, "https://cdn.example.com/banner.png");
    expect(image.value).toBe("https://cdn.example.com/banner.png");
    expect(sectionContent().imageUrl).toBe("https://cdn.example.com/banner.png");
    expect(inputs().length).toBeGreaterThan(0);
  });
});

describe("non-BMP text (emoji) in capped section fields", () => {
  it("never shows more than the draft stores", async () => {
    render(<Harness panel="homepage" selectedSection="s1" initial={withSection("banner", { title: "", subtitle: "", ctaLabel: "", ctaHref: "", imageUrl: null })} />);
    const title = Array.from(document.querySelectorAll("label")).find((l) => l.textContent?.startsWith("Title"))?.querySelector("input") as HTMLInputElement;
    await userEvent.click(title);
    await userEvent.paste("😀".repeat(120));
    expect(title.value).toBe(sectionContent().title);
  });
});

describe("benefits section fields", () => {
  it("keeps spaces typed in a benefit title and body", async () => {
    render(<Harness panel="homepage" selectedSection="s1" initial={withSection("benefits", { items: [{ id: "b1", title: "x", body: "x" }] })} />);
    const title = Array.from(document.querySelectorAll("input")).find((i) => i.value === "x") as HTMLInputElement;
    await userEvent.type(title, " free delivery");
    expect(title.value).toBe("x free delivery");
    const body = document.querySelector("textarea") as HTMLTextAreaElement;
    await userEvent.type(body, " on all orders");
    expect(body.value).toBe("x on all orders");
    expect(sectionContent().items[0]).toMatchObject({ title: "x free delivery", body: "x on all orders" });
  });
});

describe("social link visibility toggle", () => {
  it("changes only the toggled row", async () => {
    render(
      <Harness
        panel="social"
        initial={{
          ...DEFAULT_PRESENTATION_CONFIG,
          social: [
            { id: "s1", network: "instagram", url: "https://instagram.com/a", enabled: true },
            { id: "s2", network: "snapchat", url: "https://www.snapchat.com/add/b", enabled: true },
          ],
        }}
      />,
    );
    const toggles = screen.getAllByRole("checkbox");
    await userEvent.click(toggles[0]);
    expect(latest.social).toEqual([
      { id: "s1", network: "instagram", url: "https://instagram.com/a", enabled: false },
      { id: "s2", network: "snapchat", url: "https://www.snapchat.com/add/b", enabled: true },
    ]);
  });
});

describe("switching between two benefits sections", () => {
  it("does not carry the first section's unsaved buffer into the second", async () => {
    const section = (id: string) => ({ id, type: "benefits", visible: true, content: { items: [{ id: "benefit-1", title: "Free", body: "" }] } }) as never;
    const config = { ...DEFAULT_PRESENTATION_CONFIG, homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, sections: [section("s1"), section("s2")] } };
    const props = { panel: "homepage" as const, config, locale: "en" as const, liveStoreName: null, onChange: () => {} };
    const { rerender } = render(<ControlPanels {...props} selectedSection="s1" />);
    const titleInput = () => Array.from(document.querySelectorAll("input")).find((i) => i.value.startsWith("Free")) as HTMLInputElement;
    await userEvent.type(titleInput(), " ");
    expect(titleInput().value).toBe("Free ");
    rerender(<ControlPanels {...props} selectedSection="s2" />);
    expect(titleInput().value).toBe("Free");
  });
});
