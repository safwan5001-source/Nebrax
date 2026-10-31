"use client";

import {
  CircleAlert,
  CircleCheck,
  ClipboardPaste,
  Loader2,
  Search,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCart } from "@/contexts/CartContext";
import {
  eligibleEntries,
  mergeEntry,
  parsePastedRows,
  QUICK_ORDER_MAX_LINES,
  QUICK_ORDER_MAX_QUANTITY,
  type QuickOrderEntry,
  type QuickOrderLine,
  quantityError,
  quantityValue,
  submitItems,
} from "@/lib/commerce/quick-order";
import { formatBuyerMoney } from "@/lib/commerce/wholesale-buyer";
import {
  addQuickOrderLines,
  type QuickOrderAccess,
  resolveQuickOrderSkus,
  searchQuickOrder,
} from "@/lib/data/wholesale-buyer";

type Notice =
  | { kind: "none" }
  | { kind: "access"; access: QuickOrderAccess["kind"] }
  | { kind: "error" }
  | { kind: "added"; count: number }
  | { kind: "rejected" };

type PasteIssue = { sku: string; kind: "not_found" | "ambiguous" };

const SEARCH_DELAY_MS = 300;

/**
 * Native wholesale quick order: find lines by SKU or name (variant SKUs included), set quantities, review what is
 * unavailable or invalid, then add every eligible line to the buyer's cart in one all-or-nothing request. Prices shown are the
 * server's approved wholesale prices (nothing is computed or submitted from here); the cart and checkout re-price everything.
 */
