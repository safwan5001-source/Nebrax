import { describe, expect, it } from "vitest";
import { assertSafePolicyHtml, UnsafePolicyHtmlError } from "../safe-html";

const reject = (html: string) =>
  expect(() => assertSafePolicyHtml(html), html).toThrow(UnsafePolicyHtmlError);

describe("assertSafePolicyHtml (X4 defense in depth)", () => {
  it("accepts exactly what the backend renders", () => {
    for (const html of [
      "<p>plain</p>",
      "<h2>عنوان</h2>\n<p>نص <strong>عريض</strong> و<em>مائل</em></p>",
      "<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<ol><li>x</li></ol>",
      "<blockquote>\n<p>q</p>\n</blockquote>",
      "<p>a<br />b</p>",
      '<p><a href="https://example.com/x?a=1&amp;b=2" rel="noopener nofollow ugc">link</a></p>',
      '<a href="mailto:a@b.test" rel="noopener nofollow ugc">m</a>',
      '<a href="tel:+966500000000" rel="noopener nofollow ugc">t</a>',
      "<p>escaped &lt;script&gt;alert(1)&lt;/script&gt; text</p>",
    ]) {
      expect(() => assertSafePolicyHtml(html), html).not.toThrow();
    }
  });

  it("rejects tags outside the allowlist", () => {
    for (const html of [
      "<script>alert(1)</script>",
      "<style>p{}</style>",
      '<iframe src="https://evil.test"></iframe>',
      "<svg onload=alert(1)>",
      '<img src="x">',
      "<form><input></form>",
      "<object data=x></object>",
      "<h1>big</h1>",
      "<table><tr><td>x</td></tr></table>",
      "<div>x</div>",
      "<math></math>",
    ]) {
      reject(html);
    }
  });

  it("rejects any attribute on non-anchor tags and any stray angle bracket", () => {
    for (const html of [
      '<p style="color:red">x</p>',
      '<p onclick="x">x</p>',
      '<strong class="a">x</strong>',
      "<p>a < b</p>",
      "<p>a > b</p>",
      "<p>x</p><",
      "<!-- c -->",
      "<![CDATA[x]]>",
    ]) {
      reject(html);
    }
  });

  it("rejects unsafe or disguised anchors", () => {
    for (const html of [
      '<a href="javascript:alert(1)">x</a>',
      '<a href="JaVaScRiPt:alert(1)">x</a>',
      '<a href="java\tscript:alert(1)">x</a>',
      '<a href="&#106;avascript:alert(1)">x</a>',
      '<a href="data:text/html;base64,AAAA">x</a>',
      '<a href="vbscript:x">x</a>',
      '<a href="http://insecure.test">x</a>',
      '<a href="/relative">x</a>',
      '<a href="//proto.test">x</a>',
      "<a>no href</a>",
      '<a href="https://ok.test" onclick="x">x</a>',
      '<a href="https://ok.test" target="_blank">x</a>',
      '<a href="https://ok.test" rel="opener">x</a>',
      "<a href='https://ok.test'>single quotes</a>",
      '<a href="https://ok.test" href="javascript:x">dup</a>',
      '<a href="​javascript:alert(1)">x</a>',
    ]) {
      reject(html);
    }
  });

  it("rejects attributes on closing tags", () => {
    reject('<p>x</p onclick="y">');
  });
});

import fixtures from "./backend-render.fixture.json";

describe("the real backend renderer's output (generated from PolicyMarkdownRenderer, B8-2)", () => {
  it("every rendering of a broad Markdown corpus passes the storefront allowlist", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
    for (const { markdown, html } of fixtures) {
      expect(() => assertSafePolicyHtml(html), markdown).not.toThrow();
    }
  });

  it("the hostile inputs rendered no active content in the first place", () => {
    const hostile = fixtures.map((f) => f.html).join("\n");
    expect(hostile).not.toMatch(/<script|<img|<div|onerror|href="javascript/i);
  });
});

const REL = 'rel="noopener nofollow ugc"';

