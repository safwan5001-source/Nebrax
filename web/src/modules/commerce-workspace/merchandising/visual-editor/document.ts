/**
 * AWJ-VD-H1 / VD-3 — the editor's draft of a facet identity: pure functions, no React.
 *
 * The draft is a plain `{own, defaults}` pair. For a **value**, `own` is the value's document and `defaults` is unused.
 * For a **dimension**, `own` is `self` (the dimension's own appearance) and `defaults` is what its values inherit.
 * Everything the server stores goes through the shared normaliser (the same twin the storefront and PHP use), so the
 * payload is canonical, "dirty" is a comparison of canonical documents, and a draft that only differs by an empty key
 * is not a change.
 *
 * Inheritance is never recomputed here: the badges ask the same resolver the storefront runs
 * (`resolveFacetValueVisual(...).sources`), so «inherited from the dimension» cannot drift from what shoppers see.
 */

import {
  FACET_VISUAL_DEFAULTS,
  type FacetValueVisual,
  type FacetVisual,
  type FacetVisualContent,
  type FacetVisualDefaults,
  type FacetVisualImage,
  type FacetVisualSource,
  normalizeFacetValueVisual,
  normalizeFacetVisual,
  resolveFacetValueVisual,
} from '@/modules/store-experience-builder/presentation/facet-visual';

export type EditorKind = 'facet' | 'value';
/** `own` = the value itself / the dimension's `self`; `defaults` = what a dimension's values inherit. */
export type Scope = 'own' | 'defaults';

export interface VisualDraft {
  own: FacetValueVisual;
  defaults: FacetVisualDefaults;
}

export const EMPTY_DRAFT: VisualDraft = { own: {}, defaults: {} };

/** The draft the editor opens with, from the stored (already normalised) document. */
export function draftFromStored(kind: EditorKind, stored: FacetVisual | FacetValueVisual | null | undefined): VisualDraft {
  if (kind === 'value') return { own: normalizeFacetValueVisual(stored ?? {}), defaults: {} };
  const facet = normalizeFacetVisual(stored ?? {});
  return { own: facet.self ?? {}, defaults: facet.defaults ?? {} };
}

/** The canonical document a draft stands for (`{}` = nothing customised). */
export function documentOf(kind: EditorKind, draft: VisualDraft): FacetVisual | FacetValueVisual {
  return kind === 'value'
    ? normalizeFacetValueVisual(draft.own)
    : normalizeFacetVisual({ self: draft.own, defaults: draft.defaults });
}

export function isEmptyDocument(doc: object): boolean {
  return Object.keys(doc).length === 0;
}

/** What to PUT: the canonical document, or `null` (the API's tombstone) when nothing is customised any more. */
export function payloadOf(kind: EditorKind, draft: VisualDraft): FacetVisual | FacetValueVisual | null {
  const doc = documentOf(kind, draft);
  return isEmptyDocument(doc) ? null : doc;
}

export function sameVisual(kind: EditorKind, a: VisualDraft, b: VisualDraft): boolean {
  return JSON.stringify(documentOf(kind, a)) === JSON.stringify(documentOf(kind, b));
}

// ───────────────────────────── immutable edits ─────────────────────────────

type AnyKey = keyof FacetValueVisual | keyof FacetVisualDefaults;

/** Sets one property of the draft; `undefined` removes the key, which means «inherit». */
export function setProp(draft: VisualDraft, scope: Scope, key: AnyKey, value: unknown): VisualDraft {
  const next = { ...(draft[scope] as Record<string, unknown>) };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return { ...draft, [scope]: next } as VisualDraft;
}

/** Replaces (or removes, with `null`) the image of `own`. Never touches any other property (D-08). */
export function setImage(draft: VisualDraft, image: FacetVisualImage | null): VisualDraft {
  return setProp(draft, 'own', 'image', image ?? undefined);
}

const CENTRE = 50;

/** Edits one framing property of the existing image. No image, no edit. Defaults (centred, 1×) are not stored. */
export function setFraming(
  draft: VisualDraft,
  patch: { fit?: 'cover' | 'contain' | null; focal?: { x: number; y: number } | null; zoom?: number | null },
): VisualDraft {
  const image = draft.own.image;
  if (!image) return draft;
  const next: FacetVisualImage = { ...image };
  if ('fit' in patch) {
    if (patch.fit) next.fit = patch.fit;
    else delete next.fit;
  }
  if ('focal' in patch) {
    const focal = patch.focal;
    if (focal && !(focal.x === CENTRE && focal.y === CENTRE)) next.focal = { x: focal.x, y: focal.y };
    else delete next.focal;
  }
  if ('zoom' in patch) {
    const zoom = patch.zoom;
    if (typeof zoom === 'number' && zoom > 1) next.zoom = Math.round(zoom * 100) / 100;
    else delete next.zoom;
  }
  return setImage(draft, next);
}

