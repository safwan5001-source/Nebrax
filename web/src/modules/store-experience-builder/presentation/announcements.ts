/**
 * CUST-HV V3 — Announcement bar (contract: docs/plans/store/CUST-HV-V0-
 * DECISIONS-AND-ARCHITECTURE-CONTRACT.md §12).
 *
 * Twin of `web/src/modules/store-experience-builder/presentation/announcements.ts`
 * and of `StorefrontPresentationNormalizer::normalizeAnnouncements()` +
 * `StorefrontPresentationPublishValidator` (PHP, the authority). The three are
 * held together by `tests/Fixtures/presentation/announcements.json` — normaliser
 * cases, contrast ratios, automatic foreground and window evaluation — so none
 * can drift silently. Keep this file and its web twin byte-identical apart from
 * the two import lines.
 *
 * Everything here is pure: no DOM, no clock (callers pass `nowMs`), no storage.
 */
import { contrastRatio, isSafeHexColor } from "./tokens";
import { sanitizeExternalUrl } from "./urls";

export const ANNOUNCEMENT_MAX_ITEMS = 5;
export const ANNOUNCEMENT_TEXT_MAX = 120;

/**
 * Origin of the curated icon registry (V0 §11.4). V7 extends it; an existing
 * key is never renamed or removed.
 */
export const ANNOUNCEMENT_ICONS = [
  "megaphone",
  "bell",
  "info",
  "tag",
  "percent",
  "truck",
  "gift",
  "clock",
  "star",
  "heart",
  "sparkles",
  "shield-check",
] as const;
export type AnnouncementIconKey = (typeof ANNOUNCEMENT_ICONS)[number];

export const ANNOUNCEMENT_PAGES = [
  "home",
  "product",
  "category",
  "all",
] as const;
export type AnnouncementPageTarget = (typeof ANNOUNCEMENT_PAGES)[number];

export const ANNOUNCEMENT_ROTATE_INTERVALS = [6, 8, 10] as const;
export type AnnouncementRotateInterval =
  (typeof ANNOUNCEMENT_ROTATE_INTERVALS)[number];
export const ANNOUNCEMENT_DEFAULT_ROTATE_INTERVAL = 8;

export const ANNOUNCEMENT_TICKER_SPEEDS = ["slow", "normal", "fast"] as const;
export type AnnouncementTickerSpeed =
  (typeof ANNOUNCEMENT_TICKER_SPEEDS)[number];

export const MIN_TEXT_CONTRAST = 4.5;

/** Solid colour only — palette roles and gradients arrive with V5. */
export interface AnnouncementColour {
  hex: string;
}

export interface Announcement {
  id: string;
  text: string;
  enabled: boolean;
  icon?: AnnouncementIconKey;
  href?: string;
  surface?: {
    background: AnnouncementColour;
    text?: AnnouncementColour;
    link?: AnnouncementColour;
  };
  /** Kept verbatim — a malformed value is rejected at Publish, never dropped. */
  window?: { startsAt?: string; endsAt?: string };
  /** Absent = every eligible page. `all` is normalised away. */
  pages?: Exclude<AnnouncementPageTarget, "all">[];
}

export interface AnnouncementBehaviour {
  rotate?: true;
  rotateInterval?: AnnouncementRotateInterval;
  ticker?: true;
  tickerSpeed?: Exclude<AnnouncementTickerSpeed, "normal">;
  sticky?: true;
  dismissible?: true;
}

export interface AnnouncementsDoc {
  enabled: boolean;
  items: Announcement[];
  behaviour?: AnnouncementBehaviour;
}

// ───────────────────────────── normalisation ─────────────────────────────

const PHP_TRIM_CHARS = new Set([" ", "\t", "\n", "\r", "\0", "\x0B"]);

/** PHP `trim()` — ASCII whitespace and NUL only (JS `trim()` also strips NBSP etc.). */
function phpTrim(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && PHP_TRIM_CHARS.has(value[start])) start += 1;
  while (end > start && PHP_TRIM_CHARS.has(value[end - 1])) end -= 1;
  return value.slice(start, end);
}