describe("duplicate and mixed-case attributes (Codex P2)", () => {
  it("rejects duplicate attribute names regardless of order, case or value — a browser keeps the first one", () => {
    for (const html of [
      // malicious value first, safe value second: a last-wins map would validate the safe one
      `<a href="javascript:alert(1)" href="https://ok.test" ${REL}>x</a>`,
      `<a href="https://ok.test" href="javascript:alert(1)" ${REL}>x</a>`,
      `<a href="https://ok.test" HREF="https://ok.test" ${REL}>x</a>`,
      `<a HREF="javascript:alert(1)" href="https://ok.test" ${REL}>x</a>`,
      `<a Href="vbscript:x" hReF="https://ok.test" ${REL}>x</a>`,
      `<a href="https://ok.test" href="https://ok.test" ${REL}>x</a>`,
      `<a href="https://ok.test" rel="noopener nofollow ugc" rel="noopener nofollow ugc">x</a>`,
      `<a href="https://ok.test" ${REL} REL="opener">x</a>`,
      `<a href="https://ok.test" ${REL} rel="noopener nofollow ugc"  href="data:text/html;base64,AAAA">x</a>`,
      `<a href="&#106;avascript:alert(1)" href="https://ok.test" ${REL}>x</a>`,
    ]) {
      reject(html);
    }
  });

  it("treats attribute names case-insensitively for the allowlist too", () => {
    for (const html of [
      `<a href="https://ok.test" ONCLICK="alert(1)" ${REL}>x</a>`,
      `<a href="https://ok.test" OnMouseOver="alert(1)" ${REL}>x</a>`,
      `<a HREF="https://ok.test" TARGET="_blank" ${REL}>x</a>`,
      `<a href="https://ok.test" STYLE="x:y" ${REL}>x</a>`,
      `<p CLASS="a">x</p>`,
    ]) {
      reject(html);
    }
    // a single, safe, differently-cased name is the same attribute and stays valid
    expect(() =>
      assertSafePolicyHtml(
        `<a HREF="https://ok.test" REL="noopener nofollow ugc">x</a>`,
      ),
    ).not.toThrow();
  });

  it("still rejects every unsafe protocol, in any case and encoding, with a single href", () => {
    for (const href of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      "java&#x09;script:alert(1)",
      "&#106;avascript:alert(1)",
      "&#x6A;avascript:alert(1)",
      "&Tab;javascript:alert(1)",
      "jav&amp;ascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "blob:https://ok.test/x",
      "http://insecure.test",
      "//proto.test",
      "/relative",
    ]) {
      reject(`<a href="${href}" ${REL}>x</a>`);
    }
  });

  it("keeps accepting valid entity use: &amp; in a query string", () => {
    expect(() =>
      assertSafePolicyHtml(
        `<a href="https://ok.test/?a=1&amp;b=2" ${REL}>x</a>`,
      ),
    ).not.toThrow();
    reject(`<a href="https://ok.test/?a=1&b=2" ${REL}>x</a>`);
    reject(`<a href="https://ok.test/?a=1&lt;b" ${REL}>x</a>`);
  });
});

describe("href length is measured on the decoded URL, like Laravel (Codex P2)", () => {
  const href = (decoded: string) => decoded.replaceAll("&", "&amp;");
  const anchor = (decoded: string) => `<a href="${href(decoded)}" ${REL}>x</a>`;
  const withAmpersands = (length: number) => {
    const base = "https://a.test/?";
    let url = base;
    let i = 0;
    while (url.length < length) url += `${i++ === 0 ? "" : "&"}k${i}=v`;
    return `${url.slice(0, length - 1)}x`.padEnd(length, "x");
  };

  it("accepts a 2048-character decoded URL whose serialized form is far longer", () => {
    const decoded = withAmpersands(2048);
    expect(Array.from(decoded)).toHaveLength(2048);
    expect(decoded.split("&").length).toBeGreaterThan(100);
    expect(href(decoded).length).toBeGreaterThan(2048);
    expect(() => assertSafePolicyHtml(anchor(decoded))).not.toThrow();
  });

  it("rejects a decoded URL of 2049 characters, however it is serialized", () => {
    reject(anchor(withAmpersands(2049)));
    reject(anchor(`https://a.test/${"x".repeat(2049 - 15)}`));
    expect(() =>
      assertSafePolicyHtml(anchor(`https://a.test/${"x".repeat(2048 - 15)}`)),
    ).not.toThrow();
  });

  it("counts code points, not UTF-16 units (an astral character is one)", () => {
    const astral = `https://a.test/${"\u{1F600}".repeat(2048 - 15)}`;
    expect(Array.from(astral)).toHaveLength(2048);
    expect(() => assertSafePolicyHtml(anchor(astral))).not.toThrow();
    reject(anchor(`${astral}\u{1F600}`));
  });
});

describe("long URLs rendered by the real PolicyMarkdownRenderer (Laravel contract)", () => {
  const find = (label: string) => {
    const fixture = fixtures.find((f) => f.markdown.startsWith(`[${label}]`));
    if (!fixture) throw new Error(`missing fixture ${label}`);
    return fixture;
  };

  it("a 2048-character URL with ~300 ampersands is linked by Laravel and accepted by the storefront", () => {
    const { html } = find("at limit");
    const serialized = /href="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(serialized.replaceAll("&amp;", "&")).toHaveLength(2048);
    expect(serialized.length).toBeGreaterThan(3000);
    expect(() => assertSafePolicyHtml(html)).not.toThrow();
  });

  it("a well-inside URL passes, and a 2049-character URL is not linked by Laravel at all", () => {
    expect(() => assertSafePolicyHtml(find("well inside").html)).not.toThrow();
    const over = find("over limit").html;
    expect(over).not.toContain("<a ");
    expect(() => assertSafePolicyHtml(over)).not.toThrow();
  });

  it("the same backend HTML with one character appended to the URL is refused", () => {
    const { html } = find("at limit");
    const tampered = html.replace(/(href="[^"]*)"/, '$1x"');
    expect(tampered).not.toBe(html);
    reject(tampered);
  });
});
