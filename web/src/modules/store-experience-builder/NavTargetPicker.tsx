"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listWorkspaceCategories } from "@/modules/commerce-workspace/workspace-categories";
import { listWorkspaceProducts } from "@/modules/commerce-workspace/workspace-products";
import { btnClass, inputClass } from "./ControlPanels";
import type { CustomizerMessageKey } from "./messages";
import { isServedContentSlug, type NavTarget } from "./presentation/navigation";
import { sanitizeExternalUrl } from "./presentation/urls";
import { CONTENT_PAGE_SLUGS, type ContentPageSlug } from "./presentation/tokens";

type Kind = NavTarget["kind"];

const KIND_LABEL: Record<Kind, CustomizerMessageKey> = {
  home: "navTargetHome",
  category: "navTargetCategory",
  product: "navTargetProduct",
  content: "navTargetContent",
  external: "navTargetExternal",
};

const CONTENT_LABEL: Record<ContentPageSlug, CustomizerMessageKey> = {
  about: "navContentAbout",
  contact: "navContentContact",
  faq: "navContentFaq",
  "shipping-policy": "navContentShipping",
  "privacy-policy": "navContentPrivacy",
  "returns-policy": "navContentReturns",
  "terms-of-service": "navContentTerms",
};

/** The picker's result: a typed target plus a human label to prefill the item with (the merchant can edit it). */
export interface PickedTarget {
  target: NavTarget;
  label: string;
}

interface Row {
  id: string;
  name: string;
  hint: string | null;
}

type ListState = "loading" | "ready" | "error";

/**
 * CUST-HV V7d-4 — the one place a navigation target is chosen (V0 §11.2: pickers, never raw internal href entry).
 * Category / product lists are read through the workspace endpoints with a debounced search; every response is
 * checked against a request token so a slow earlier query can never overwrite a newer one (stale-response guard),
 * and unmount aborts the in-flight read.
 */
