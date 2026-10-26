/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPanels } from "../ControlPanels";
import { describePublishIssues } from "../announcement-status";
import { CUSTOMIZER_MESSAGES, customizerMessage } from "../messages";
import { PolicyMarkdownPreview, safePreviewHref } from "../PolicyMarkdownPreview";
import {
  charCount,
  parsePolicyIssuePath,
  policyFieldIssues,
  policyStatus,
  withPolicyField,
} from "../policy-edit";
import {
  DEFAULT_PRESENTATION_CONFIG,
  type PresentationContentPage,
  type StorefrontPresentationConfig,
} from "../presentation";

afterEach(() => cleanup());

const page = (over: Partial<PresentationContentPage> = {}): PresentationContentPage => ({
  id: "page-privacy",
  slug: "privacy-policy",
  title: "legacy",
  enabled: true,
  ...over,
});

function renderPages(
  config: StorefrontPresentationConfig = DEFAULT_PRESENTATION_CONFIG,
  locale: "ar" | "en" = "en",
) {
  const onChange = vi.fn();
  const view = render(
    <ControlPanels panel="pages" config={config} locale={locale} liveStoreName={null} onChange={onChange} />,
  );
  return { onChange, view };
}

const lastPages = (fn: ReturnType<typeof vi.fn>): PresentationContentPage[] =>
  fn.mock.calls.at(-1)?.[0].pages;

describe("policy-edit helpers (B8-3)", () => {
  it("keeps legacy pages byte-identical: no content until text is typed, and it disappears when emptied", () => {
    const legacy = page();
    expect("content" in legacy).toBe(false);
    const typed = withPolicyField(legacy, "ar", "body", "نص");
    expect(typed.content).toEqual({ ar: { title: "", body: "نص" } });
    expect(typed.title).toBe("legacy");
    const cleared = withPolicyField(typed, "ar", "body", "   ");
    expect(cleared).toEqual(legacy);
    expect("content" in cleared).toBe(false);
  });

  it("validates the exact boundaries (80 title / 20,000 body, by code point)", () => {
    const at = (title: number, body: number) =>
      page({ content: { ar: { title: "ع".repeat(title), body: "ب".repeat(body) } } });
    expect(policyFieldIssues(at(80, 20000))).toEqual([]);
    expect(policyFieldIssues(at(81, 20001))).toEqual([
      { locale: "ar", field: "title", over: 1 },
      { locale: "ar", field: "body", over: 1 },
    ]);
    // an astral character is one code point on both sides
    expect(charCount("😀".repeat(80))).toBe(80);
    expect(policyFieldIssues(page({ content: { en: { title: "😀".repeat(80), body: "" } } }))).toEqual([]);
  });

  it("derives draft status and parses server issue paths", () => {
    expect(policyStatus(page({ enabled: false }))).toBe("hidden");
    expect(policyStatus(page())).toBe("empty");
    expect(policyStatus(page({ content: { en: { title: "", body: "x" } } }))).toBe("ready");
    expect(policyStatus(page({ content: { en: { title: "t", body: "  " } } }))).toBe("empty");
    expect(parsePolicyIssuePath("pages.4.content.ar.body")).toEqual({ index: 4, locale: "ar", field: "body" });
    expect(parsePolicyIssuePath("pages.4.title")).toBeNull();
    expect(parsePolicyIssuePath("announcements.items[0]")).toBeNull();
  });

  it("has AR and EN copy for every policy key", () => {
    const keys = Object.keys(CUSTOMIZER_MESSAGES.en).filter((k) => k.startsWith("polic"));
    expect(keys.length).toBeGreaterThanOrEqual(15);
    for (const key of keys) expect(Object.keys(CUSTOMIZER_MESSAGES.ar)).toContain(key);
  });
});