/** PHP `mb_substr($s, 0, $n)` — code points, not UTF-16 units. */
function capCodePoints(value: string, max: number): string {
  const points = Array.from(value);
  return points.length > max ? points.slice(0, max).join("") : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * CUST-HV V6c-1 — the optional visibility window shared by announcement items and banners (D-15: one window
 * semantic, no second scheduler). Each edge is kept exactly as the merchant typed it (PHP `trim`, ≤ 40 code
 * points); an edge that is empty or not a string is absent; no edge ⇒ no window. A malformed value is NEVER
 * repaired or dropped here — it is rejected at publish and never read as "no window" (V0 AMEND-7).
 */
export function normalizeWindowEdges(
  raw: unknown,
): { startsAt?: string; endsAt?: string } | undefined {
  if (!isRecord(raw)) return undefined;
  const kept: { startsAt?: string; endsAt?: string } = {};
  for (const edge of ["startsAt", "endsAt"] as const) {
    const value =
      typeof raw[edge] === "string"
        ? capCodePoints(phpTrim(raw[edge] as string), 40)
        : "";
    if (value !== "") kept[edge] = value;
  }
  return kept.startsAt !== undefined || kept.endsAt !== undefined
    ? kept
    : undefined;
}

function safeId(value: unknown, fallback: string): string {
  const text = phpTrim(typeof value === "string" ? value : fallback);
  return /^[a-zA-Z0-9_-]{1,64}$/.test(text) ? text : fallback;
}

const INTERNAL_HREF = /^\/(?!\/)[A-Za-z0-9\-._~!$&()*+,;=:@%/?#[\]]*$/;

/** Internal `/path` or safe https; anything else is dropped. */
export function normalizeAnnouncementHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = phpTrim(value);
  if (href === "" || Array.from(href).length > 240) return null;
  if (href.startsWith("/")) return INTERNAL_HREF.test(href) ? href : null;
  return sanitizeExternalUrl(href);
}

function normalizeSurface(raw: unknown): Announcement["surface"] | undefined {
  if (!isRecord(raw)) return undefined;
  const colour = (value: unknown): AnnouncementColour | null => {
    const hex =
      isRecord(value) && typeof value.hex === "string"
        ? phpTrim(value.hex)
        : "";
    return isSafeHexColor(hex) ? { hex: hex.toLowerCase() } : null;
  };
  const background = colour(raw.background);
  if (!background) return undefined;
  const surface: NonNullable<Announcement["surface"]> = { background };
  const text = colour(raw.text);
  if (text) surface.text = text;
  const link = colour(raw.link);
  if (link) surface.link = link;
  return surface;
}

function normalizeItem(
  raw: Record<string, unknown>,
  index: number,
): Announcement {
  // `\p{Cc}` = the C0 + C1 control characters, exactly PHP's `/\p{Cc}+/u`.
  const flattened = (typeof raw.text === "string" ? raw.text : "").replace(
    /\p{Cc}+/gu,
    " ",
  );
  const item: Announcement = {
    id: safeId(raw.id, `ann-${index}`),
    text: capCodePoints(phpTrim(flattened), ANNOUNCEMENT_TEXT_MAX),
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
  };

  if (
    typeof raw.icon === "string" &&
    (ANNOUNCEMENT_ICONS as readonly string[]).includes(raw.icon)
  ) {
    item.icon = raw.icon as AnnouncementIconKey;
  }

  const href = normalizeAnnouncementHref(raw.href);
  if (href !== null) item.href = href;

  const surface = normalizeSurface(raw.surface);
  if (surface) item.surface = surface;

  const window = normalizeWindowEdges(raw.window);
  if (window) item.window = window;

  if (Array.isArray(raw.pages)) {
    const chosen = new Set<string>();
    for (const page of raw.pages) {
      if (
        typeof page === "string" &&
        (ANNOUNCEMENT_PAGES as readonly string[]).includes(page)
      ) {
        chosen.add(page);
      }
    }
    if (chosen.size > 0 && !chosen.has("all")) {
      item.pages = (["home", "product", "category"] as const).filter((p) =>
        chosen.has(p),
      );
    }
  }

  return item;
}

function normalizeBehaviour(raw: unknown): AnnouncementBehaviour {
  const source = isRecord(raw) ? raw : {};
  const out: AnnouncementBehaviour = {};
  const ticker = source.ticker === true;
  // A ticker excludes rotation — one rule, mirrored in PHP.
  const rotate = !ticker && source.rotate === true;

  if (rotate) {
    out.rotate = true;
    const interval = source.rotateInterval;
    if (
      typeof interval === "number" &&
      (ANNOUNCEMENT_ROTATE_INTERVALS as readonly number[]).includes(interval) &&
      interval !== ANNOUNCEMENT_DEFAULT_ROTATE_INTERVAL
    ) {
      out.rotateInterval = interval as AnnouncementRotateInterval;
    }
  }
  if (ticker) {
    out.ticker = true;
    const speed = source.tickerSpeed;
    if (
      typeof speed === "string" &&
      (ANNOUNCEMENT_TICKER_SPEEDS as readonly string[]).includes(speed) &&
      speed !== "normal"
    ) {
      out.tickerSpeed = speed as Exclude<AnnouncementTickerSpeed, "normal">;
    }
  }
  if (source.sticky === true) out.sticky = true;
  if (source.dismissible === true) out.dismissible = true;
  return out;
}

/**
 * `null` = absent (no bar, no empty entity). Mirrors PHP `normalizeAnnouncements`.
 */
export function normalizeAnnouncements(raw: unknown): AnnouncementsDoc | null {
  if (!isRecord(raw)) return null;

  const items: Announcement[] = [];
  const seen = new Set<string>();
  let index = 0;
  for (const entry of Array.isArray(raw.items) ? raw.items : []) {
    if (!isRecord(entry)) continue;
    const item = normalizeItem(entry, index);
    index += 1;
    if (seen.has(item.id)) continue; // first occurrence wins
    seen.add(item.id);
    items.push(item);
    if (items.length >= ANNOUNCEMENT_MAX_ITEMS) break;
  }

  const behaviour = normalizeBehaviour(raw.behaviour);
  const enabled = raw.enabled === true;
  const hasBehaviour = Object.keys(behaviour).length > 0;
  if (!enabled && items.length === 0 && !hasBehaviour) return null;

  return {
    enabled,
    items,
    ...(hasBehaviour ? { behaviour } : {}),
  };
}

// ─────────────────────────────── windows ───────────────────────────────

const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-](\d{2}):(\d{2}))$/;

