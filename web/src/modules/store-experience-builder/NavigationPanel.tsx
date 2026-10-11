"use client";

import { useState } from "react";
import { btnClass, iconBtnClass, inputClass, selectClass, Toggle } from "./ControlPanels";
import { NavTargetPicker, type PickedTarget } from "./NavTargetPicker";
import {
  addItem,
  canAddProduct,
  canAddTopLevel,
  canIndent,
  canMove,
  canOutdent,
  emptyMainMenu,
  hasChildren,
  indentItem,
  isServedContentSlug,
  moveItem,
  newItem,
  outdentItem,
  removeItem,
  setTarget,
  updateItem,
  withMainMenu,
} from "./navigation-edit";
import type { CustomizerMessageKey } from "./messages";
import { ICON_KEYS, type IconKey, iconLabel, normalizeIconKey } from "./presentation/icon-registry";
import {
  NAV_BADGE_TEXT_MAX,
  NAV_LABEL_MAX,
  type NavItem,
  type NavMenu,
  type NavTarget,
  type NavigationDoc,
  mainMenu,
} from "./presentation/navigation";
import { StoreIcon } from "./StoreIcon";
import { type NavTargetNames, useNavTargetNames } from "./use-nav-target-names";

const KIND_LABEL: Record<NavTarget["kind"], CustomizerMessageKey> = {
  home: "navTargetHome",
  category: "navTargetCategory",
  product: "navTargetProduct",
  content: "navTargetContent",
  external: "navTargetExternal",
};

/** Why an item will not show on the store, or `null` when it will. Mirrors the storefront resolver. */
export function itemProblem(
  item: NavItem,
  names: NavTargetNames,
): CustomizerMessageKey | null {
  if (item.enabled && item.label.trim() === "") return "navLabelEmpty";
  const { target } = item;
  if (target.kind === "content" && !isServedContentSlug(target.slug)) return "navTargetUnserved";
  if (names.state !== "ready") return null; // unknown ≠ missing
  if (target.kind === "product" && !names.products.has(target.id)) return "navTargetMissing";
  if (target.kind === "category" && names.categoriesComplete && !names.categories.has(target.id)) {
    return "navTargetMissing";
  }
  return null;
}

type Picking = { mode: "add" } | { mode: "retarget"; id: string } | null;

/**
 * CUST-HV V7d-4 — the `main` header-menu editor (V0 §11.2): a keyboard-complete tree (↑ ↓, "Make child ↴" /
 * "Move out ↰" buttons as the non-drag alternative), enable/disable, remove (with a confirmation only when the item
 * has children), icon and badge, and pickers for the target. All edits are pure operations from `navigation-edit.ts`;
 * this component only decides what to show and disables a control the operation would refuse.
 */