export function QuickOrder({ basePath }: { basePath: string }) {
  const t = useTranslations("wholesaleBuyer.quickOrder");
  const locale = useLocale();
  const { refreshCart, openCart } = useCart();
  const seq = useId();

  const [entries, setEntries] = useState<QuickOrderEntry[]>([]);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<QuickOrderLine[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [pasted, setPasted] = useState("");
  const [pasteIssues, setPasteIssues] = useState<PasteIssue[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [notice, setNotice] = useState<Notice>({ kind: "none" });
  const [rejected, setRejected] = useState<Record<string, string>>({});
  // explicit in-flight flag (not a React transition): the buttons must re-enable the moment a server action settles
  const [pending, setPending] = useState(false);
  const counter = useRef(0);
  const latestSearch = useRef(0);

  const nextId = () => `${seq}-${counter.current++}`;

  // debounced catalogue search (≥ 2 characters); a stale response never overwrites a newer one
  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const ticket = ++latestSearch.current;
    const timer = setTimeout(async () => {
      const outcome = await searchQuickOrder(q);
      if (ticket !== latestSearch.current) return;
      setSearching(false);
      if (outcome.kind === "ok") {
        setResults(outcome.lines);
        return;
      }
      setResults(null);
      setNotice(
        outcome.kind === "unavailable"
          ? { kind: "error" }
          : { kind: "access", access: outcome.kind },
      );
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const addLine = (line: QuickOrderLine, quantity = "1") => {
    setNotice({ kind: "none" });
    setRejected({});
    setEntries((prev) =>
      prev.length >= QUICK_ORDER_MAX_LINES &&
      !prev.some(
        (e) =>
          e.line.productId === line.productId &&
          e.line.variantId === line.variantId &&
          e.line.unitKey === line.unitKey,
      )
        ? prev
        : mergeEntry(prev, { id: nextId(), line, quantity }),
    );
  };

  const importPasted = () => {
    const { rows, truncated: cut } = parsePastedRows(pasted);
    setTruncated(cut);
    setPasteIssues([]);
    if (rows.length === 0 || pending) return;
    setPending(true);
    void (async () => {
      try {
        const outcome = await resolveQuickOrderSkus(rows.map((r) => r.sku));
        if (outcome.kind !== "ok") {
          setNotice(
            outcome.kind === "unavailable"
              ? { kind: "error" }
              : { kind: "access", access: outcome.kind },
          );
          return;
        }
        const issues: PasteIssue[] = [];
        const additions: QuickOrderEntry[] = [];
        rows.forEach((row, i) => {
          const lines = outcome.rows[i]?.lines ?? [];
          if (lines.length === 0) {
            issues.push({ sku: row.sku, kind: "not_found" });
          } else if (lines.length > 1) {
            // a variant-managed parent SKU: the buyer must choose a variant — hand the candidates to the picker
            issues.push({ sku: row.sku, kind: "ambiguous" });
            setTerm(row.sku);
            setResults(lines);
          } else {
            additions.push({
              id: nextId(),
              line: lines[0],
              quantity: row.quantity,
            });
          }
        });
        setEntries((prev) =>
          additions
            .reduce<QuickOrderEntry[]>(mergeEntry, prev)
            .slice(0, QUICK_ORDER_MAX_LINES),
        );
        setPasteIssues(issues);
        setRejected({});
        setNotice({ kind: "none" });
        if (issues.length === 0) setPasted("");
      } finally {
        setPending(false);
      }
    })();
  };

  const setQuantity = (id: string, quantity: string) => {
    setRejected({});
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, quantity } : e)),
    );
  };

  const remove = (id: string) =>
    setEntries((prev) => prev.filter((e) => e.id !== id));

  const eligible = eligibleEntries(entries);
  const total = eligible.reduce(
    (sum, e) =>
      sum + (e.line.price?.amountMinor ?? 0) * quantityValue(e.quantity),
    0,
  );
  const currency = eligible[0]?.line.price?.currency ?? "SAR";

  const submit = () => {
    if (eligible.length === 0 || pending) return;
    setNotice({ kind: "none" });
    setRejected({});
    setPending(true);
    const submitted = eligible;
    void (async () => {
      try {
        const result = await addQuickOrderLines(submitItems(submitted));
        if (result.kind === "ok") {
          const ids = new Set(submitted.map((e) => e.id));
          setEntries((prev) => prev.filter((e) => !ids.has(e.id)));
          setNotice({ kind: "added", count: submitted.length });
          await refreshCart();
          openCart();
          return;
        }
        if (result.kind === "rejected") {
          const byEntry: Record<string, string> = {};
          for (const failure of result.failures) {
            const entry = submitted[failure.index];
            if (entry) byEntry[entry.id] = failure.reason;
          }
          setRejected(byEntry);
          setNotice({ kind: "rejected" });
          return;
        }
        setNotice(
          result.kind === "unavailable"
            ? { kind: "error" }
            : { kind: "access", access: result.kind },
        );
      } catch {
        setNotice({ kind: "error" });
      } finally {
        setPending(false);
      }
    })();
  };

  const lineName = (line: QuickOrderLine) =>
    locale.startsWith("en") && line.nameEn ? line.nameEn : line.name;

  const reasonText = (reason: string | null) =>
    reason === "no_wholesale_price" || reason === "unavailable_for_wholesale"
      ? t("reason.noWholesalePrice")
      : t("reason.notPurchasable");

  const qtyMessage = (text: string) => {
    const e = quantityError(text);
    if (e === null) return null;
    return e === "too_large"
      ? t("qty.tooLarge", {
          max: QUICK_ORDER_MAX_QUANTITY.toLocaleString(locale),
        })
      : t("qty.invalid");
  };

  return (
    <StoreContainer className="py-8 sm:py-12">
      <div className="mx-auto max-w-3xl space-y-6" data-testid="quick-order">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-store-foreground sm:text-3xl">
            {t("title")}
          </h1>
          <p className="text-sm text-store-muted-foreground">{t("subtitle")}</p>
        </header>

        <section
          aria-labelledby={`${seq}-find`}
          className="space-y-3 rounded-store border border-store-border bg-store-surface p-4"
        >
          <h2
            id={`${seq}-find`}
            className="text-sm font-semibold text-store-foreground"
          >
            {t("search.title")}
          </h2>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-store-muted-foreground"
            />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t("search.placeholder")}
              aria-label={t("search.title")}
              autoComplete="off"
              inputMode="search"
              maxLength={120}
              className="ps-9"
            />
          </div>
          {searching ? (
            <p
              className="flex items-center gap-2 text-sm text-store-muted-foreground"
              role="status"
            >
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              {t("search.searching")}
            </p>
          ) : null}
          {results !== null && !searching ? (
            results.length === 0 ? (
              <p
                className="text-sm text-store-muted-foreground"
                data-testid="qo-no-results"
              >
                {t("search.none")}
              </p>
            ) : (
              <ul
                className="divide-y divide-store-border rounded-store border border-store-border"
                data-testid="qo-results"
              >
                {results.map((line) => (
                  <li
                    key={`${line.productId}-${line.variantId ?? "base"}`}
                    className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="truncate font-medium text-store-foreground">
                        {lineName(line)}
                        {line.descriptor ? ` — ${line.descriptor}` : ""}
                      </p>
                      <p className="text-xs text-store-muted-foreground">
                        <bdi>{line.sku ?? "—"}</bdi>
                        {line.available && line.price
                          ? ` · ${formatBuyerMoney(line.price.amountMinor, line.price.currency, locale)}`
                          : ` · ${reasonText(line.unavailableReason)}`}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addLine(line)}
                      data-testid="qo-pick"
                      data-sku={line.sku ?? ""}
                    >
                      {t("search.addToList")}
                    </Button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </section>

        <section
          aria-labelledby={`${seq}-paste`}
          className="space-y-3 rounded-store border border-store-border bg-store-surface p-4"
        >
          <h2
            id={`${seq}-paste`}
            className="text-sm font-semibold text-store-foreground"
          >
            {t("paste.title")}
          </h2>
          <p className="text-xs text-store-muted-foreground">
            {t("paste.hint")}
          </p>
          <Textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={4}
            dir="ltr"
            className="font-mono text-sm"
            placeholder={t("paste.placeholder")}
            aria-label={t("paste.title")}
            data-testid="qo-paste"
          />
          <Button
            type="button"
            variant="outline"
            onClick={importPasted}
            disabled={pending || pasted.trim() === ""}
            data-testid="qo-import"
          >
            <ClipboardPaste aria-hidden="true" className="size-4" />
            {t("paste.cta")}
          </Button>
          {truncated ? (
            <p className="text-sm text-amber-700" role="status">
              {t("paste.truncated", { max: QUICK_ORDER_MAX_LINES })}
            </p>
          ) : null}
          {pasteIssues.length > 0 ? (
            <ul
              className="space-y-1 text-sm text-red-700"
              data-testid="qo-paste-issues"
            >
              {pasteIssues.map((issue) => (
                <li
                  key={`${issue.kind}-${issue.sku}`}
                  className="flex items-start gap-2"
                >
                  <CircleAlert
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span>
                    <bdi>{issue.sku}</bdi> — {t(`paste.issue.${issue.kind}`)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section
          aria-labelledby={`${seq}-list`}
          className="space-y-3 rounded-store border border-store-border bg-store-surface p-4"
        >
          <h2
            id={`${seq}-list`}
            className="text-sm font-semibold text-store-foreground"
          >
            {t("list.title", { count: entries.length })}
          </h2>

          {entries.length === 0 ? (
            <p
              className="text-sm text-store-muted-foreground"
              data-testid="qo-empty"
            >
              {t("list.empty")}
            </p>
          ) : (
            <ul className="divide-y divide-store-border" data-testid="qo-list">
              {entries.map((entry) => {
                const message = qtyMessage(entry.quantity);
                const failed = rejected[entry.id];
                const blocked = !entry.line.available;
                return (
                  <li
                    key={entry.id}
                    className="space-y-2 py-3"
                    data-testid="qo-line"
                    data-sku={entry.line.sku ?? ""}
                    data-state={
                      blocked
                        ? "unavailable"
                        : message
                          ? "invalid"
                          : failed
                            ? "rejected"
                            : "ready"
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        <p className="font-medium text-store-foreground">
                          {lineName(entry.line)}
                          {entry.line.descriptor
                            ? ` — ${entry.line.descriptor}`
                            : ""}
                        </p>
                        <p className="text-xs text-store-muted-foreground">
                          <bdi>{entry.line.sku ?? "—"}</bdi>
                          {entry.line.unitName
                            ? ` · ${entry.line.unitName}`
                            : ""}
                          {entry.line.available && entry.line.price
                            ? ` · ${formatBuyerMoney(entry.line.price.amountMinor, entry.line.price.currency, locale)}`
                            : ""}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(entry.id)}
                        aria-label={t("list.remove")}
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </Button>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-sm text-store-muted-foreground">
                        <span>{t("list.quantity")}</span>
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={entry.quantity}
                          onChange={(e) =>
                            setQuantity(entry.id, e.target.value)
                          }
                          onFocus={(e) => e.currentTarget.select()}
                          aria-invalid={message ? true : undefined}
                          className="w-24"
                          data-testid="qo-qty"
                          disabled={blocked}
                        />
                      </label>
                      {entry.line.available && entry.line.price && !message ? (
                        <span className="ms-auto text-sm font-medium text-store-foreground">
                          {formatBuyerMoney(
                            entry.line.price.amountMinor *
                              quantityValue(entry.quantity),
                            entry.line.price.currency,
                            locale,
                          )}
                        </span>
                      ) : null}
                    </div>

                    {blocked ? (
                      <p
                        className="flex items-center gap-1.5 text-sm text-red-700"
                        data-testid="qo-line-note"
                      >
                        <CircleAlert aria-hidden="true" className="size-4" />
                        {reasonText(entry.line.unavailableReason)} —{" "}
                        {t("list.excluded")}
                      </p>
                    ) : message ? (
                      <p
                        className="flex items-center gap-1.5 text-sm text-red-700"
                        data-testid="qo-line-note"
                      >
                        <CircleAlert aria-hidden="true" className="size-4" />
                        {message}
                      </p>
                    ) : failed ? (
                      <p
                        className="flex items-center gap-1.5 text-sm text-red-700"
                        data-testid="qo-line-note"
                      >
                        <CircleAlert aria-hidden="true" className="size-4" />
                        {reasonText(failed)}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {notice.kind === "added" ? (
            <div
              className="flex flex-col gap-3 rounded-store border border-green-200 bg-green-50 p-3 text-sm text-green-900 sm:flex-row sm:items-center sm:justify-between"
              role="status"
              data-testid="qo-added"
            >
              <span className="flex items-center gap-2">
                <CircleCheck aria-hidden="true" className="size-4" />
                {t("notice.added", { count: notice.count })}
              </span>
              <span className="flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link href={`${basePath}/cart`}>{t("notice.viewCart")}</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href={`${basePath}/checkout`}>
                    {t("notice.checkout")}
                  </Link>
                </Button>
              </span>
            </div>
          ) : null}
          {notice.kind === "rejected" ? (
            <p
              className="flex items-start gap-2 text-sm text-red-700"
              role="alert"
              data-testid="qo-rejected"
            >
              <CircleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              {t("notice.rejected")}
            </p>
          ) : null}
          {notice.kind === "error" ? (
            <p
              className="flex items-start gap-2 text-sm text-red-700"
              role="alert"
            >
              <CircleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              {t("notice.error")}
            </p>
          ) : null}
          {notice.kind === "access" ? (
            <p
              className="text-sm text-red-700"
              role="alert"
              data-testid="qo-access"
            >
              {t(`notice.access.${notice.access}`)}{" "}
              <Link
                className="underline"
                href={`${basePath}/buyer/${notice.access === "signed_out" ? "sign-in" : "membership"}`}
              >
                {t("notice.accessCta")}
              </Link>
            </p>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-store-border pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <p className="text-store-muted-foreground">
                {t("list.eligible", {
                  eligible: eligible.length,
                  total: entries.length,
                })}
              </p>
              {eligible.length > 0 ? (
                <p
                  className="font-semibold text-store-foreground"
                  data-testid="qo-total"
                >
                  {t("list.estimate")}:{" "}
                  {formatBuyerMoney(total, currency, locale)}
                </p>
              ) : null}
              <p className="text-xs text-store-muted-foreground">
                {t("list.priceNote")}
              </p>
            </div>
            <Button
              type="button"
              onClick={submit}
              disabled={eligible.length === 0 || pending}
              className="w-full sm:w-auto"
              data-testid="qo-submit"
            >
              {pending ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <ShoppingCart aria-hidden="true" className="size-4" />
              )}
              {t("list.submit", { count: eligible.length })}
            </Button>
          </div>
        </section>
      </div>
    </StoreContainer>
  );
}