/**
 * Strict ISO-8601 instant → epoch ms, or `null` when malformed or when any
 * field would be silently rolled over (`2026-02-31`, `T24:00`, `+25:00`).
 * Same rules as `StorefrontPresentationPublishValidator`.
 */
export function parseAnnouncementInstant(value: string): number | null {
  const m = ISO_INSTANT.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(
    Number,
  );
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (m[9] !== undefined && (Number(m[9]) > 23 || Number(m[10]) > 59))
    return null;

  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  ) {
    return null;
  }

  const millis =
    m[7] === undefined ? 0 : Number(m[7].padEnd(3, "0").slice(0, 3));
  let utc = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  if (m[8] !== "Z") {
    const sign = m[8].startsWith("-") ? -1 : 1;
    utc -= sign * (Number(m[9]) * 60 + Number(m[10])) * 60_000;
  }
  return utc;
}

export type AnnouncementWindowState =
  | "open"
  | "scheduled"
  | "expired"
  | "invalid";

/**
 * `startsAt` inclusive, `endsAt` exclusive. A malformed or inverted window is
 * `invalid` and never eligible — it is not read as "no window" (V0 AMEND-7).
 */
export function announcementWindowState(
  window: Announcement["window"] | null | undefined,
  nowMs: number,
): AnnouncementWindowState {
  if (!window) return "open";
  const start =
    window.startsAt === undefined
      ? null
      : parseAnnouncementInstant(window.startsAt);
  const end =
    window.endsAt === undefined
      ? null
      : parseAnnouncementInstant(window.endsAt);
  if (window.startsAt !== undefined && start === null) return "invalid";
  if (window.endsAt !== undefined && end === null) return "invalid";
  if (start !== null && end !== null && end <= start) return "invalid";
  if (start !== null && nowMs < start) return "scheduled";
  if (end !== null && nowMs >= end) return "expired";
  return "open";
}

// ──────────────────────────── page targeting ────────────────────────────

/** What kind of storefront page a path is — `null` means never show a bar. */
export type AnnouncementPageKind = "home" | "product" | "category" | "other";

/**
 * Classifies a pathname relative to the storefront base path. Fail-closed:
 * anything not on the allow-list (cart, checkout, account, auth, unknown) is
 * `null` — an announcement never appears there, whatever `pages` says.
 */
