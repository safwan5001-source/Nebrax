import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';

/**
 * Bundled IBM Plex (OFL) — no network at render. Arabic and Latin subsets are split
 * by unicode-range exactly like the product's next/font setup.
 */
const ARABIC_RANGE =
  'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC';
const LATIN_RANGE =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

const faces: FontFace[] = [];

for (const w of [300, 400, 500, 600, 700]) {
  faces.push(
    new FontFace('IBM Plex Sans Arabic', `url(${staticFile(`fonts/ibm-plex-sans-arabic-arabic-${w}-normal.woff2`)})`, {
      weight: String(w),
      unicodeRange: ARABIC_RANGE,
    }),
    new FontFace('IBM Plex Sans Arabic', `url(${staticFile(`fonts/ibm-plex-sans-arabic-latin-${w}-normal.woff2`)})`, {
      weight: String(w),
      unicodeRange: LATIN_RANGE,
    }),
  );
}
for (const w of [400, 500, 600, 700]) {
  faces.push(
    new FontFace('IBM Plex Mono', `url(${staticFile(`fonts/ibm-plex-mono-latin-${w}-normal.woff2`)})`, {
      weight: String(w),
    }),
  );
}

const handle = delayRender('Loading bundled IBM Plex fonts');
Promise.all(faces.map((face) => face.load()))
  .then((loaded) => {
    loaded.forEach((face) => document.fonts.add(face));
    continueRender(handle);
  })
  .catch((err) => cancelRender(err));