// ───────────────────────────── content type ─────────────────────────────

export type ContentChoice = 'inherit' | 'image' | 'icon' | 'none';

/** Which document a content-type group edits: it decides what an unset content means. */
export type ContentMode = 'value' | 'self' | 'defaults';

/**
 * The option the content-type group shows as selected: the explicit choice, else what the media implies (a value or a
 * dimension's own appearance with an image or icon of its own implies that content; a dimension's *defaults* imply
 * nothing — they carry no image and an icon alone does not switch a value's content on).
 */
export function choiceOf(doc: FacetValueVisual | FacetVisualDefaults, mode: ContentMode): ContentChoice {
  if (doc.content) return doc.content;
  if (mode !== 'defaults') {
    const own = doc as FacetValueVisual;
    if (own.image) return 'image';
    if (own.icon) return 'icon';
  }
  return mode === 'self' ? 'none' : 'inherit';
}

/**
 * Applies a content-type choice. Choosing image / icon / text-only only sets `content` — a stored image or icon is kept,
 * so flipping back and forth loses nothing and, above all, no other property is touched (D-08). Only «inherit» removes
 * what the value set itself (the content, image and icon), because inheriting means having none of its own. For a
 * dimension's defaults «not set» removes the content only: its icon is an independent default.
 */
export function applyChoice(draft: VisualDraft, scope: Scope, choice: ContentChoice): VisualDraft {
  if (choice === 'inherit') {
    const next = setProp(draft, scope, 'content', undefined);
    if (scope === 'defaults') return next;
    return setProp(setProp(next, scope, 'image', undefined), scope, 'icon', undefined);
  }
  return setProp(draft, scope, 'content', choice satisfies FacetVisualContent);
}

/** True when «inherit» would discard something the value set itself (so the editor says so). */
export function inheritWouldClear(own: FacetValueVisual): boolean {
  return own.image !== undefined || own.icon !== undefined || own.content !== undefined;
}

// ───────────────────────────── inheritance state ─────────────────────────────

export type PropSource = 'own' | 'facet' | 'system';
export type InheritableKey =
  | 'content'
  | 'shape'
  | 'size'
  | 'showLabel'
  | 'fit'
  | 'icon'
  | 'iconColor'
  | 'background';

export interface PropState {
  /** Who decides the effective value: this document, the dimension's defaults, or the system. */
  source: PropSource;
  /** The effective value (`undefined` for an icon / colour nobody set). */
  value: unknown;
}

function sourceOf(source: FacetVisualSource | null): PropSource {
  if (source === 'value' || source === 'implicit') return 'own';
  if (source === 'facet') return 'facet';
  return 'system';
}

/**
 * The state of one property of a **value**, computed by the shared resolver against the dimension's stored defaults.
 * The resolver's `sources` decide the badge; the value shown is the one that source supplies.
 */
export function valuePropState(facetVisual: FacetVisual | null, own: FacetValueVisual, key: InheritableKey): PropState {
  const { visual, sources } = resolveFacetValueVisual(facetVisual ?? {}, own);
  const defaults = normalizeFacetVisual(facetVisual ?? {}).defaults ?? {};
  switch (key) {
    case 'shape':
    case 'size':
    case 'showLabel':
      return { source: sourceOf(sources[key]), value: visual[key] };
    case 'content':
      return { source: sourceOf(sources.content), value: sources.fallback ?? visual.content };
    case 'fit': {
      // `sources.fit` exists only while an image resolves; the editor also shows the badge before one is picked.
      if (own.image?.fit) return { source: 'own', value: own.image.fit };
      if (defaults.fit) return { source: 'facet', value: defaults.fit };
      return { source: 'system', value: FACET_VISUAL_DEFAULTS.fit };
    }
    case 'icon':
    case 'iconColor':
    case 'background': {
      const source = sourceOf(sources[key]);
      return { source, value: source === 'own' ? own[key] : source === 'facet' ? defaults[key] : undefined };
    }
  }
}