export function NavigationPanel({
  navigation,
  storefrontId,
  locale,
  t,
  onChange,
}: {
  navigation: NavigationDoc | undefined;
  storefrontId: string | null | undefined;
  locale: "ar" | "en";
  t: (key: CustomizerMessageKey) => string;
  onChange: (next: NavigationDoc) => void;
}) {
  const menu = mainMenu(navigation) ?? emptyMainMenu();
  const names = useNavTargetNames(storefrontId, menu);
  const [picking, setPicking] = useState<Picking>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const commit = (next: NavMenu) => {
    if (next !== menu) onChange(withMainMenu(navigation, next));
  };

  const onPick = (picked: PickedTarget) => {
    if (!picking) return;
    if (picking.mode === "add") {
      commit(addItem(menu, newItem(picked.label, picked.target)));
    } else {
      commit(setTarget(menu, picking.id, picked.target));
    }
    setPicking(null);
  };

  const rows: Array<{ item: NavItem; child: boolean }> = menu.items.flatMap((item) => [
    { item, child: false },
    ...(item.children ?? []).map((c) => ({ item: c, child: true })),
  ]);

  return (
    <div className="space-y-3" data-nav-panel-editor="">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold tracking-wide text-muted">{t("navMenuTitle")}</span>
          <button
            type="button"
            className={`${btnClass} disabled:opacity-50`}
            disabled={!canAddTopLevel(menu)}
            onClick={() => setPicking({ mode: "add" })}
          >
            {t("navAddItem")}
          </button>
        </div>
        <p className="text-[12px] leading-5 text-muted">{t("navMenuHint")}</p>
        {!canAddTopLevel(menu) ? (
          <p role="status" className="text-[12px] text-muted">
            {t("navLimitItems")}
          </p>
        ) : null}
        {!canAddProduct(menu) ? (
          <p role="status" className="text-[12px] text-muted">
            {t("navLimitProducts")}
          </p>
        ) : null}
      </div>

      {picking?.mode === "add" ? (
        <NavTargetPicker
          storefrontId={storefrontId}
          t={t}
          allowProduct={canAddProduct(menu)}
          onPick={onPick}
          onCancel={() => setPicking(null)}
        />
      ) : null}

      {rows.length === 0 ? <p className="border border-border px-3 py-4 text-sm text-muted">{t("navEmpty")}</p> : null}

      <ul className="border border-border" aria-label={t("navMenuTitle")}>
        {rows.map(({ item, child }) => {
          const problem = itemProblem(item, names);
          const resolvedName =
            item.target.kind === "category"
              ? names.categories.get(item.target.id)
              : item.target.kind === "product"
                ? names.products.get(item.target.id)
                : undefined;
          const icon = normalizeIconKey(item.icon);
          return (
            <li
              key={item.id}
              data-nav-row=""
              data-nav-child-row={child ? "" : undefined}
              className={`space-y-2 border-b border-border p-3 last:border-b-0 ${child ? "ms-5 border-s-2" : ""}`}
            >
              <div className="flex items-center gap-2">
                {icon ? <StoreIcon name={icon} /> : null}
                <input
                  className={inputClass}
                  aria-label={t("navItemLabel")}
                  placeholder={t("navItemLabel")}
                  maxLength={NAV_LABEL_MAX}
                  value={item.label}
                  onChange={(event) => commit(updateItem(menu, item.id, { label: event.target.value }))}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                <span className="border border-border px-1.5 py-0.5">{t(KIND_LABEL[item.target.kind])}</span>
                {resolvedName ? <bdi>{resolvedName}</bdi> : null}
                {item.target.kind === "external" ? <bdi dir="ltr">{item.target.href}</bdi> : null}
                <button
                  type="button"
                  className={btnClass}
                  onClick={() => setPicking({ mode: "retarget", id: item.id })}
                >
                  {t("navChangeTarget")}
                </button>
              </div>

              {problem ? (
                <p role="status" data-nav-problem={problem} className="text-[12px] leading-5 text-warning">
                  {t(problem)}
                </p>
              ) : null}

              {picking?.mode === "retarget" && picking.id === item.id ? (
                <NavTargetPicker
                  storefrontId={storefrontId}
                  t={t}
                  allowProduct={canAddProduct(menu) || item.target.kind === "product"}
                  onPick={onPick}
                  onCancel={() => setPicking(null)}
                />
              ) : null}

              <details open={Boolean(icon || item.badge)} data-nav-appearance="" className="group/details">
                <summary className="min-h-8 cursor-pointer select-none text-[12px] font-medium text-muted">
                  {t("navAppearance")}
                </summary>
                <div className="mt-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <select
                  className={selectClass}
                  aria-label={t("navItemIcon")}
                  value={icon ?? ""}
                  onChange={(event) =>
                    commit(updateItem(menu, item.id, { icon: normalizeIconKey(event.target.value) }))
                  }
                >
                  <option value="">{t("navIconNone")}</option>
                  {ICON_KEYS.map((key: IconKey) => (
                    <option key={key} value={key}>
                      {iconLabel(key, locale)}
                    </option>
                  ))}
                </select>
                <input
                  className={inputClass}
                  aria-label={t("navBadgeText")}
                  placeholder={t("navBadgeText")}
                  maxLength={NAV_BADGE_TEXT_MAX}
                  value={item.badge?.text ?? ""}
                  onChange={(event) => {
                    const text = event.target.value;
                    commit(
                      updateItem(menu, item.id, {
                        badge: text.trim() ? { text, ...(item.badge?.tone ? { tone: item.badge.tone } : {}) } : undefined,
                      }),
                    );
                  }}
                />
              </div>
              {item.badge ? (
                <select
                  className={selectClass}
                  aria-label={t("navBadgeTone")}
                  value={item.badge.tone ?? "brand"}
                  onChange={(event) =>
                    commit(
                      updateItem(menu, item.id, {
                        badge: { text: item.badge?.text ?? "", tone: event.target.value === "accent" ? "accent" : "brand" },
                      }),
                    )
                  }
                >
                  <option value="brand">{t("navToneBrand")}</option>
                  <option value="accent">{t("navToneAccent")}</option>
                </select>
              ) : null}

                </div>
              </details>

              {hasChildren(item) ? (
                <Toggle
                  compact
                  label={t("navShowAsDropdown")}
                  checked={item.presentation?.kind !== "link"}
                  onChange={(on) =>
                    commit(updateItem(menu, item.id, { presentation: { kind: on ? "dropdown" : "link" } }))
                  }
                />
              ) : null}

              <div className="flex flex-wrap items-center gap-1">
                <Toggle
                  compact
                  label={t("sectionVisible")}
                  checked={item.enabled}
                  onChange={(enabled) => commit(updateItem(menu, item.id, { enabled }))}
                />
                <span className="ms-auto flex flex-wrap">
                  <button
                    type="button"
                    className={iconBtnClass}
                    aria-label={t("moveUp")}
                    disabled={!canMove(menu, item.id, -1)}
                    onClick={() => commit(moveItem(menu, item.id, -1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={iconBtnClass}
                    aria-label={t("moveDown")}
                    disabled={!canMove(menu, item.id, 1)}
                    onClick={() => commit(moveItem(menu, item.id, 1))}
                  >
                    ↓
                  </button>
                  {child ? (
                    <button
                      type="button"
                      className={`${iconBtnClass} w-auto px-1.5`}
                      disabled={!canOutdent(menu, item.id)}
                      onClick={() => commit(outdentItem(menu, item.id))}
                    >
                      {t("navMoveOut")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`${iconBtnClass} w-auto px-1.5`}
                      disabled={!canIndent(menu, item.id)}
                      onClick={() => commit(indentItem(menu, item.id))}
                    >
                      {t("navMakeChild")}
                    </button>
                  )}
                  {confirmRemove === item.id ? (
                    <>
                      <button
                        type="button"
                        className={`${iconBtnClass} w-auto px-1.5 text-negative`}
                        onClick={() => {
                          setConfirmRemove(null);
                          commit(removeItem(menu, item.id));
                        }}
                      >
                        {t("navRemove")}
                      </button>
                      <button
                        type="button"
                        className={`${iconBtnClass} w-auto px-1.5`}
                        onClick={() => setConfirmRemove(null)}
                      >
                        {t("navCancel")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={`${iconBtnClass} w-auto px-1.5`}
                      onClick={() => (hasChildren(item) ? setConfirmRemove(item.id) : commit(removeItem(menu, item.id)))}
                    >
                      {t("navRemove")}
                    </button>
                  )}
                </span>
              </div>
              {confirmRemove === item.id ? (
                <p role="alert" className="text-[12px] text-negative">
                  {t("navRemoveConfirm")}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
