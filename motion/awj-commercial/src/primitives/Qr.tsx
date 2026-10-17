import React from 'react';

/**
 * Deterministic QR-like matrix (demo visual of the ZATCA Phase-1 TLV QR — not a
 * scannable code, and it encodes nothing). `reveal` draws modules in a diagonal sweep.
 */
const N = 29;
const seed = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const finder = (r: number, c: number) => {
  const inBox = (r0: number, c0: number) => r >= r0 && r < r0 + 7 && c >= c0 && c < c0 + 7;
  const ring = (r0: number, c0: number) => {
    const rr = r - r0;
    const cc = c - c0;
    return rr === 0 || rr === 6 || cc === 0 || cc === 6 || (rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4);
  };
  if (inBox(0, 0)) return ring(0, 0) ? 1 : 0;
  if (inBox(0, N - 7)) return ring(0, N - 7) ? 1 : 0;
  if (inBox(N - 7, 0)) return ring(N - 7, 0) ? 1 : 0;
  if ((r === 7 || c === 7) && (r < 8 && c < 8)) return 0;
  if ((r === 7 && c >= N - 8) || (c === N - 8 && r < 8)) return 0;
  if ((c === 7 && r >= N - 8) || (r === N - 8 && c < 8)) return 0;
  return -1;
};

export const Qr: React.FC<{ size: number; color: string; reveal?: number }> = ({ size, color, reveal = 1 }) => {
  const rects: React.ReactNode[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const fixed = finder(r, c);
      const on = fixed === -1 ? seed(r * N + c) > 0.52 : fixed === 1;
      if (!on) continue;
      const order = (r + c) / (2 * N - 2);
      if (order > reveal) continue;
      rects.push(<rect key={`${r}-${c}`} x={c} y={r} width={1.02} height={1.02} />);
    }
  }
  return (
    <svg width={size} height={size} viewBox={`-1 -1 ${N + 2} ${N + 2}`} shapeRendering="crispEdges">
      <g fill={color}>{rects}</g>
    </svg>
  );
};
