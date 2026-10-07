"use client";

/**
 * CUST-HV V4b — identity slot (logo / compact logo / favicon) with the lazy
 * migration from the legacy embedded image (V0 §7.8 "Legacy").
 *
 *   media reference set     → the media field (picker / editor / alt / readiness)
 *   legacy only, library on → the legacy control **unchanged** + an explicit
 *                             "switch to the media library" action; choosing a
 *                             library image replaces the embedded one (the legacy
 *                             value is cleared by that explicit act, never by a
 *                             background rewrite)
 *   library gated/unknown   → the legacy control only, exactly as before
 */
import type { ReactNode } from "react";
import type { CustomizerMessageKey } from "../messages";
import type { MediaRef } from "../presentation/media-ref";
import { MediaRefField } from "./MediaRefField";
import { useMediaCapability } from "./use-media-capability";

export function LogoMediaSlot({
  slot,
  label,
  hint,
  media,
  hasLegacy,
  legacyControl,
  onMediaChange,
  t,
  locale,
}: {
  slot: string;
  label: string;
  hint?: string;
  media: MediaRef | null;
  hasLegacy: boolean;
  /** The existing legacy upload control for this slot. */
  legacyControl: ReactNode;
  /** `next` is the new reference, or `null` to remove it. Picking clears the legacy value. */
  onMediaChange: (next: MediaRef | null, opts: { clearLegacy: boolean }) => void;
  t: (key: CustomizerMessageKey) => string;
  locale: "ar" | "en";
}) {
  const capability = useMediaCapability();

  if (media) {
    return (
      <MediaRefField
        slot={slot}
        label={label}
        hint={hint}
        value={media}
        t={t}
        locale={locale}
        onChange={(next) => onMediaChange(next, { clearLegacy: next !== null })}
      />
    );
  }

  if (capability !== "available") return <>{legacyControl}</>;

  // Library on and nothing embedded: only the library (new images never go
  // back to being embedded in the document).
  if (!hasLegacy) {
    return (
      <MediaRefField
        slot={slot}
        label={label}
        hint={hint}
        value={null}
        t={t}
        locale={locale}
        onChange={(next) => onMediaChange(next, { clearLegacy: false })}
      />
    );
  }

  return (
    <div className="space-y-2" data-logo-slot={slot}>
      {legacyControl}
      <div className="border-s-2 border-border ps-3">
        <p className="pb-1 text-[12px] leading-5 text-muted" data-media-legacy-badge="">
          {t("mediaLegacyBadge")} — {t("mediaMigrateHint")}
        </p>
        <MediaRefField
          slot={slot}
          label={t("mediaSwitchToLibrary")}
          value={null}
          t={t}
          locale={locale}
          onChange={(next) => onMediaChange(next, { clearLegacy: next !== null })}
        />
      </div>
    </div>
  );
}
