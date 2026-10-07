"use client";

/**
 * CUST-HV V4b — is the media library usable for this account right now?
 *
 * `STOREFRONT_MEDIA_R2_ENABLED` is off by default in Production, so the library
 * is **capability-gated** (V0 §7.10): until it is on, identity slots keep the
 * legacy upload exactly as before. One cheap list call, cached briefly and
 * shared by every slot; any failure reads as "not available" (never throws).
 */
import { useEffect, useState } from "react";
import { listStorefrontMedia } from "@/modules/commerce-workspace/storefront-media";

export type MediaCapability = "checking" | "available" | "gated";

const TTL_MS = 60_000;
let cached: { at: number; value: Exclude<MediaCapability, "checking"> } | null = null;
let inflight: Promise<Exclude<MediaCapability, "checking">> | null = null;

export function resetMediaCapabilityCache(): void {
  cached = null;
  inflight = null;
}

async function probe(): Promise<Exclude<MediaCapability, "checking">> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  inflight ??= listStorefrontMedia()
    .then((page): Exclude<MediaCapability, "checking"> => (page.meta.uploadsEnabled ? "available" : "gated"))
    .catch((): Exclude<MediaCapability, "checking"> => "gated")
    .then((value) => {
      cached = { at: Date.now(), value };
      inflight = null;
      return value;
    });
  return inflight;
}

export function useMediaCapability(): MediaCapability {
  const [value, setValue] = useState<MediaCapability>(cached?.value ?? "checking");
  useEffect(() => {
    let live = true;
    void probe().then((next) => {
      if (live) setValue(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return value;
}
