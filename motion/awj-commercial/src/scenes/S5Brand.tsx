import React from 'react';
import { BRAND_BLUE, dark, light, SANS } from '../config/theme';
import { T } from '../config/timeline';
import { ease, lerp, p } from '../lib/motion';
import { Rise } from '../primitives/Mask';

/**
 * ACT 5 — the workspace closes into one horizon line; the world returns to light;
 * the line settles into a baseline and أَوْج rises from behind it — the peak.
 * The wordmark is the product's own (IBM Plex Sans Arabic Bold, primary), never redrawn.
 */
export const LOCKUP = { right: 1330, lineY: 690, lineW: 700 };

export const S5Brand: React.FC<{ f: number }> = ({ f }) => {
  if (f < T.brand.start) return null;
  const b = T.brand;
  const toLight = p(f, 744, 770, ease.inOut);
  const retract = p(f, b.retract, b.retract + 34, ease.heavy);
  const lineRight = lerp(1920, LOCKUP.right, retract);
  const lineLeft = lerp(0, LOCKUP.right - LOCKUP.lineW, retract);
  const thick = lerp(2, 3, retract);
  const word = p(f, b.word, b.word + 42, ease.type);
  const latin = p(f, b.latin, b.latin + 30, ease.type);
  const tag = p(f, b.tag, b.tag + 30, ease.type);
  const push = 1 + 0.018 * p(f, 780, 900, ease.linear); // slow settle, never still-dead
  const lineColor = toLight < 0.5 ? dark.primary : BRAND_BLUE;

  return (
    <div style={{ position: 'absolute', inset: 0, background: dark.bg }}>
      <div style={{ position: 'absolute', inset: 0, background: light.bg, opacity: toLight }} />
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${push})`, transformOrigin: `${LOCKUP.right - LOCKUP.lineW / 2}px ${LOCKUP.lineY}px` }}>
        {/* wordmark rises from behind the line: the mask's floor *is* the line */}
        <div
          style={{
            position: 'absolute',
            left: LOCKUP.right - LOCKUP.lineW - 40,
            width: LOCKUP.lineW + 80,
            top: 0,
            height: LOCKUP.lineY - 6,
            overflow: 'hidden',
          }}
        >
          <div
            dir="rtl"
            style={{
              position: 'absolute',
              right: 40,
              bottom: 0,
              transform: `translateY(${(1 - word) * 760}px)`, // clears harakat that overflow the line box
              fontFamily: SANS,
              fontWeight: 700,
              fontSize: 360,
              lineHeight: 1,
              color: BRAND_BLUE,
              paddingBottom: '0.3em',
              whiteSpace: 'nowrap',
            }}
          >
            أَوْج
          </div>
        </div>
        <div style={{ position: 'absolute', left: lineLeft, width: lineRight - lineLeft, top: LOCKUP.lineY - thick / 2, height: thick, background: lineColor }} />
        {/* AWJ — at the line's far end, tracking closes in */}
        <div style={{ position: 'absolute', left: LOCKUP.right - LOCKUP.lineW, top: LOCKUP.lineY + 26 }}>
          <Rise t={latin}>
            <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 46, color: BRAND_BLUE, letterSpacing: `${lerp(0.4, 0.08, latin)}em` }}>AWJ</span>
          </Rise>
        </div>
        {/* campaign line — RTL start, on the same baseline row */}
        <div dir="rtl" style={{ position: 'absolute', right: 1920 - LOCKUP.right, top: LOCKUP.lineY + 28 }}>
          <Rise t={tag}>
            <span style={{ fontFamily: SANS, fontWeight: 500, fontSize: 44, color: light.text }}>
              أعمالك. في <span style={{ color: BRAND_BLUE, fontWeight: 700 }}>أَوْجها.</span>
            </span>
          </Rise>
        </div>
      </div>
    </div>
  );
};
