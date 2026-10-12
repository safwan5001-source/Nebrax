/**
 * CUST-HV V10d (V0 §17 / V10) — Library thumbnails: a small layout wireframe per section type (what the section looks like, not what it
 * contains). Pure SVG, deterministic, no network and no fake commerce data — no price, product name, picture or count is drawn, so a
 * thumbnail can never be mistaken for a promise about the merchant's store. Colours come from the app's own tokens (`currentColor`
 * with opacity), so it follows light / dark and RTL (the shapes are mirrored with the document direction via `rtl:-scale-x-100`).
 */

import type { HomeBuilderSectionKey } from "./presentation";

const FRAME = <rect x="0.5" y="0.5" width="71" height="47" rx="3" className="fill-surface stroke-border" />;
const SOFT = "fill-current opacity-15";
const MID = "fill-current opacity-35";
const STRONG = "fill-current opacity-70";

function Card({ x, y = 18, w = 12, h = 22 }: { x: number; y?: number; w?: number; h?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="1.5" className={SOFT} />
      <rect x={x + 1.5} y={y + h - 6} width={w - 3} height="1.6" rx="0.8" className={MID} />
      <rect x={x + 1.5} y={y + h - 3.2} width={(w - 3) * 0.6} height="1.6" rx="0.8" className={SOFT} />
    </g>
  );
}

function Heading({ w = 22 }: { w?: number }) {
  return (
    <g>
      <rect x="6" y="7" width="2" height="6" rx="1" className={STRONG} />
      <rect x="10.5" y="8" width={w} height="3.6" rx="1.8" className={MID} />
    </g>
  );
}

