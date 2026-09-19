/**
 * The homepage's section contract.
 *
 * STORE-UI-2 renders a fixed default order, but it renders it *from this list*
 * rather than from hard-coded JSX order, so STORE-UI-6 can supply a merchant's
 * visibility and ordering choices without rewriting the page. That is the whole
 * seam — deliberately not a page builder: sections stay a closed set of known
 * keys, because an open-ended one would let configuration invent commerce
 * surfaces the storefront has no data for.
 */

export const HOME_SECTION_KEYS = [
  "hero",
  "categories",
  "newArrivals",
  "wholesale",
] as const;

export type HomeSectionKey = (typeof HOME_SECTION_KEYS)[number];

export interface HomeSection {
  key: HomeSectionKey;
  visible: boolean;
}

export const DEFAULT_HOME_SECTIONS: readonly HomeSection[] =
  HOME_SECTION_KEYS.map((key) => ({ key, visible: true }));

/**
 * Narrows a merchant configuration to sections this build actually implements.
 * Unknown keys are dropped rather than rendered, and implemented sections the
 * configuration omits keep their default position at the end, so a stale or
 * partial configuration can never blank the homepage.
 */
export function resolveHomeSections(
  configured?: readonly HomeSection[],
): HomeSection[] {
  if (!configured?.length) return [...DEFAULT_HOME_SECTIONS];

  const known = configured.filter((section) =>
    HOME_SECTION_KEYS.includes(section.key),
  );
  const seen = new Set(known.map((section) => section.key));

  return [
    ...known,
    ...DEFAULT_HOME_SECTIONS.filter((section) => !seen.has(section.key)),
  ];
}