export function NavTargetPicker({
  storefrontId,
  t,
  allowProduct,
  onPick,
  onCancel,
}: {
  storefrontId: string | null | undefined;
  t: (key: CustomizerMessageKey) => string;
  /** `false` once the menu has reached its product-target budget. */
  allowProduct: boolean;
  onPick: (picked: PickedTarget) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<Kind>("home");
  const root = useRef<HTMLDivElement>(null);
  // The picker takes focus when it opens, so Escape and Tab work from the keyboard without a prior click.
  useEffect(() => {
    root.current?.focus();
  }, []);
  const kinds: Kind[] = ["home", "category", "product", "content", "external"];

  return (
    <div
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-label={t("navPickerTitle")}
      data-nav-picker=""
      className="space-y-3 border border-border bg-surface p-3 outline-none"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("navPickerTitle")}>
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            disabled={k === "product" && !allowProduct}
            onClick={() => setKind(k)}
            className={`${btnClass} ${kind === k ? "!border-primary !bg-primary/10" : ""} disabled:opacity-50`}
          >
            {t(KIND_LABEL[k])}
          </button>
        ))}
      </div>

      {kind === "home" ? (
        <button
          type="button"
          className={btnClass}
          onClick={() => onPick({ target: { kind: "home" }, label: t("navTargetHome") })}
        >
          {t("navTargetHome")}
        </button>
      ) : null}

      {kind === "category" || kind === "product" ? (
        <EntityList key={kind} kind={kind} storefrontId={storefrontId} t={t} onPick={onPick} />
      ) : null}

      {kind === "content" ? (
        <ul className="divide-y divide-border border border-border">
          {CONTENT_PAGE_SLUGS.map((slug) => {
            const served = isServedContentSlug(slug);
            return (
              <li key={slug}>
                <button
                  type="button"
                  disabled={!served}
                  onClick={() =>
                    onPick({ target: { kind: "content", slug }, label: t(CONTENT_LABEL[slug]) })
                  }
                  className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-start text-sm hover:bg-surface-muted disabled:cursor-not-allowed disabled:text-muted"
                >
                  <span>{t(CONTENT_LABEL[slug])}</span>
                  {served ? null : (
                    <span className="text-[11px] text-muted">{t("navContentUnavailable")}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {kind === "external" ? <ExternalForm t={t} onPick={onPick} /> : null}

      <div className="flex justify-end">
        <button type="button" className={btnClass} onClick={onCancel}>
          {t("navCancel")}
        </button>
      </div>
    </div>
  );
}

function ExternalForm({
  t,
  onPick,
}: {
  t: (key: CustomizerMessageKey) => string;
  onPick: (picked: PickedTarget) => void;
}) {
  const [value, setValue] = useState("");
  const [newTab, setNewTab] = useState(true);
  const [touched, setTouched] = useState(false);
  const href = sanitizeExternalUrl(value.trim());
  const invalid = touched && !href;
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (!href) return;
        let host = href;
        try {
          host = new URL(href).host;
        } catch {
          /* keep the full href as the label */
        }
        onPick({
          target: newTab ? { kind: "external", href, newTab: true } : { kind: "external", href },
          label: host,
        });
      }}
    >
      <label className="block space-y-1">
        <span className="block text-[12px] font-medium text-muted">{t("navExternalUrl")}</span>
        <input
          dir="ltr"
          inputMode="url"
          className={inputClass}
          placeholder="https://"
          value={value}
          aria-invalid={invalid}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => setTouched(true)}
        />
      </label>
      {invalid ? (
        <p role="alert" className="text-[12px] text-negative">
          {t("navExternalInvalid")}
        </p>
      ) : null}
      <label className="flex min-h-8 items-center gap-2 text-[13px]">
        <input type="checkbox" checked={newTab} onChange={(event) => setNewTab(event.target.checked)} />
        {t("navExternalNewTab")}
      </label>
      <button type="submit" className={btnClass}>
        {t("navExternalUse")}
      </button>
    </form>
  );
}

function EntityList({
  kind,
  storefrontId,
  t,
  onPick,
}: {
  kind: "category" | "product";
  storefrontId: string | null | undefined;
  t: (key: CustomizerMessageKey) => string;
  onPick: (picked: PickedTarget) => void;
}) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState<ListState>("loading");
  const [hasMore, setHasMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const token = useRef(0);

  const load = useCallback(
    async (query: string, signal: AbortSignal, mine: number) => {
      if (!storefrontId) {
        setState("error");
        return;
      }
      setState("loading");
      const params = { search: query || undefined, perPage: 30 };
      const res =
        kind === "category"
          ? await listWorkspaceCategories(storefrontId, params, signal)
          : await listWorkspaceProducts(storefrontId, params, signal);
      if (mine !== token.current) return; // a newer query owns the list now
      if (!res.ok) {
        setRows([]);
        setState("error");
        return;
      }
      setRows(
        res.data.map((row) => ({
          id: row.id,
          name: row.name,
          hint: "parentName" in row ? (row.parentName as string | null) : null,
        })),
      );
      setHasMore(res.hasMore);
      setState("ready");
    },
    [kind, storefrontId],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `retry` re-runs the same query on demand
  useEffect(() => {
    const controller = new AbortController();
    const mine = ++token.current;
    const timer = setTimeout(() => void load(search.trim(), controller.signal, mine), search ? 250 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, load, retry]);

  return (
    <div className="space-y-2">
      <input
        type="search"
        className={inputClass}
        placeholder={t("navPickerSearch")}
        aria-label={t("navPickerSearch")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div
        role="listbox"
        aria-label={t(kind === "category" ? "navTargetCategory" : "navTargetProduct")}
        className="max-h-56 overflow-y-auto border border-border"
      >
        {state === "loading" ? <p className="px-3 py-3 text-sm text-muted">{t("navPickerLoading")}</p> : null}
        {state === "error" ? (
          <div className="flex items-center justify-between gap-2 px-3 py-3 text-sm">
            <span role="alert">{t("navPickerError")}</span>
            <button type="button" className={btnClass} onClick={() => setRetry((n) => n + 1)}>
              {t("navPickerRetry")}
            </button>
          </div>
        ) : null}
        {state === "ready" && rows.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted">{t("navPickerEmpty")}</p>
        ) : null}
        {state === "ready"
          ? rows.map((row) => (
              <button
                key={row.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() =>
                  onPick({
                    target: { kind, id: row.id },
                    label: row.name,
                  })
                }
                className="flex min-h-11 w-full flex-col items-start justify-center px-3 text-start text-sm hover:bg-surface-muted"
              >
                <span>{row.name}</span>
                {row.hint ? <span className="text-[11px] text-muted">{row.hint}</span> : null}
              </button>
            ))
          : null}
      </div>
      {state === "ready" && hasMore ? <p className="text-[12px] text-muted">{t("navPickerMore")}</p> : null}
    </div>
  );
}