function Body({ type }: { type: HomeBuilderSectionKey }) {
  switch (type) {
    case "hero":
      return (
        <g>
          <rect x="5" y="5" width="62" height="38" rx="2" className={SOFT} />
          <rect x="11" y="14" width="30" height="4.5" rx="2.2" className={STRONG} />
          <rect x="11" y="22" width="22" height="2.6" rx="1.3" className={MID} />
          <rect x="11" y="30" width="14" height="5" rx="2.5" className={STRONG} />
        </g>
      );
    case "slider":
      return (
        <g>
          <rect x="5" y="5" width="62" height="34" rx="2" className={SOFT} />
          <rect x="12" y="15" width="26" height="4" rx="2" className={STRONG} />
          <rect x="12" y="22" width="18" height="2.4" rx="1.2" className={MID} />
          <path d="M9 22l-2-2.6v5.2z M63 22l2-2.6v5.2z" className={MID} />
          <circle cx="30" cy="42.5" r="1.4" className={STRONG} />
          <circle cx="36" cy="42.5" r="1.4" className={MID} />
          <circle cx="42" cy="42.5" r="1.4" className={MID} />
        </g>
      );
    case "gallery":
      return (
        <g>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x={6 + i * 21} y="7" width="19" height="16" rx="1.5" className={SOFT} />
              <rect x={6 + i * 21} y="25" width="19" height="16" rx="1.5" className={i === 1 ? MID : SOFT} />
            </g>
          ))}
        </g>
      );
    case "banner":
      return (
        <g>
          <rect x="5" y="12" width="62" height="24" rx="2" className={SOFT} />
          <rect x="10" y="19" width="26" height="3.6" rx="1.8" className={STRONG} />
          <rect x="10" y="26" width="18" height="2.4" rx="1.2" className={MID} />
          <rect x="50" y="21" width="12" height="6" rx="3" className={STRONG} />
        </g>
      );
    case "categories":
      return (
        <g>
          <Heading w={18} />
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <circle cx={14 + i * 15} cy="27" r="5.5" className={SOFT} />
              <rect x={9.5 + i * 15} y="36" width="9" height="1.8" rx="0.9" className={MID} />
            </g>
          ))}
        </g>
      );
    case "newArrivals":
      return (
        <g>
          <Heading />
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} x={6 + i * 16} />
          ))}
          <circle cx="10" cy="22" r="2" className={STRONG} />
        </g>
      );
    case "featured":
      return (
        <g>
          <Heading w={16} />
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} x={6 + i * 16} />
          ))}
          <path d="M60 21l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z" className={STRONG} />
        </g>
      );
    case "productShelf":
      return (
        <g>
          <Heading w={26} />
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} x={6 + i * 16} w={i === 3 ? 6 : 12} />
          ))}
          <path d="M66 31l2-2.4v4.8z" className={MID} />
        </g>
      );
    case "wholesale":
      return (
        <g>
          <Heading w={20} />
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect x="6" y={17 + i * 7.5} width="60" height="5.5" rx="1.2" className={i % 2 === 0 ? SOFT : "fill-none"} />
              <rect x="9" y={19 + i * 7.5} width="20" height="1.8" rx="0.9" className={MID} />
              <rect x="50" y={19 + i * 7.5} width="12" height="1.8" rx="0.9" className={MID} />
            </g>
          ))}
        </g>
      );
    case "offers":
      return (
        <g>
          <Heading w={14} />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <Card x={6 + i * 21} w={19} />
              <path d={`M${6 + i * 21} 18h8l-3 4h-5z`} className={STRONG} />
            </g>
          ))}
        </g>
      );
    case "benefits":
      return (
        <g>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <circle cx={15 + i * 21} cy="19" r="5" className={MID} />
              <rect x={7 + i * 21} y="29" width="16" height="2.4" rx="1.2" className={STRONG} />
              <rect x={9 + i * 21} y="34" width="12" height="1.8" rx="0.9" className={SOFT} />
            </g>
          ))}
        </g>
      );
    case "appPromo":
      return (
        <g>
          <rect x="8" y="10" width="26" height="4" rx="2" className={STRONG} />
          <rect x="8" y="17" width="20" height="2.4" rx="1.2" className={MID} />
          <rect x="8" y="28" width="13" height="6" rx="3" className={MID} />
          <rect x="23" y="28" width="13" height="6" rx="3" className={MID} />
          <rect x="46" y="6" width="17" height="36" rx="3" className={SOFT} />
          <rect x="52" y="38" width="5" height="1.6" rx="0.8" className={MID} />
        </g>
      );
    case "customContent":
      return (
        <g>
          <rect x="8" y="8" width="26" height="4.4" rx="2.2" className={STRONG} />
          <rect x="8" y="17" width="56" height="2.4" rx="1.2" className={MID} />
          <rect x="8" y="22" width="52" height="2.4" rx="1.2" className={MID} />
          <rect x="8" y="27" width="56" height="2.4" rx="1.2" className={MID} />
          <rect x="8" y="34" width="34" height="2.4" rx="1.2" className={SOFT} />
        </g>
      );
    case "discovery":
      return (
        <g>
          <Heading w={20} />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={6 + i * 16} y="18" width="14" height="6" rx="3" className={i === 0 ? STRONG : MID} />
          ))}
          {[0, 1, 2].map((i) => (
            <Card key={i} x={6 + i * 21} y={28} w={19} h={14} />
          ))}
        </g>
      );
    case "deliveryPromise":
      return (
        <g>
          <rect x="5" y="12" width="62" height="24" rx="2" className={SOFT} />
          <path d="M11 29h14v-9H11zM25 23h6l3 3v3H25z" className={MID} />
          <circle cx="16" cy="30.5" r="2" className={STRONG} />
          <circle cx="30" cy="30.5" r="2" className={STRONG} />
          <rect x="40" y="19" width="22" height="3.2" rx="1.6" className={STRONG} />
          <rect x="40" y="26" width="16" height="2.4" rx="1.2" className={MID} />
        </g>
      );
    default:
      return null;
  }
}

/** True for every section type the builder knows — guarded by a test so a new type cannot ship without a thumbnail. */
export function hasSectionThumbnail(type: string): boolean {
  return Body({ type: type as HomeBuilderSectionKey }) !== null;
}

export function SectionThumbnail({ type }: { type: HomeBuilderSectionKey }) {
  return (
    <svg
      aria-hidden="true"
      data-section-thumbnail={type}
      viewBox="0 0 72 48"
      className="h-11 w-16 shrink-0 text-primary rtl:-scale-x-100"
    >
      {FRAME}
      <Body type={type} />
    </svg>
  );
}
