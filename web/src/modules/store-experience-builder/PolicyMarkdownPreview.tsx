import type { ReactNode } from "react";

/**
 * B8-3 — read-only preview of a policy's Markdown, mirroring the server's approved safe rendering
 * (B8-2): headings h2–h4, paragraphs, lists, blockquotes, bold/italic, and links limited to
 * https/mailto/tel. It builds React elements only — never `dangerouslySetInnerHTML` — so raw HTML
 * is shown nowhere (tags are stripped, as the server does) and images are dropped.
 */
const SAFE_SCHEMES = ["https", "mailto", "tel"];

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips control chars used to disguise schemes
const DISGUISE_CHARS = new RegExp("[\\u0000-\\u0020\\u007F\\u00A0\\u200B-\\u200D\\u2028\\u2029\\uFEFF]+", "g");

export function safePreviewHref(href: string): string | null {
  // control chars, spaces, NBSP and zero-width characters are removed before judging the scheme
  const clean = href.replace(DISGUISE_CHARS, "");
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(clean);
  if (!m || !SAFE_SCHEMES.includes(m[1].toLowerCase())) return null;
  if (clean.length > 2048 || /[<>"'`\\]/.test(clean)) return null;
  return clean;
}

function stripRawHtml(text: string): string {
  return text.replace(/<\/?[a-zA-Z!?][^>]*>?/g, "");
}

const RAW_HTML_BLOCK_START = /^ {0,3}<(?:[a-zA-Z][\w-]*|\/[a-zA-Z][\w-]*|!|\?)/;
const RAW_HTML_VERBATIM = /^ {0,3}<(script|style|pre|textarea)\b/i;

/**
 * CommonMark's `html_input=strip` drops a whole raw-HTML *block* (a line opening with a tag at the start
 * of a block, through the next blank line — or through the closing tag for script/style/pre/textarea).
 * Mirrors that so the preview and the readiness check agree with the server; inline tags are handled by
 * `stripRawHtml`. An approximation of CommonMark's HTML-block rules, not a copy.
 */
function dropHtmlBlocks(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const atBlockStart = i === 0 || lines[i - 1].trim() === "";
    if (atBlockStart && RAW_HTML_BLOCK_START.test(lines[i])) {
      const verbatim = RAW_HTML_VERBATIM.exec(lines[i]);
      if (verbatim) {
        const close = new RegExp(`</${verbatim[1]}>`, "i");
        while (i < lines.length && !close.test(lines[i])) i++;
        i++; // the closing line itself is dropped too
      } else {
        while (i < lines.length && lines[i].trim() !== "") i++;
      }
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out;
}

const INLINE =
  /!\[[^\]]*\]\([^)]*\)|\[([^\]]+)\]\(([^)\s]*)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_/g;

function renderInline(source: string, keyBase: string): ReactNode[] {
  const text = stripRawHtml(source).replace(/\\([\\`*_{}[\]()#+\-.!>])/g, "$1");
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${keyBase}-${n++}`;
    if (m[0].startsWith("![")) {
      // images are not part of the approved subset
    } else if (m[1] !== undefined) {
      const href = safePreviewHref(m[2] ?? "");
      out.push(
        href ? (
          <a key={key} href={href} rel="noopener nofollow ugc" target="_blank">
            {renderInline(m[1], key)}
          </a>
        ) : (
          <span key={key}>{renderInline(m[1], key)}</span>
        ),
      );
    } else if (m[3] !== undefined || m[4] !== undefined) {
      out.push(<strong key={key}>{renderInline(m[3] ?? m[4] ?? "", key)}</strong>);
    } else {
      out.push(<em key={key}>{renderInline(m[5] ?? m[6] ?? "", key)}</em>);
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d{1,9}[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

export function PolicyMarkdownPreview({ markdown }: { markdown: string }) {
  const lines = dropHtmlBlocks(markdown.replace(/\r\n?/g, "\n").split("\n"));
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (HR.test(line)) {
      i++; // thematic breaks are not part of the approved subset (the server drops them too)
      continue;
    }
    const key = `b${k++}`;
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      const Tag = level <= 2 ? "h2" : level === 3 ? "h3" : "h4";
      blocks.push(<Tag key={key}>{renderInline(heading[2], key)}</Tag>);
      i++;
      continue;
    }
    const listMatch = BULLET.test(line) ? BULLET : ORDERED.test(line) ? ORDERED : null;
    if (listMatch) {
      const items: ReactNode[] = [];
      while (i < lines.length && listMatch.test(lines[i])) {
        const text = (listMatch.exec(lines[i]) as RegExpExecArray)[1];
        items.push(<li key={`${key}-${i}`}>{renderInline(text, `${key}-${i}`)}</li>);
        i++;
      }
      blocks.push(listMatch === BULLET ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>);
      continue;
    }
    if (QUOTE.test(line)) {
      const parts: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        parts.push((QUOTE.exec(lines[i]) as RegExpExecArray)[1]);
        i++;
      }
      blocks.push(<blockquote key={key}>{renderInline(parts.join(" "), key)}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !HEADING.test(lines[i]) &&
      !BULLET.test(lines[i]) &&
      !ORDERED.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !HR.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i++;
    }
    const inline = renderInline(para.join(" "), key);
    if (inline.length > 0) blocks.push(<p key={key}>{inline}</p>);
  }
  return <div data-testid="policy-preview">{blocks}</div>;
}

/**
 * True when the safe rendering would show any text — the same notion the server uses (B8-2) to decide a
 * policy is empty: raw HTML, images and thematic breaks contribute nothing, link labels do.
 */
export function markdownHasVisibleText(markdown: string): boolean {
  const text = stripRawHtml(
    dropHtmlBlocks(markdown.replace(/\r\n?/g, "\n").split("\n")).join("\n"),
  )
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)\s]*\)/g, "$1")
    .split("\n")
    .filter((line) => !HR.test(line))
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+/, ""),
    )
    .join("")
    .replace(/[*_\\]/g, "");
  return text.replace(/[\s\u200B-\u200D\u2028\u2029\uFEFF\u00A0]+/g, "") !== "";
}