/** A property of the dimension's own appearance or of its defaults: it has no parent, only the system default. */
export function scopePropState(draft: VisualDraft, scope: Scope, key: InheritableKey): PropState {
  const doc = draft[scope] as Record<string, unknown>;
  const fitValue = scope === 'own' ? draft.own.image?.fit : draft.defaults.fit;
  const own = key === 'fit' ? fitValue : doc[key];
  if (own !== undefined) return { source: 'own', value: own };
  const system: Partial<Record<InheritableKey, unknown>> = {
    content: FACET_VISUAL_DEFAULTS.content,
    shape: FACET_VISUAL_DEFAULTS.shape,
    size: FACET_VISUAL_DEFAULTS.size,
    showLabel: FACET_VISUAL_DEFAULTS.showLabel,
    fit: FACET_VISUAL_DEFAULTS.fit,
  };
  return { source: 'system', value: system[key] };
}

/** Value shown under «inherit»: the dimension's defaults decide, else the system. */
export function propState(
  kind: EditorKind,
  facetVisual: FacetVisual | null,
  draft: VisualDraft,
  scope: Scope,
  key: InheritableKey,
): PropState {
  return kind === 'value' ? valuePropState(facetVisual, draft.own, key) : scopePropState(draft, scope, key);
}

// ───────────────────────────── server field errors ─────────────────────────────

export type FieldGroup =
  | 'content'
  | 'image'
  | 'icon'
  | 'iconColor'
  | 'background'
  | 'shape'
  | 'size'
  | 'showLabel'
  | 'fit'
  | 'focal'
  | 'zoom';
export type EditorTab = 'data' | 'image' | 'appearance';

const GROUPS: readonly FieldGroup[] = [
  'content',
  'image',
  'icon',
  'iconColor',
  'background',
  'shape',
  'size',
  'showLabel',
  'fit',
  'focal',
  'zoom',
];

export function tabOfGroup(group: FieldGroup): EditorTab {
  return group === 'content' || group === 'image' || group === 'icon' || group === 'iconColor' || group === 'background'
    ? 'image'
    : 'appearance';
}

/** `${scope}:${group}` — the key a control looks its errors up by. */
export const errorKey = (scope: Scope, group: FieldGroup) => `${scope}:${group}`;

export interface IndexedErrors {
  /** Field errors by `${scope}:${group}` → server codes. */
  byField: Record<string, string[]>;
  /** Codes whose field maps to no control (shown with the part's summary instead). */
  unmapped: string[];
}

/**
 * Maps the API's `visual.<path>` errors to editor controls. A value's paths are `visual.image.mediaId`, `visual.shape`…;
 * a dimension's carry `self.` or `defaults.` first (`visual.self.image.mediaId`, `visual.defaults.shape`). The image's own
 * keys other than the framing ones (`mediaId`, `alt`, `decorative`, `crop`, `rotate`) all belong to the image control.
 */
export function indexVisualErrors(kind: EditorKind, errors: Record<string, string[]>): IndexedErrors {
  const out: IndexedErrors = { byField: {}, unmapped: [] };
  for (const [path, codes] of Object.entries(errors)) {
    const segments = path.replace(/^visual\.?/, '').split('.').filter(Boolean);
    let scope: Scope = 'own';
    if (kind === 'facet' && (segments[0] === 'self' || segments[0] === 'defaults')) {
      scope = segments[0] === 'defaults' ? 'defaults' : 'own';
      segments.shift();
    }
    const [head, tail] = segments;
    let group: FieldGroup | null = null;
    if (head === 'image') group = tail === 'fit' ? 'fit' : tail === 'focal' ? 'focal' : tail === 'zoom' ? 'zoom' : 'image';
    else if ((GROUPS as readonly string[]).includes(head ?? '')) group = head as FieldGroup;
    if (group === null) {
      out.unmapped.push(...codes);
      continue;
    }
    (out.byField[errorKey(scope, group)] ??= []).push(...codes);
  }
  return out;
}

/** Tabs that hold at least one mapped field error. */
export function tabsWithErrors(indexed: IndexedErrors): Set<EditorTab> {
  const tabs = new Set<EditorTab>();
  for (const key of Object.keys(indexed.byField)) {
    tabs.add(tabOfGroup(key.split(':')[1] as FieldGroup));
  }
  return tabs;
}
