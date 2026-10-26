/**
 * X4 — defense in depth for policy HTML. The AWJ backend already returns sanitized HTML (B8-2: CommonMark
 * with raw HTML stripped + a DOM allowlist). The storefront still refuses to inject anything that does not
 * match that same allowlist exactly, so a compromised or misconfigured upstream can never become stored XSS.
 *
 * Fail closed: any tag, attribute or URL outside the allowlist throws (the caller treats the page as
 * unavailable rather than rendering a "cleaned" variant it cannot vouch for). No dependency, no DOM.
 */

const ALLOWED_TAGS = new Set([
  "h2",
  "h3",
  "h4",
  "p",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "a",
  "br",
  "blockquote",
]);

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\s*(\/?)>/g;
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"<>]*)"/g;
const SAFE_SCHEMES = ["https:", "mailto:", "tel:"];

export class UnsafePolicyHtmlError extends Error {
  constructor(reason: string) {
    super(`Unsafe policy HTML: ${reason}`);
    this.name = "UnsafePolicyHtmlError";
  }
}

// Control/invisible characters and character references are how schemes get disguised; the only reference the
// backend emits in an href is `&amp;` (query strings), and the scheme is checked on the raw text.
const DISGUISED_HREF =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejects control chars used to disguise schemes
  /[\u0000-\u0020\u007F\u00A0\u200B-\u200D\u2028\u2029\uFEFF]/;
/** The only entity the backend emits inside an href (CommonMark escapes `&` in link destinations). */
const BARE_AMPERSAND = /&(?!amp;)/;

/** Laravel's `PolicyMarkdownRenderer::safeHref` limit: the DECODED URL, in code points (`mb_strlen`). */
const MAX_HREF_CHARS = 2048;

function assertSafeHref(href: string): void {
  if (DISGUISED_HREF.test(href) || BARE_AMPERSAND.test(href)) {
    throw new UnsafePolicyHtmlError("disguised href");
  }
  const scheme = /^([a-z][a-z0-9+.-]*:)/i.exec(href)?.[1].toLowerCase();
  if (!scheme || !SAFE_SCHEMES.includes(scheme)) {
    throw new UnsafePolicyHtmlError("href scheme");
  }
  // `&amp;` is the serialization of one `&` — measure what the browser (and Laravel) see, not the markup.
  if (Array.from(href.replaceAll("&amp;", "&")).length > MAX_HREF_CHARS) {
    throw new UnsafePolicyHtmlError("href length");
  }
}

export function assertSafePolicyHtml(html: string): void {
  // Every `<` must open an allowlisted tag; text `<`/`>` arrive escaped (`&lt;`) from the backend.
  const withoutTags = html.replace(TAG, "");
  if (/[<>]/.test(withoutTags)) {
    throw new UnsafePolicyHtmlError("stray angle bracket");
  }

  for (const match of html.matchAll(TAG)) {
    const [, closing, rawName, rawAttrs] = match;
    const name = rawName.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) {
      throw new UnsafePolicyHtmlError(`tag <${name}>`);
    }
    if (closing) {
      if (rawAttrs.trim() !== "")
        throw new UnsafePolicyHtmlError("closing tag attributes");
      continue;
    }
    const attrs = rawAttrs.trim();
    if (name !== "a") {
      if (attrs !== "")
        throw new UnsafePolicyHtmlError(`attributes on <${name}>`);
      continue;
    }
    // The backend unwraps an anchor with no safe href, so an attribute-less <a> never legitimately arrives.
    if (attrs === "") throw new UnsafePolicyHtmlError("anchor without href");

    const seen = new Map<string, string>();
    let duplicated: string | null = null;
    const leftover = attrs.replace(ATTR, (_all, key: string, value: string) => {
      const lower = key.toLowerCase();
      // HTML attribute names are case-insensitive and a browser keeps the FIRST duplicate, while a
      // last-wins map would validate a different value than the one that executes — so refuse duplicates.
      if (seen.has(lower)) duplicated = lower;
      seen.set(lower, value);
      return "";
    });
    if (duplicated !== null) {
      throw new UnsafePolicyHtmlError(`duplicate attribute ${duplicated}`);
    }
    if (leftover.trim() !== "")
      throw new UnsafePolicyHtmlError("malformed attributes");
    for (const key of seen.keys()) {
      if (key !== "href" && key !== "rel")
        throw new UnsafePolicyHtmlError(`attribute ${key}`);
    }
    const href = seen.get("href");
    if (href === undefined)
      throw new UnsafePolicyHtmlError("anchor without href");
    assertSafeHref(href);
    const rel = seen.get("rel");
    if (rel !== undefined && rel !== "noopener nofollow ugc") {
      throw new UnsafePolicyHtmlError("rel");
    }
  }
}
