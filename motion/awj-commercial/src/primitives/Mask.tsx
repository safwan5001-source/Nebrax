import React from 'react';

/**
 * Baseline mask: whole shaped words rise from (or sink into) an invisible edge.
 * Arabic is never split into letters — splitting would break joining forms.
 * `t` 0 → hidden below, 1 → resting; `out` 0 → resting, 1 → gone above.
 * The mask box is padded so Arabic ascenders/descenders and harakat are never clipped at rest.
 */
export const Rise: React.FC<{
  t: number;
  out?: number;
  distance?: number; // em
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ t, out = 0, distance = 2, style, children }) => {
  if (t <= 0 || out >= 1) return <span style={{ display: 'inline-block', visibility: 'hidden', ...style }}>{children}</span>;
  const y = (1 - t) * distance - out * distance;
  return (
    <span
      style={{
        display: 'inline-block',
        overflow: 'hidden',
        padding: '0.28em 0.08em 0.42em',
        margin: '-0.28em -0.08em -0.42em',
        verticalAlign: 'top',
        ...style,
      }}
    >
      <span style={{ display: 'inline-block', transform: `translateY(${y}em)` }}>{children}</span>
    </span>
  );
};

/** Directional motion blur via an inline SVG filter (only mounted while moving). */
export const DirBlur: React.FC<{ id: string; x?: number; y?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  id,
  x = 0,
  y = 0,
  children,
  style,
}) => {
  const active = Math.abs(x) > 0.3 || Math.abs(y) > 0.3;
  return (
    <div style={{ position: 'absolute', inset: 0, filter: active ? `url(#${id})` : undefined, ...style }}>
      {active && (
        <svg width="0" height="0" style={{ position: 'absolute' }}>
          <filter id={id} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation={`${Math.abs(x).toFixed(2)} ${Math.abs(y).toFixed(2)}`} />
          </filter>
        </svg>
      )}
      {children}
    </div>
  );
};
