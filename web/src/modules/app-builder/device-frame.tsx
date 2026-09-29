import * as React from 'react';
import { cn } from '@/lib/utils';

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
 *
 * **Responsive by CSS breakpoint, not a JS media-query check** (no resize
 * listener, no hydration mismatch): below `lg` — this Builder route's own
 * existing mobile-admin breakpoint, the same one its structure/inspector
 * panes already switch on — the bezel disappears entirely and the screen
 * area becomes full-width/full-height. This is `REAL-MOBILE-PREVIEW-
 * SALLA-MOBILE-BENCHMARK.md`'s benchmark decision B2 ("on small/mobile
 * admin screens, do not show a tiny phone inside the phone; use available
 * width") — confirmed against Salla's own official app-design documentation
 * (a dedicated, separate "Preview the app" feature) and Shopify's theme
 * editor ("collapse the sidebar…giving you a full-width preview") during
 * this task's official-sources evidence pass. At `lg` and above it becomes
 * the professional iPhone/Android bezel.
 */

export const DEVICE_FRAME_PRESETS = {
  iphone: { width: 390, height: 844, label: 'iPhone' },
  android: { width: 412, height: 915, label: 'Android' },
} as const;

export type DeviceFramePreset = keyof typeof DEVICE_FRAME_PRESETS;

/**
 * One literal, fully-static class string per preset (never built by
 * interpolating the numbers at runtime) so Tailwind's build-time scanner can
 * see and retain these exact utility classes.
 */
const FRAME_SIZE_CLASSES: Record<DeviceFramePreset, string> = {
  iphone: 'lg:w-[390px] lg:h-[844px]',
  android: 'lg:w-[412px] lg:h-[915px]',
};

export function DeviceFrame({
  preset,
  children,
}: {
  preset: DeviceFramePreset;
  children: React.ReactNode;
}) {
  return (
    <div
      className="relative flex h-full w-full flex-1 justify-center overflow-hidden lg:h-fit lg:w-fit lg:flex-none lg:rounded-[2.75rem] lg:bg-neutral-900 lg:p-2.5 lg:shadow-xl"
      data-device-frame={preset}
    >
      {/* Centering with a physical `left-1/2` + `-translate-x-1/2` (not `start-1/2`) is
          deliberate: this notch/camera-dot silhouette must stay horizontally centered
          regardless of the surrounding page's RTL/LTR direction — it decorates the device
          bezel itself, not RTL/LTR-sensitive app content. Hidden below `lg` along with the
          rest of the bezel chrome. */}
      {preset === 'iphone' ? (
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-2.5 z-10 hidden h-6 w-28 -translate-x-1/2 rounded-b-2xl bg-neutral-900 lg:block"
        />
      ) : (
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-4 z-10 hidden h-2 w-2 -translate-x-1/2 rounded-full bg-neutral-700 lg:block"
        />
      )}
      <div className={cn('h-full w-full overflow-hidden bg-surface lg:rounded-[2.1rem]', FRAME_SIZE_CLASSES[preset])}>
        {children}
      </div>
    </div>
  );
}
