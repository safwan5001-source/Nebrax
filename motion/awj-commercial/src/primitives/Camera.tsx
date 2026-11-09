import React from 'react';
import { useVideoConfig } from 'remotion';

export type Cam = { x: number; y: number; s: number; rx?: number; rz?: number };

/**
 * A virtual camera over a world laid out in its own pixel space.
 * (x, y) is the world point placed at frame centre; s is magnification.
 */
export const Camera: React.FC<{
  cam: Cam;
  width: number;
  height: number;
  perspective?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ cam, width, height, perspective = 2400, children, style }) => {
  const { width: W, height: H } = useVideoConfig();
  const tx = W / 2 - cam.x * cam.s;
  const ty = H / 2 - cam.y * cam.s;
  const has3d = (cam.rx ?? 0) !== 0 || (cam.rz ?? 0) !== 0;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', perspective: has3d ? perspective : undefined, ...style }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transformOrigin: `${W / 2}px ${H / 2}px`,
          transform: has3d ? `rotateX(${cam.rx ?? 0}deg) rotateZ(${cam.rz ?? 0}deg)` : undefined,
          transformStyle: 'preserve-3d',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width,
            height,
            transformOrigin: '0 0',
            transform: `translate(${tx}px, ${ty}px) scale(${cam.s})`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

/** Project a world point to screen space for a flat camera (used to hand objects between worlds). */
export const project = (pt: { x: number; y: number }, cam: Cam, W = 1920, H = 1080) => ({
  x: W / 2 + (pt.x - cam.x) * cam.s,
  y: H / 2 + (pt.y - cam.y) * cam.s,
});

/** Inverse of `project`: where a screen point sits inside a camera's world. */
export const unproject = (pt: { x: number; y: number }, cam: Cam, W = 1920, H = 1080) => ({
  x: cam.x + (pt.x - W / 2) / cam.s,
  y: cam.y + (pt.y - H / 2) / cam.s,
});
