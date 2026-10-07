"use client";

/**
 * CUST-HV V4b — per-usage derivative readiness (V0 §7.10, AMEND-21 consumer).
 *
 * A usage is one `MediaRef`'s framing. States the merchant sees:
 *   none        no framing → base ladder, nothing to generate
 *   checking    reading the current state (never generates)
 *   processing  being generated (this request, or a live lease elsewhere)
 *   ready       every file ready
 *   failed      terminal; `retry()` re-runs **only this usage**
 *
 * Rules:
 *   - On mount the hook only **reads** (`usageStatus`); it generates only when the
 *     merchant changed the framing, or when a read says the usage is `absent`
 *     (a saved draft whose derivative was reaped) — one bounded request each.
 *   - Generation is **serialised across every field** through one queue (V2b:
 *     one usage per request; a document with N usages is N sequential calls).
 *   - A stale response never overwrites a newer one (generation counter).
 *   - The previous ready preview stays visible while a new framing processes or
 *     fails, so the merchant never stares at a broken image.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ensureUsage,
  mediaRefTransform,
  usageNeedsDerivatives,
  usageStatus,
  type UsageStatus,
} from "@/modules/commerce-workspace/storefront-media";
import type { MediaRef } from "../presentation/media-ref";

export type ReadinessState = "none" | "checking" | "processing" | "ready" | "failed";

export interface UsageReadiness {
  state: ReadinessState;
  errorCode: string | null;
  /** Signed WebP of the framed usage, when ready — preview only. */
  previewUrl: string | null;
  retry: () => void;
}

const DEBOUNCE_MS = 600;
const POLL_MS = 2000;
const MAX_POLLS = 30;

let queue: Promise<unknown> = Promise.resolve();
/** One generation at a time, across all fields. */
export function enqueueGeneration<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export function pickPreviewUrl(status: UsageStatus): string | null {
  const ready = status.files.filter((f) => f.format === "webp" && f.url && f.state === "ready");
  if (ready.length === 0) return null;
  const sorted = [...ready].sort((a, b) => a.width - b.width);
  return (sorted.find((f) => f.width >= 768) ?? sorted[sorted.length - 1]).url;
}

function usageKey(ref: MediaRef | null): string {
  return ref ? JSON.stringify([ref.mediaId, mediaRefTransform(ref)]) : "";
}

export function useUsageReadiness(ref: MediaRef | null): UsageReadiness {
  const key = usageKey(ref);
  const mountKey = useRef(key);
  const run = useRef(0);
  const lastPreview = useRef<string | null>(null);
  const [state, setState] = useState<ReadinessState>("none");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const refSnapshot = useRef(ref);
  refSnapshot.current = ref;

  const apply = useCallback((status: UsageStatus, token: number) => {
    if (token !== run.current) return false;
    if (status.state === "ready") {
      const url = pickPreviewUrl(status);
      lastPreview.current = url ?? lastPreview.current;
      setPreviewUrl(url ?? lastPreview.current);
      setState("ready");
      setErrorCode(null);
    } else if (status.state === "failed") {
      setState("failed");
      setErrorCode(status.errorCode);
    } else {
      setState("processing");
      setErrorCode(null);
    }
    return true;
  }, []);

  const generate = useCallback(
    async (token: number, retry: boolean) => {
      const current = refSnapshot.current;
      if (!current) return;
      setState("processing");
      setErrorCode(null);
      try {
        let status = await enqueueGeneration(() =>
          ensureUsage(current.mediaId, mediaRefTransform(current), { retry }),
        );
        for (let i = 0; i < MAX_POLLS && status.state === "processing"; i += 1) {
          if (!apply(status, token)) return;
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          if (token !== run.current) return;
          status = await usageStatus(current.mediaId, mediaRefTransform(current));
        }
        apply(status, token);
      } catch {
        if (token !== run.current) return;
        setState("failed");
        setErrorCode("network");
      }
    },
    [apply],
  );

  useEffect(() => {
    const token = ++run.current;
    const current = refSnapshot.current;
    if (!current || !usageNeedsDerivatives(current)) {
      setState("none");
      setErrorCode(null);
      setPreviewUrl(null);
      lastPreview.current = null;
      return;
    }
    const changedByMerchant = key !== mountKey.current;
    setState("checking");
    const timer = window.setTimeout(
      async () => {
        if (changedByMerchant) {
          await generate(token, false);
          return;
        }
        try {
          const status = await usageStatus(current.mediaId, mediaRefTransform(current));
          if (token !== run.current) return;
          if (status.state === "absent") await generate(token, false);
          else apply(status, token);
        } catch {
          if (token !== run.current) return;
          setState("failed");
          setErrorCode("network");
        }
      },
      changedByMerchant ? DEBOUNCE_MS : 0,
    );
    return () => window.clearTimeout(timer);
  }, [key, generate, apply]);

  const retry = useCallback(() => {
    const token = ++run.current;
    void generate(token, true);
  }, [generate]);

  return { state, errorCode, previewUrl, retry };
}
