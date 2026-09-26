/**
 * Compact official marks. The bytes under `/brand/social` are unmodified
 * first-party files. Do not redraw, recolor, or substitute an icon pack.
 *
 * whatsapp  — WhatsApp Brand Resource Center `Digital_Glyph_Green_RGB_2026.svg`
 * instagram — Instagram brand pack `Instagram_Glyph_White.svg` (dark-footer variant)
 * x         — X Brand Toolkit `x-logo.zip` `logo.svg` (official white)
 * tiktok    — TikTok developer `logo-pack.zip` `TikTok_Icon_Black_Circle.png`
 * snapchat  — Snapchat Support official Ghost `Ghost Logo - Primary.svg` (white)
 * youtube   — YouTube Brand Resource Center `youtube-icon.zip` red digital icon
 * linkedin  — LinkedIn brand downloads `in-logo.zip` `LI-In-Bug.png`
 * facebook  — Facebook Brand Asset Pack `Facebook_Logo_Primary.png`
 *
 * Storefront and web each keep a byte-identical copy because they are
 * separate Next.js apps with no shared static root.
 */

export const OFFICIAL_SOCIAL_MARKS = {
  instagram: {
    src: "/brand/social/instagram.svg",
    width: 1000,
    height: 1000,
  },
  x: { src: "/brand/social/x.svg", width: 1200, height: 1227 },
  tiktok: { src: "/brand/social/tiktok.png", width: 1200, height: 1200 },
  snapchat: { src: "/brand/social/snapchat.svg", width: 500, height: 500 },
  youtube: { src: "/brand/social/youtube.png", width: 1255, height: 1075 },
  linkedin: { src: "/brand/social/linkedin.png", width: 635, height: 540 },
  facebook: { src: "/brand/social/facebook.png", width: 2084, height: 2084 },
  whatsapp: { src: "/brand/social/whatsapp.svg", width: 720, height: 720 },
} as const;

export type OfficialSocialNetwork = keyof typeof OFFICIAL_SOCIAL_MARKS;

const OFFICIAL_SOCIAL_NETWORKS = new Set<string>(
  Object.keys(OFFICIAL_SOCIAL_MARKS),
);

export function isOfficialSocialNetwork(
  network: string,
): network is OfficialSocialNetwork {
  return OFFICIAL_SOCIAL_NETWORKS.has(network);
}

/** Fail closed: unknown names never resolve to a mark. */
export function officialSocialMarkSrc(network: string): string | null {
  return isOfficialSocialNetwork(network)
    ? OFFICIAL_SOCIAL_MARKS[network].src
    : null;
}

const MARK_SIZE_CLASS = {
  row: "h-7 w-auto",
  floating: "h-10 w-auto",
} as const;

export type OfficialSocialMarkSize = keyof typeof MARK_SIZE_CLASS;

/**
 * 44px hit area. The artwork keeps its own aspect ratio inside it.
 * White focus ring stays visible on the dark footer.
 */
export const officialSocialLinkClassName =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

export function OfficialSocialMark({
  network,
  size = "row",
}: {
  network: string;
  size?: OfficialSocialMarkSize;
}) {
  if (!isOfficialSocialNetwork(network)) return null;
  const mark = OFFICIAL_SOCIAL_MARKS[network];
  return (
    // Official bytes only. next/image would resize and recompress the mark.
    <img
      src={mark.src}
      width={mark.width}
      height={mark.height}
      alt=""
      aria-hidden="true"
      data-official-social={network}
      className={MARK_SIZE_CLASS[size]}
    />
  );
}
