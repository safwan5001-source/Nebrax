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

export function PolicyMarkdownPreview({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
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
      !QUOTE.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i++;
    }
    const inline = renderInline(para.join(" "), key);
    if (inline.length > 0) blocks.push(<p key={key}>{inline}</p>);
  }
  return <div data-testid="policy-preview">{blocks}</div>;
}
