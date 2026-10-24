import React from 'react';
import { MONO, SANS, Theme } from '../config/theme';
import { fmt } from '../config/demo-data';
import { Riyal } from '../primitives/Riyal';

export const Abs: React.FC<{ x: number; y: number; w?: number; h?: number; style?: React.CSSProperties; children?: React.ReactNode }> = ({
  x,
  y,
  w,
  h,
  style,
  children,
}) => <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, ...style }}>{children}</div>;

export const Card: React.FC<{
  t: Theme;
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({ t, x, y, w, h, r = 8, style, children }) => (
  <Abs
    x={x}
    y={y}
    w={w}
    h={h}
    style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: r, overflow: 'hidden', ...style }}
  >
    {children}
  </Abs>
);

/** Mono amount + Riyal sign, laid out like web/src/lib/money.ts (number then sign). */
export const Amount: React.FC<{
  v: number;
  size: number;
  color?: string;
  weight?: number;
  sign?: boolean;
  signColor?: string;
  style?: React.CSSProperties;
}> = ({ v, size, color, weight = 600, sign = true, signColor, style }) => (
  <span
    dir="ltr"
    style={{
      display: 'inline-flex',
      alignItems: 'baseline',
      gap: size * 0.22,
      fontFamily: MONO,
      fontVariantNumeric: 'tabular-nums',
      fontSize: size,
      fontWeight: weight,
      color,
      lineHeight: 1,
      whiteSpace: 'nowrap',
      ...style,
    }}
  >
    <span>{fmt(v)}</span>
    {sign && <Riyal size={size * 0.72} color={signColor ?? color} />}
  </span>
);

export const Mono: React.FC<{ size: number; color?: string; weight?: number; style?: React.CSSProperties; children: React.ReactNode }> = ({
  size,
  color,
  weight = 500,
  style,
  children,
}) => (
  <span dir="ltr" style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums', fontSize: size, color, fontWeight: weight, whiteSpace: 'nowrap', ...style }}>
    {children}
  </span>
);

export const Txt: React.FC<{ size: number; color?: string; weight?: number; style?: React.CSSProperties; children: React.ReactNode }> = ({
  size,
  color,
  weight = 400,
  style,
  children,
}) => (
  <span dir="rtl" style={{ fontFamily: SANS, fontSize: size, color, fontWeight: weight, whiteSpace: 'nowrap', lineHeight: 1.35, ...style }}>
    {children}
  </span>
);

export const Badge: React.FC<{ t: Theme; tone?: 'positive' | 'primary' | 'muted'; children: React.ReactNode; size?: number }> = ({
  t,
  tone = 'positive',
  children,
  size = 12,
}) => {
  const color = tone === 'positive' ? t.positive : tone === 'primary' ? t.primary : t.muted;
  return (
    <span
      style={{
        fontFamily: SANS,
        fontSize: size,
        fontWeight: 600,
        color,
        border: `1px solid ${color}33`,
        background: `${color}14`,
        borderRadius: 999,
        padding: `${size * 0.2}px ${size * 0.75}px`,
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
      }}
    >
      {children}
    </span>
  );
};

/** Minimal lucide-style glyphs (stroke 1.7) so nothing depends on an icon package. */
export const Icon: React.FC<{ d: string; size?: number; color?: string; sw?: number }> = ({ d, size = 18, color = 'currentColor', sw = 1.7 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export const ICONS = {
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  book: 'M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zM4 5v16',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  users: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8',
  store: 'M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6',
  pos: 'M4 4h16v10H4zM8 20h8M12 14v6',
  cash: 'M2 7h20v10H2zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  truck: 'M1 5h14v11H1zM15 9h4l3 3v4h-7M5.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM18.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  check: 'M4 12.5 9.5 18 20 6',
  barcode: 'M3 5v14M7 5v14M11 5v14M14 5v14M18 5v14M21 5v14',
  trend: 'M22 7 13.5 15.5 8.5 10.5 2 17M16 7h6v6',
  wallet: 'M3 6h15a3 3 0 0 1 3 3v9H3zM3 6l12-3v3M17 13h.01',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
};