export function announcementPageKind(
  pathname: string,
  basePath: string,
): AnnouncementPageKind | null {
  const base = basePath.replace(/\/+$/, "");
  if (base !== "" && pathname !== base && !pathname.startsWith(`${base}/`))
    return null;
  const rest = pathname.slice(base.length).replace(/\/+$/, "");
  if (rest === "") return "home";
  const segments = rest.split("/").filter(Boolean);
  switch (segments[0]) {
    case "products":
      return segments.length === 1
        ? "other"
        : segments.length === 2
          ? "product"
          : null;
    case "c":
      return segments.length >= 2 ? "category" : null;
    case "policies":
    case "wholesale":
      return "other";
    default:
      return null;
  }
}

export function announcementTargetsPage(
  item: Pick<Announcement, "pages">,
  kind: AnnouncementPageKind | null,
): boolean {
  if (kind === null) return false;
  if (!item.pages || item.pages.length === 0) return true; // absent = all eligible pages
  return kind !== "other" && item.pages.includes(kind);
}

export function eligibleAnnouncements(
  doc: AnnouncementsDoc | null | undefined,
  kind: AnnouncementPageKind | null,
  nowMs: number,
): Announcement[] {
  if (!doc?.enabled) return [];
  return doc.items.filter(
    (item) =>
      item.enabled &&
      item.text.trim() !== "" &&
      announcementWindowState(item.window, nowMs) === "open" &&
      announcementTargetsPage(item, kind),
  );
}

/** Next instant (ms) at which eligibility of any item may change, or `null`. */
export function nextAnnouncementBoundary(
  doc: AnnouncementsDoc | null | undefined,
  nowMs: number,
): number | null {
  if (!doc) return null;
  let next: number | null = null;
  for (const item of doc.items) {
    for (const edge of [item.window?.startsAt, item.window?.endsAt]) {
      const at = edge === undefined ? null : parseAnnouncementInstant(edge);
      if (at !== null && at > nowMs && (next === null || at < next)) next = at;
    }
  }
  return next;
}

// ───────────────────────────── contrast ─────────────────────────────
// `contrastRatio` / `relativeLuminance` are the shared WCAG helpers in tokens.ts.

const AUTO_LIGHT = "#ffffff";
const AUTO_DARK = "#000000";

/**
 * Whichever of white / pure black has the higher contrast (ties → white). Pure
 * black on purpose: the better of the two is ≥ 4.58:1 on ANY opaque colour,
 * whereas a near-black like #111827 falls to ≈ 4.40:1 on mid-tones.
 */
export function autoForeground(backgroundHex: string): string {
  return contrastRatio(AUTO_LIGHT, backgroundHex) >=
    contrastRatio(AUTO_DARK, backgroundHex)
    ? AUTO_LIGHT
    : AUTO_DARK;
}

export interface ResolvedAnnouncementSurface {
  background: string;
  foreground: string;
  link: string;
  /** `true` when the merchant chose a colour pair the contract cannot publish. */
  failsContrast: boolean;
}

/**
 * The bar's colours. No custom background ⇒ `null` (theme tokens apply — the
 * existing, already-accessible surface). A custom background always gets a
 * provably readable text: the merchant's choice if it passes 4.5:1, otherwise
 * the automatic foreground (the editor and Publish still flag the bad pair).
 */
export function resolveAnnouncementSurface(
  surface: Announcement["surface"] | undefined,
): ResolvedAnnouncementSurface | null {
  if (!surface) return null;
  const background = surface.background.hex;
  const auto = autoForeground(background);
  const pick = (
    chosen: AnnouncementColour | undefined,
    fallback: string,
  ): [string, boolean] => {
    if (!chosen) return [fallback, false];
    return contrastRatio(chosen.hex, background) >= MIN_TEXT_CONTRAST
      ? [chosen.hex, false]
      : [auto, true];
  };
  const [foreground, textBad] = pick(surface.text, auto);
  const [link, linkBad] = pick(surface.link, foreground);
  return { background, foreground, link, failsContrast: textBad || linkBad };
}

// ─────────────────────────── dismissal identity ───────────────────────────

/** FNV-1a 32-bit over the parts that make a message "the same message". */
export function announcementContentHash(item: Announcement): string {
  const material = JSON.stringify([
    item.text,
    item.href ?? "",
    item.window?.startsAt ?? "",
    item.window?.endsAt ?? "",
  ]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < material.length; i += 1) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Per browser, per origin, per announcement revision (V0 §12.2) — no user/tenant id. */
export function announcementDismissKey(item: Announcement): string {
  return `awj.ann.${item.id}.${announcementContentHash(item)}`;
}