describe("Policy editor in the Content panel", () => {
  it("offers the editor only on the four policy pages", () => {
    renderPages();
    expect(screen.getAllByRole("button", { name: "Edit text" })).toHaveLength(4);
  });

  it("edits Arabic then English text through the normal patch (pages[].content)", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPages();
    const privacy = screen.getAllByRole("button", { name: "Edit text" })[1].closest("li") as HTMLElement;
    await user.click(within(privacy).getByRole("button", { name: "Edit text" }));

    const body = within(privacy).getByLabelText("Policy text") as HTMLTextAreaElement;
    expect(body.getAttribute("dir")).toBe("ltr");
    await user.click(within(privacy).getByRole("button", { name: "العربية" }));
    const arBody = within(privacy).getByLabelText("Policy text") as HTMLTextAreaElement;
    expect(arBody.getAttribute("dir")).toBe("rtl");
    expect((within(privacy).getByLabelText("Policy title") as HTMLInputElement).getAttribute("dir")).toBe("rtl");

    fireEvent.change(arBody, { target: { value: "## خصوصيتك\n\nنحمي بياناتك" } });
    const afterAr = lastPages(onChange).find((p) => p.slug === "privacy-policy");
    expect(afterAr?.content).toEqual({ ar: { title: "", body: "## خصوصيتك\n\nنحمي بياناتك" } });
    expect(afterAr?.title).toBe(""); // legacy title untouched
    expect(lastPages(onChange).filter((p) => "content" in p)).toHaveLength(1);
  });

  it("shows counters and an actionable error beyond the limits, per field", async () => {
    const user = userEvent.setup();
    const over = page({
      content: { en: { title: "t".repeat(85), body: "b".repeat(20003) } },
    });
    renderPages({
      ...DEFAULT_PRESENTATION_CONFIG,
      pages: DEFAULT_PRESENTATION_CONFIG.pages.map((p) => (p.slug === "privacy-policy" ? { ...p, ...over, id: p.id } : p)),
    });
    const privacy = screen.getAllByRole("button", { name: "Edit text" })[1].closest("li") as HTMLElement;
    await user.click(within(privacy).getByRole("button", { name: "Edit text" }));

    expect(within(privacy).getByText("85 / 80")).toBeTruthy();
    expect(within(privacy).getByText("20,003 / 20,000")).toBeTruthy();
    const alerts = within(privacy).getAllByRole("alert").map((a) => a.textContent);
    expect(alerts).toEqual([
      "Over the limit by 5 characters — shorten it before saving.",
      "Over the limit by 3 characters — shorten it before saving.",
    ]);
    expect((within(privacy).getByLabelText("Policy title") as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
  });

  it("distinguishes hidden / empty / ready policies and says visitors need a publish", async () => {
    const user = userEvent.setup();
    const pages = DEFAULT_PRESENTATION_CONFIG.pages.map((p) =>
      p.slug === "privacy-policy"
        ? { ...p, enabled: true, content: { en: { title: "", body: "Hello" } } }
        : p.slug === "returns-policy"
          ? { ...p, enabled: true }
          : { ...p, enabled: false },
    );
    renderPages({ ...DEFAULT_PRESENTATION_CONFIG, pages });
    expect(screen.getByText(/visitors only see it after the version is published/)).toBeTruthy();
    for (const [name, status] of [
      ["Privacy", "ready"],
      ["Returns", "empty"],
      ["Terms", "hidden"],
    ] as const) {
      const li = screen.getByText(name).closest("li") as HTMLElement;
      await user.click(within(li).getByRole("button", { name: "Edit text" }));
      expect(within(li).getByTestId("policy-status").getAttribute("data-status")).toBe(status);
    }
  });

  it("previews Markdown safely and never injects HTML", async () => {
    const user = userEvent.setup();
    const hostile =
      '## Title\n\n<script>alert(1)</script><img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1)) [ok](https://example.com) **bold**\n\n![pic](https://e.com/p.png)';
    const config = {
      ...DEFAULT_PRESENTATION_CONFIG,
      pages: DEFAULT_PRESENTATION_CONFIG.pages.map((p) =>
        p.slug === "privacy-policy" ? { ...p, content: { en: { title: "", body: hostile } } } : p,
      ),
    };
    renderPages(config);
    const privacy = screen.getAllByRole("button", { name: "Edit text" })[1].closest("li") as HTMLElement;
    await user.click(within(privacy).getByRole("button", { name: "Edit text" }));
    await user.click(within(privacy).getByRole("button", { name: "Preview" }));

    const preview = within(privacy).getByTestId("policy-preview");
    expect(preview.querySelector("script, img, iframe, svg, [onerror]")).toBeNull();
    expect(preview.querySelector("h2")?.textContent).toBe("Title");
    const anchors = [...preview.querySelectorAll("a")];
    expect(anchors.map((a) => a.getAttribute("href"))).toEqual(["https://example.com"]);
    expect(anchors[0].getAttribute("rel")).toBe("noopener nofollow ugc");
    expect(preview.textContent).toContain("bad"); // unsafe link degrades to plain text
    expect(preview.querySelector("strong")?.textContent).toBe("bold");
    expect(preview.innerHTML).not.toMatch(/javascript:|<script/i);
  });
});

describe("PolicyMarkdownPreview safety", () => {
  const html = (md: string) => render(<PolicyMarkdownPreview markdown={md} />).container.innerHTML;

  it("accepts only https/mailto/tel hrefs, with disguised schemes rejected", () => {
    expect(safePreviewHref("https://a.test")).toBe("https://a.test");
    expect(safePreviewHref("mailto:a@b.test")).toBe("mailto:a@b.test");
    expect(safePreviewHref("tel:+966500000000")).toBe("tel:+966500000000");
    for (const bad of [
      "http://a.test",
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      " javascript:alert(1)",
      "​javascript:alert(1)",
      "data:text/html;base64,AAAA",
      "vbscript:x",
      "file:///etc/passwd",
      "/relative",
      "//proto.test",
      'https://a.test/"onmouseover="x',
    ]) {
      expect(safePreviewHref(bad), bad).toBeNull();
    }
  });

  it("renders encoded and raw payloads as inert text", () => {
    for (const md of [
      "<script>alert(1)</script>",
      "&lt;script&gt;alert(1)&lt;/script&gt;",
      "<a href=\"javascript:alert(1)\" onclick=\"x\">x</a>",
      "[x](&#106;avascript:alert(1))",
      "<svg onload=alert(1)>",
      "<!-- <script>x</script> -->",
    ]) {
      const out = html(md);
      expect(out, md).not.toMatch(/<(script|svg|img|iframe)\b/i);
      expect(out, md).not.toMatch(/\son[a-z]+=/i);
      expect(out, md).not.toMatch(/href="(?!https:|mailto:|tel:)/i);
    }
  });
});

describe("describePublishIssues — policy 422 mapping (B8-3)", () => {
  const en = (k: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", k);
  const ar = (k: Parameters<typeof customizerMessage>[1]) => customizerMessage("ar", k);
  const name = (i: number) => (i === 4 ? "Privacy" : null);

  it("names the policy, language and field", () => {
    const out = describePublishIssues(
      { "pages.4.content.ar.body": "policy_body_too_long", "pages.4.content.en.title": "policy_title_too_long" },
      en,
      name,
    );
    expect(out).toBe(
      "Could not save: a policy text is longer than allowed. Privacy (العربية): policy text is over 20,000 characters · Privacy (English): policy title is over 80 characters",
    );
    expect(describePublishIssues({ "pages.4.content.ar.body": "policy_body_too_long" }, ar, name)).toMatch(
      /Privacy \(العربية\): نص السياسة يتجاوز 20,000 حرف/,
    );
  });

  it("falls back safely for unknown policy or code and never leaks raw codes", () => {
    const out = describePublishIssues({ "pages.9.content.en.body": "something_else" }, en);
    expect(out).toContain("(English)");
    expect(out).not.toMatch(/something_else|pages\.9/);
    expect(describePublishIssues({ "pages.9.title": "x" }, en)).toBeNull();
  });
});
