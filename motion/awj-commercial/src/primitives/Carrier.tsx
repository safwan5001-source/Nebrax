import React from 'react';
import { MONO } from '../config/theme';

/**
 * The carried value: one element that physically travels between product contexts.
 * Anchored by its left edge and vertical centre so it can be handed between
 * worlds by projecting their anchors to screen space.
 */
export const Carrier: React.FC<{
  x: number;
  y: number;
  size: number;
  text: string;
  color: string;
  weight?: number;
  opacity?: number;
  blurX?: number;
  style?: React.CSSProperties;
}> = ({ x, y, size, text, color, weight = 600, opacity = 1, blurX = 0, style }) => (
  <div
    dir="ltr"
    style={{
      position: 'absolute',
      left: 0,
      top: 0,
      transform: `translate(${x}px, ${y - size / 2}px)`,
      fontFamily: MONO,
      fontVariantNumeric: 'tabular-nums',
      fontSize: size,
      fontWeight: weight,
      lineHeight: 1,
      color,
      opacity,
      whiteSpace: 'pre',
      filter: blurX > 0.4 ? `blur(${Math.min(blurX, 6)}px)` : undefined,
      ...style,
    }}
  >
    {text}
  </div>
);

export const lerpPt = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
