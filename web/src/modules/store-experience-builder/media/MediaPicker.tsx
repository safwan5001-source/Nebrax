"use client";

/**
 * CUST-HV V4b — MediaPicker (V0 §7.10): Library | Upload.
 *
 * Library: grid, search, unused filter, cursor paging. Every state the contract
 * names is a real state here — loading, empty, no results, uploading, processing
 * (`variants_state = pending`), ready, failed (+ Retry), network error, permission
 * denied, capability-gated (uploads off). An asset that is not `ready` is visible
 * and retryable but **cannot be selected into a design**.
 *
 * Upload: multi-file, drag-drop, one request per file so each has its own
 * progress and error. Nothing here ever shows a URL, path or storage key.
 */
import { AlertTriangle, ImagePlus, Loader2, RefreshCw, Search, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { hasApiStatus } from "@/lib/api";
import {
  listStorefrontMedia,
  retryStorefrontMedia,
  uploadStorefrontMedia,
  type StorefrontMediaAsset,
  type StorefrontMediaLibraryMeta,
} from "@/modules/commerce-workspace/storefront-media";
import type { CustomizerMessageKey } from "../messages";
import { MediaDialog } from "./MediaDialog";
import { mediaBtnClass, mediaInputClass, mediaPrimaryBtnClass } from "./ui";

type T = (key: CustomizerMessageKey) => string;
type Tab = "library" | "upload";
type LoadState = "loading" | "ready" | "error" | "forbidden";

interface UploadRow {
  id: number;
  name: string;
  status: "queued" | "uploading" | "created" | "duplicate" | "rejected" | "error";
  message?: string;
  asset?: StorefrontMediaAsset;
}

const ACCEPT = "image/jpeg,image/png,image/webp";

export function MediaPicker({
  open,
  onClose,
  onSelect,
  t,
  locale,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (asset: StorefrontMediaAsset) => void;
  t: T;
  locale: "ar" | "en";
}) {
  const [tab, setTab] = useState<Tab>("library");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [unused, setUnused] = useState(false);
  const [items, setItems] = useState<StorefrontMediaAsset[]>([]);
  const [meta, setMeta] = useState<StorefrontMediaLibraryMeta | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});
  const [dragging, setDragging] = useState(false);
  const generation = useRef(0);
  const uploadId = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  const classify = (error: unknown): LoadState =>
    hasApiStatus(error, 403) ? "forbidden" : "error";

  // Stale-response guard: only the latest request may write state.
  const load = useCallback(
    async (opts: { cursor?: string | null; append?: boolean } = {}) => {
      const run = ++generation.current;
      if (opts.append) setLoadingMore(true);
      else setState("loading");
      try {
        const page = await listStorefrontMedia({
          q: debounced,
          unused,
          cursor: opts.cursor ?? null,
        });
        if (run !== generation.current) return;
        setItems((prev) => (opts.append ? [...prev, ...page.items] : page.items));
        setMeta(page.meta);
        setState("ready");
      } catch (error) {
        if (run !== generation.current) return;
        setState(classify(error));
      } finally {
        if (run === generation.current) setLoadingMore(false);
      }
    },
    [debounced, unused],
  );

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) {
      setUploads([]);
      setTab("library");
    }
  }, [open]);

  const uploadsEnabled = meta?.uploadsEnabled ?? true;

  async function runUploads(files: File[]) {
    const rows: UploadRow[] = files.map((file) => ({
      id: ++uploadId.current,
      name: file.name,
      status: "queued",
    }));
    setUploads((prev) => [...rows, ...prev]);
    const patch = (id: number, next: Partial<UploadRow>) =>
      setUploads((prev) => prev.map((r) => (r.id === id ? { ...r, ...next } : r)));
    let any = false;
    for (let i = 0; i < files.length; i += 1) {
      const row = rows[i];
      patch(row.id, { status: "uploading" });
      try {
        const out = await uploadStorefrontMedia(files[i]);
        if (out.status === "rejected") {
          patch(row.id, { status: "rejected", message: out.message });
        } else {
          any = true;
          patch(row.id, { status: out.status, asset: out.asset });
        }
      } catch (error) {
        patch(row.id, {
          status: "error",
          message: hasApiStatus(error, 403) ? t("mediaForbidden") : t("mediaUploadFailed"),
        });
      }
    }
    if (any) void load();
  }

  function onFiles(list: FileList | null) {
    if (!list || list.length === 0 || !uploadsEnabled) return;
    void runUploads(Array.from(list));
    if (fileInput.current) fileInput.current.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    onFiles(event.dataTransfer.files);
  }

  async function retry(asset: StorefrontMediaAsset) {
    setRetrying((prev) => ({ ...prev, [asset.id]: true }));
    try {
      const next = await retryStorefrontMedia(asset.id);
      setItems((prev) => prev.map((a) => (a.id === next.id ? { ...a, ...next } : a)));
    } catch {
      /* the asset stays failed and retryable */
    } finally {
      setRetrying((prev) => ({ ...prev, [asset.id]: false }));
    }
  }

  const gated = meta !== null && !meta.uploadsEnabled;

  return (
    <MediaDialog
      open={open}
      onClose={onClose}
      title={t("mediaPickerTitle")}
      closeLabel={t("mediaCancel")}
      locale={locale}
      wide
    >
      <div className="space-y-4" data-media-picker="">
        <div role="tablist" aria-label={t("mediaPickerTitle")} className="flex border-b border-border">
          {(["library", "upload"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`min-h-11 px-4 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:min-h-9 ${
                tab === id ? "border-b-2 border-primary text-text" : "text-muted hover:text-text"
              }`}
            >
              {id === "library" ? t("mediaTabLibrary") : t("mediaTabUpload")}
            </button>
          ))}
        </div>

        {gated ? (
          <p role="status" className="flex items-start gap-2 border border-border bg-background p-3 text-[12px] leading-5 text-muted" data-media-gated="">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t("mediaGated")}
          </p>
        ) : null}

        {tab === "upload" ? (
          <div className="space-y-3">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (uploadsEnabled) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              data-media-dropzone=""
              className={`flex flex-col items-center gap-2 border border-dashed px-4 py-8 text-center ${
                dragging ? "border-primary bg-primary-soft" : "border-border bg-background"
              }`}
            >
              <UploadCloud aria-hidden="true" className="size-6 text-muted" strokeWidth={1.5} />
              <p className="text-[13px] text-text">{t("mediaUploadDrop")}</p>
              <p className="text-[12px] text-muted">{t("mediaUploadHint")}</p>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={ACCEPT}
                className="sr-only"
                id="media-picker-files"
                aria-label={t("mediaUploadChoose")}
                disabled={!uploadsEnabled}
                onChange={(e) => onFiles(e.target.files)}
              />
              <label
                htmlFor="media-picker-files"
                className={`${mediaBtnClass} ${uploadsEnabled ? "cursor-pointer" : "pointer-events-none opacity-50"}`}
              >
                <ImagePlus aria-hidden="true" className="size-4" />
                {t("mediaUploadChoose")}
              </label>
            </div>
            {uploads.length > 0 ? (
              <ul className="divide-y divide-border border border-border" data-media-uploads="">
                {uploads.map((row) => (
                  <li key={row.id} className="flex min-h-11 flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate text-text" dir="auto">
                      {row.name}
                    </span>
                    <span
                      className={`shrink-0 text-[12px] ${
                        row.status === "rejected" || row.status === "error" ? "text-negative" : "text-muted"
                      }`}
                    >
                      {row.status === "queued" ? t("mediaUploadQueued") : null}
                      {row.status === "uploading" ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                          {t("mediaUploading")}
                        </span>
                      ) : null}
                      {row.status === "created" ? t("mediaUploaded") : null}
                      {row.status === "duplicate" ? t("mediaDuplicate") : null}
                      {row.status === "rejected" ? `${t("mediaUploadRejected")}${row.message ? ` — ${row.message}` : ""}` : null}
                      {row.status === "error" ? row.message : null}
                    </span>
                    {row.asset && row.asset.variantsState === "ready" ? (
                      <button type="button" className={mediaPrimaryBtnClass} onClick={() => onSelect(row.asset!)}>
                        {t("mediaUse")}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-0 flex-1 basis-56">
                <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("mediaSearch")}
                  aria-label={t("mediaSearch")}
                  className={`${mediaInputClass} ps-9`}
                />
              </div>
              <label className="flex min-h-11 items-center gap-2 text-[13px] text-text md:min-h-9">
                <input
                  type="checkbox"
                  checked={unused}
                  onChange={(e) => setUnused(e.target.checked)}
                  className="size-4 accent-[var(--primary)]"
                />
                {t("mediaUnusedOnly")}
              </label>
            </div>

            {state === "loading" ? (
              <p role="status" className="flex items-center gap-2 py-8 text-[13px] text-muted" data-media-loading="">
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                {t("mediaLoading")}
              </p>
            ) : null}

            {state === "forbidden" ? (
              <p role="alert" className="py-8 text-[13px] text-negative" data-media-forbidden="">
                {t("mediaForbidden")}
              </p>
            ) : null}

            {state === "error" ? (
              <div role="alert" className="flex flex-wrap items-center gap-3 py-6" data-media-error="">
                <span className="text-[13px] text-negative">{t("mediaNetworkError")}</span>
                <button type="button" className={mediaBtnClass} onClick={() => void load()}>
                  <RefreshCw aria-hidden="true" className="size-4" />
                  {t("mediaRetry")}
                </button>
              </div>
            ) : null}

            {state === "ready" && items.length === 0 ? (
              <div className="space-y-1 py-10 text-center" data-media-empty="">
                <p className="text-[14px] font-medium text-text">
                  {debounced || unused ? t("mediaNoResults") : t("mediaEmpty")}
                </p>
                {!debounced && !unused ? (
                  <p className="text-[12px] text-muted">{t("mediaEmptyHint")}</p>
                ) : null}
              </div>
            ) : null}

            {state === "ready" && items.length > 0 ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-media-grid="">
                {items.map((asset) => (
                  <MediaCard
                    key={asset.id}
                    asset={asset}
                    t={t}
                    retrying={retrying[asset.id] === true}
                    onRetry={() => void retry(asset)}
                    onRefresh={() => void load()}
                    onSelect={() => onSelect(asset)}
                  />
                ))}
              </ul>
            ) : null}

            {state === "ready" && meta?.hasMore ? (
              <div className="flex justify-center">
                <button
                  type="button"
                  className={mediaBtnClass}
                  disabled={loadingMore}
                  onClick={() => void load({ cursor: meta.nextCursor, append: true })}
                >
                  {loadingMore ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                  {t("mediaLoadMore")}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </MediaDialog>
  );
}

function MediaCard({
  asset,
  t,
  retrying,
  onRetry,
  onRefresh,
  onSelect,
}: {
  asset: StorefrontMediaAsset;
  t: T;
  retrying: boolean;
  onRetry: () => void;
  onRefresh: () => void;
  onSelect: () => void;
}) {
  const ready = asset.variantsState === "ready";
  return (
    <li className="flex min-w-0 flex-col border border-border bg-surface" data-media-card={asset.id} data-media-state={asset.variantsState}>
      <div className="relative aspect-[4/3] bg-background">
        {asset.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived workspace URL
          <img
            src={asset.thumbnailUrl}
            alt={asset.altAr || asset.altEn || ""}
            loading="lazy"
            className="size-full object-contain"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted">
            {asset.variantsState === "pending" ? (
              <Loader2 aria-hidden="true" className="size-5 animate-spin" />
            ) : (
              <AlertTriangle aria-hidden="true" className="size-5" />
            )}
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-1 p-2">
        <p className="truncate text-[12px] font-medium text-text" dir="auto" title={asset.name}>
          {asset.name}
        </p>
        <p className="text-[11px] tabular-nums text-muted" dir="ltr">
          {asset.width}×{asset.height}
          {asset.usageCount ? ` · ${t("mediaUsedIn")} ${asset.usageCount} ${t("mediaPlaces")}` : ""}
        </p>
        {asset.variantsState === "pending" ? (
          <div className="space-y-1">
            <p className="text-[11px] text-muted" role="status">{t("mediaStateProcessing")}</p>
            <button type="button" className={mediaBtnClass} onClick={onRefresh}>
              <RefreshCw aria-hidden="true" className="size-3.5" />
              {t("mediaRefresh")}
            </button>
          </div>
        ) : null}
        {asset.variantsState === "failed" ? (
          <div className="space-y-1">
            <p className="text-[11px] text-negative" role="alert">{t("mediaStateFailed")}</p>
            <button type="button" className={mediaBtnClass} disabled={retrying} onClick={onRetry}>
              {retrying ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden="true" className="size-3.5" />}
              {t("mediaRetry")}
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className={`${mediaPrimaryBtnClass} w-full`}
          disabled={!ready}
          title={ready ? undefined : t("mediaNotSelectable")}
          aria-label={`${t("mediaUse")}: ${asset.name}`}
          onClick={onSelect}
        >
          {t("mediaUse")}
        </button>
      </div>
    </li>
  );
}
