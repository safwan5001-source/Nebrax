/**
 * AWJ-STORE-CAT-DESIGN-01 — backend-free fixture categories for the dev-only visual harness.
 *
 * Pictures are generated locally as SVG data URIs (no network, no stored asset): each has a different aspect ratio and an
 * off-centre subject plus a frame at its very edge, so `cover` vs `contain`, the picture position and the shape mask are
 * all visibly different. Two categories have no picture on purpose (one with a merchant colour) to show the fallback frame.
 * Twin of `web/src/app/dev/customizer-visual/category-fixtures.ts`.
 */

const PALETTE: Array<[string, string, string]> = [
  ["#0f766e", "#5eead4", "#134e4a"],
  ["#b45309", "#fcd34d", "#78350f"],
  ["#4338ca", "#a5b4fc", "#312e81"],
  ["#be123c", "#fda4af", "#881337"],
  ["#15803d", "#86efac", "#14532d"],
  ["#0369a1", "#7dd3fc", "#0c4a6e"],
];

/** A deterministic, text-free SVG picture of the given pixel size, as a data URI. */
export function fixturePicture(
  seed: number,
  width: number,
  height: number,
): string {
  const [from, to, ink] = PALETTE[seed % PALETTE.length];
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`,
    `<rect width="${width}" height="${height}" fill="url(#g)"/>`,
    // off-centre subject near the start/top corner, so position and cropping are visible
    `<circle cx="${width * 0.28}" cy="${height * 0.34}" r="${Math.min(width, height) * 0.2}" fill="${ink}" opacity="0.85"/>`,
    `<polygon points="${width * 0.55},${height * 0.9} ${width * 0.8},${height * 0.45} ${width * 0.98},${height * 0.9}" fill="${ink}" opacity="0.6"/>`,
    // frame at the very edge: shows letterboxing under `contain`
    `<rect x="3" y="3" width="${width - 6}" height="${height - 6}" fill="none" stroke="${ink}" stroke-width="6"/>`,
    `</svg>`,
  ].join("");
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export interface FixtureCategory {
  id: string;
  name: string;
  permalink: string;
  color: string | null;
  image: { url: string; alt: string } | null;
}

const NAMES: Array<[string, string]> = [
  ["إلكترونيات", "Electronics"],
  ["المنزل والحديقة", "Home & Garden"],
  ["ملابس", "Fashion"],
  [
    "مستلزمات الأطفال والرضّع والألعاب التعليمية الحديثة",
    "Baby, kids & modern educational toys and accessories",
  ],
  ["رياضة", "Sports"],
  ["عناية", "Care"],
  ["أدوات مكتبية", "Office"],
  ["سيارات", "Auto"],
];

/** `noImage`: indexes drawn without a picture. `count`: how many categories (0-8). */
export function fixtureCategories(
  locale: "ar" | "en",
  count = 8,
  noImage: number[] = [5, 6],
): FixtureCategory[] {
  const sizes: Array<[number, number]> = [
    [600, 400],
    [400, 600],
    [500, 500],
    [720, 360],
    [360, 720],
    [600, 450],
    [640, 360],
    [450, 600],
  ];
  return NAMES.slice(0, count).map(([ar, en], index) => {
    const [w, h] = sizes[index % sizes.length];
    return {
      id: `fx-${index}`,
      name: locale === "ar" ? ar : en,
      permalink: `fx-${index}`,
      color: index === 5 ? "#0f766e" : null,
      image: noImage.includes(index)
        ? null
        : { url: fixturePicture(index, w, h), alt: "" },
    };
  });
}
