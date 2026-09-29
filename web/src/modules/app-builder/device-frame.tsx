import * as React from 'react';

/**
 * MOBILE-PREVIEW-3 — Browser App Preview Shell.
 *
 * Purely decorative device bezel used only by the App Preview mode
 * (`builder/page.tsx`) to give the merchant an obvious "this is a phone"
 * visual context, per `AWJ_APP_BUILDER_REAL_MOBILE_PREVIEW_HORIZON.md` §6/11
 * and `REAL-MOBILE-PREVIEW-2-RUNTIME-ARCHITECTURE-EVIDENCE.md` §8 ("iPhone /
 * Android visual frame presets"). This is Level B (Browser Mobile Preview)
 * chrome only — it wraps whatever is passed as `children` (the existing
 * `AppBuilderCanvas`, unmodified) and never inspects or interprets the App
 * Schema itself. No native status-bar simulation, no fake OS chrome beyond a
 * minimal notch/camera-dot silhouette — see the Horizon's own "avoid
 * decorative phone mockups that reduce usable preview area" quality-bar note.
 */

export const DEVICE_FRAME_PRESETS = {
  iphone: { width: 390, height: 844, label: 'iPhone' },
  android: { width: 412, height: 915, label: 'Android' },
} as const;

export type DeviceFramePreset = keyof typeof DEVICE_FRAME_PRESETS;

export function DeviceFrame({
  preset,
  children,
}: {
  preset: DeviceFramePreset;
  children: React.ReactNode;
}) {
  const { width, height } = DEVICE_FRAME_PRESETS[preset];
  const bezel = 10;

  return (
    <div
      className="relative shrink-0 rounded-[2.75rem] bg-neutral-900 p-2.5 shadow-xl"
      style={{ width: width + bezel * 2, height: height + bezel * 2 }}
      data-device-frame={preset}
    >
      {/* Centering with a physical `left-1/2` + `-translate-x-1/2` (not `start-1/2`) is
          deliberate: this notch/camera-dot silhouette must stay horizontally centered
          regardless of the surrounding page's RTL/LTR direction — it decorates the device
          bezel itself, not RTL/LTR-sensitive app content. */}
      {preset === 'iphone' ? (
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-2.5 z-10 h-6 w-28 -translate-x-1/2 rounded-b-2xl bg-neutral-900"
        />
      ) : (
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-4 z-10 h-2 w-2 -translate-x-1/2 rounded-full bg-neutral-700"
        />
      )}
      <div
        className="h-full w-full overflow-hidden rounded-[2.1rem] bg-surface"
        style={{ width, height }}
      >
        {children}
      </div>
    </div>
  );
}
