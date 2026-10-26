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
