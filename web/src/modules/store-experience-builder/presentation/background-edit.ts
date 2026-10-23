import { DEFAULT_STORE_BACKGROUND_COLOR, type StorefrontPresentationConfig } from "./config";
import type { MediaRef } from "./media-ref";
import { resolveRoleHex } from "./palette";
import type { ColorRef, MediaOverlay } from "./section-design";
import type { StorefrontBackground } from "./storefront-background";
import { isSafeHexColor } from "./tokens";

/**
 * P3-A-05 — pure edit rules for the document-level background.
 *
 * `background` (the P3-A-02 contract) overrides the legacy `backgroundColor`, which stays the
 * fallback paint and the colour the contrast gates judge. So the editor keeps one invariant:
 * a *solid* background is always the legacy `backgroundColor` with **no** `background` object,
 * and an advanced one is *added* on top of it. Anything that wants the legacy colour back must
 * therefore also **drop** the object — writing the colour alone would change nothing on screen.
 *
 * Every function returns a whole config (absence cannot be expressed as a partial patch) and
 * never stores a URL, CSS string or resolved media: only normalised enums, colours and `MediaRef`s.
 */
type Config = StorefrontPresentationConfig;

export type BackgroundType = "solid" | "gradient" | "media";

/** A document with no `background` object is the legacy solid colour. */
export function backgroundType(config: Pick<Config, "background">): BackgroundType {
  return config.background?.kind ?? "solid";
}

/** The legacy colour, falling back to the default for a missing or unsafe value. */
export function legacyBackgroundHex(config: Pick<Config, "backgroundColor">): string {
  return isSafeHexColor(config.backgroundColor) ? config.backgroundColor.trim() : DEFAULT_STORE_BACKGROUND_COLOR;
}

type Paint = Pick<Config, "primaryColor" | "accentColor" | "palette">;

function colourHex(ref: ColorRef, paint: Paint): string {
  return "hex" in ref ? ref.hex : resolveRoleHex(ref.role, paint);
}

/** The solid colour to show/seed: the authored solid, else what the legacy field paints. */
export function effectiveSolidHex(config: Pick<Config, "background" | "backgroundColor"> & Paint): string {
  return config.background?.kind === "solid" ? colourHex(config.background.color, config) : legacyBackgroundHex(config);
}

function withoutBackground(config: Config): Config {
  const next = { ...config };
  delete next.background;
  return next;
}

/** Solid = the legacy colour, with any advanced `background` dropped. An unsafe value is a no-op. */
export function setSolidColor(config: Config, hex: string): Config {
  if (!isSafeHexColor(hex)) return config;
  return { ...withoutBackground(config), backgroundColor: hex.trim() };
}

/**
 * Restore the default: the default colour and **no** advanced background object. This is not the
 * same as switching type — a type switch keeps the colour you had; this returns to the product default.
 */
export function resetBackground(config: Config): Config {
  return { ...withoutBackground(config), backgroundColor: DEFAULT_STORE_BACKGROUND_COLOR };
}

export function isBackgroundDefault(config: Config): boolean {
  return config.background === undefined && legacyBackgroundHex(config).toLowerCase() === DEFAULT_STORE_BACKGROUND_COLOR;
}

/** Colour the new type starts from, so a switch looks continuous rather than jumping to a preset. */
function seedHex(config: Config): string {
  return config.background?.kind === "gradient" ? colourHex(config.background.from, config) : effectiveSolidHex(config);
}

/** `from` blended `amount` of the way towards `to`; both are validated 6-digit hex. */
function mixHex(from: string, to: string, amount: number): string {
  const channel = (hex: string, at: number) => Number.parseInt(hex.slice(1 + at * 2, 3 + at * 2), 16);
  return `#${[0, 1, 2]
    .map((at) => Math.round(channel(from, at) * (1 - amount) + channel(to, at) * amount).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * A new gradient must be *visible* at once (a flat one reads as "nothing happened") yet stay light enough to pass the publish
 * contrast policy (P3-A-06) from a light page colour: at 4 % the far end keeps the secondary page text above 4.5:1 (12 % did not).
 */
const GRADIENT_SEED_TINT = 0.04;

/** Switch to Solid or Gradient. Image needs a picked asset first, so it is a UI state, not a document edit. */
export function switchBackgroundType(config: Config, type: "solid" | "gradient"): Config {
  if (backgroundType(config) === type) return config;
  const seed = seedHex(config);
  if (type === "solid") return setSolidColor(config, seed);
  const tint = isSafeHexColor(config.primaryColor) ? mixHex(seed, config.primaryColor.trim(), GRADIENT_SEED_TINT) : seed;
  return {
    ...config,
    background: {
      kind: "gradient",
      from: { hex: seed.toLowerCase() },
      to: { hex: tint.toLowerCase() },
      direction: "to-bottom",
    },
  };
}

type Gradient = Extract<StorefrontBackground, { kind: "gradient" }>;

/** Edit the current gradient. A no-op unless the document is already a gradient. */
export function setGradient(config: Config, next: Partial<Pick<Gradient, "from" | "to" | "direction">>): Config {
  const current = config.background;
  if (current?.kind !== "gradient") return config;
  return { ...config, background: { ...current, ...next } };
}

type Media = Extract<StorefrontBackground, { kind: "media" }>;

/** `undefined` leaves a part alone; `null` clears it. */
export interface MediaBackgroundEdit {
  media?: MediaRef | null;
  mobile?: MediaRef | null;
  overlay?: MediaOverlay | null;
}

const decorative = (ref: MediaRef): MediaRef => ({ ...ref, decorative: true });

/**
 * Edit the image background. A global background picture is decoration by contract. Clearing the
 * desktop image removes the whole object (a phone image or overlay without a base image is
 * meaningless) so the page falls back to the legacy colour; the caller keeps the Image tab open.
 */
export function setMediaBackground(config: Config, edit: MediaBackgroundEdit): Config {
  const current = config.background?.kind === "media" ? config.background : null;
  const media = edit.media === undefined ? current?.media : edit.media;
  if (!media) return withoutBackground(config);
  const mobile = edit.mobile === undefined ? current?.mobile : edit.mobile;
  const overlay = edit.overlay === undefined ? current?.overlay : edit.overlay;
  const background: Media = {
    kind: "media",
    media: decorative(media),
    ...(mobile ? { mobile: decorative(mobile) } : {}),
    ...(overlay ? { overlay } : {}),
  };
  return { ...config, background };
}

/** A centred focal point is the default and is never stored (the contract compares equal without it). */
export function withFocal(ref: MediaRef, point: { x: number; y: number }): MediaRef {
  const next = { ...ref };
  if (point.x === 50 && point.y === 50) delete next.focal;
  else next.focal = { x: point.x, y: point.y };
  return next;
}
