"use client";

import { useState } from "react";
import { btnClass, Field, iconBtnClass, inputClass, selectClass, Toggle } from "./ControlPanels";
import { ColourField } from "./design/ColourField";
import {
  addGroup,
  addLink,
  canAddFooterProduct,
  canAddGroup,
  canAddLink,
  canMoveGroup,
  editLink,
  moveGroup,
  newLink,
  removeGroup,
  setDesign,
  setGroups,
  setLayout,
  updateGroup,
} from "./footer-edit";
import type { CustomizerMessageKey } from "./messages";
import { NavTargetPicker, type PickedTarget } from "./NavTargetPicker";
import type { StorefrontPresentationConfig } from "./presentation/config";
import {
  FOOTER_ALIGNS,
  FOOTER_LAYOUTS,
  FOOTER_LOGO_SIZES,
  FOOTER_SPACING,
  FOOTER_TITLE_MAX,
  type FooterDesign,
  type FooterGroup,
  type FooterLayout,
  footerContrastIssues,
  normalizeFooterDesign,
  resolveFooterDesign,
} from "./presentation/footer-design";
import { NAV_LABEL_MAX, type NavTarget } from "./presentation/navigation";
import type { ColorRef } from "./presentation/section-design";
import type { DesignContext } from "./presentation/section-design-resolve";
import { StoreIcon } from "./StoreIcon";

const LAYOUT_LABEL: Record<FooterLayout, CustomizerMessageKey> = {
  compact: "footerLayoutCompact",
  columns: "footerLayoutColumns",
  centered: "footerLayoutCentered",
  editorial: "footerLayoutEditorial",
  minimal: "footerLayoutMinimal",
  "brand-heavy": "footerLayoutBrandHeavy",
};
const SPACING_LABEL = { sm: "footerSpacingSm", md: "footerSpacingMd", lg: "footerSpacingLg" } as const;
const LOGO_LABEL = { sm: "headerLogoSm", md: "headerLogoMd", lg: "headerLogoLg" } as const;
const ALIGN_LABEL = { start: "footerAlignStart", center: "footerAlignCenter", end: "footerAlignEnd" } as const;
const KIND_LABEL: Record<NavTarget["kind"], CustomizerMessageKey> = {
  home: "navTargetHome",
  category: "navTargetCategory",
  product: "navTargetProduct",
  content: "navTargetContent",
  external: "navTargetExternal",
};

type Picking = { groupId: string; linkId?: string } | null;

/**
 * CUST-HV V7e-3 — the footer's layout, link groups and design (V0 §10). Same discipline as the header editors: every change goes
 * through `footer-edit.ts` (re-normalised, so the draft never holds an invalid or empty value), targets are chosen with the
 * navigation pickers (never typed), and the colour fields show the contrast verdict live — the same one Publish enforces.
 */
export function FooterEditor({
  config,
  t,
  locale,
  storefrontId,
  patch,
}: {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  locale: "ar" | "en";
  storefrontId: string | null | undefined;
  patch: (partial: Partial<StorefrontPresentationConfig>) => void;
}) {
  const footer = config.footer;
  const groups = footer.groups;
  const design = footer.design;
  const [picking, setPicking] = useState<Picking>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const menus = config.navigation?.menus ?? [];

  const ctx: DesignContext = {
    primaryColor: config.primaryColor,
    accentColor: config.accentColor,
    palette: config.palette,
    dir: locale === "en" ? "ltr" : "rtl",
  };
  const commitGroups = (next: FooterGroup[]) => patch({ footer: setGroups(footer, next) });
  const commitDesign = (next: FooterDesign | undefined) => patch({ footer: setDesign(footer, next) });

  const issues = footerContrastIssues(design, ctx);
  const resolved = resolveFooterDesign(design, ctx);
  const status = (field: "heading" | "text" | "link") => {
    const issue = issues.find((i) => i.field === field);
    if (issue) return { tone: "bad" as const, text: `${t("designContrastFail")} ${issue.ratio.toFixed(1)}:1` };
    return design?.[field] ? { tone: "ok" as const, text: t("designContrastOk") } : null;
  };
  const setColour = (key: "heading" | "text" | "link", value: ColorRef | undefined) =>
    commitDesign(normalizeFooterDesign({ ...(design ?? {}), [key]: value }));
  const autoFor = (key: "heading" | "text" | "link", cssVar: string) =>
    !design?.[key] && resolved.style?.[cssVar] ? { hex: resolved.style[cssVar], label: t("designTextAuto") } : undefined;

  const onPick = (picked: PickedTarget) => {
    if (!picking || !groups) return;
    const { groupId, linkId } = picking;
    commitGroups(
      linkId
        ? editLink.retarget(groups, groupId, linkId, picked.target)
        : addLink(groups, groupId, newLink(picked.label, picked.target)),
    );
    setPicking(null);
  };

  const select = (
    id: string,
    label: CustomizerMessageKey,
    value: string | undefined,
    options: readonly string[],
    labels: Record<string, CustomizerMessageKey>,
    onChange: (value: string | undefined) => void,
  ) => (
    <Field label={t(label)}>
      <select className={selectClass} data-footer-design={id} value={value ?? ""} onChange={(event) => onChange(event.target.value || undefined)}>
        <option value="">{t("footerDefault")}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {t(labels[option] as CustomizerMessageKey)}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <div className="space-y-8" data-footer-editor="">
      {/* ── layout ── */}
      <div className="space-y-2">
        <h3 className="text-[12px] font-semibold tracking-wide text-muted">{t("footerLayoutTitle")}</h3>
        <p className="text-[12px] leading-5 text-muted">{t("footerLayoutHint")}</p>
        <select
          className={selectClass}
          aria-label={t("footerLayoutTitle")}
          data-footer-layout-select=""
          value={footer.layout ?? ""}
          onChange={(event) => patch({ footer: setLayout(footer, (event.target.value || undefined) as FooterLayout | undefined) })}
        >
          <option value="">{t("footerLayoutDefault")}</option>
          {FOOTER_LAYOUTS.map((layout) => (
            <option key={layout} value={layout}>
              {t(LAYOUT_LABEL[layout])}
            </option>
          ))}
        </select>
      </div>

      {/* ── groups ── */}
      <div className="space-y-3" data-footer-groups="">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[12px] font-semibold tracking-wide text-muted">{t("footerGroupsTitle")}</h3>
          <button
            type="button"
            className={`${btnClass} disabled:opacity-50`}
            disabled={!canAddGroup(groups)}
            onClick={() => commitGroups(addGroup(groups))}
          >
            {t("footerAddGroup")}
          </button>
        </div>
        <p className="text-[12px] leading-5 text-muted">{t("footerGroupsHint")}</p>
        {!canAddGroup(groups) ? (
          <p role="status" className="text-[12px] text-muted">
            {t("footerLimitGroups")}
          </p>
        ) : null}
        {!groups ? <p className="border border-border px-3 py-3 text-sm text-muted">{t("footerGroupsEmptyNote")}</p> : null}

        <ul className="space-y-3">
          {(groups ?? []).map((group) => {
            const source = group.menu ? `menu:${group.menu}` : "own";
            const menuMissing = Boolean(group.menu) && !menus.some((m) => m.id === group.menu);
            return (
              <li key={group.id} data-footer-group-card="" className="space-y-3 border border-border p-3">
                <input
                  className={inputClass}
                  aria-label={t("footerGroupTitle")}
                  placeholder={t("footerGroupTitle")}
                  maxLength={FOOTER_TITLE_MAX}
                  value={group.title}
                  onChange={(event) => commitGroups(updateGroup(groups ?? [], group.id, { title: event.target.value }))}
                />
                <Field label={t("footerGroupSource")}>
                  <select
                    className={selectClass}
                    value={menuMissing ? "own" : source}
                    onChange={(event) => {
                      const value = event.target.value;
                      commitGroups(
                        updateGroup(groups ?? [], group.id, value === "own" ? { menu: undefined } : { menu: value.slice(5), links: undefined }),
                      );
                    }}
                  >
                    <option value="own">{t("footerSourceOwn")}</option>
                    {menus.map((menu) => (
                      <option key={menu.id} value={`menu:${menu.id}`}>
                        {t("footerSourceMenu")} {menu.name.trim() || menu.id}
                      </option>
                    ))}
                  </select>
                </Field>

                {!group.menu || menuMissing ? (
                  <div className="space-y-2">
                    <ul className="border border-border">
                      {(group.links ?? []).map((link) => (
                        <li key={link.id} data-footer-link-row="" className="space-y-2 border-b border-border p-2 last:border-b-0">
                          <div className="flex items-center gap-2">
                            {link.icon ? <StoreIcon name={link.icon} /> : null}
                            <input
                              className={inputClass}
                              aria-label={t("navItemLabel")}
                              placeholder={t("navItemLabel")}
                              maxLength={NAV_LABEL_MAX}
                              value={link.label}
                              onChange={(event) =>
                                commitGroups(editLink.update(groups ?? [], group.id, link.id, { label: event.target.value }))
                              }
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                            <span className="border border-border px-1.5 py-0.5">{t(KIND_LABEL[link.target.kind])}</span>
                            {link.target.kind === "external" ? <bdi dir="ltr">{link.target.href}</bdi> : null}
                            <button type="button" className={btnClass} onClick={() => setPicking({ groupId: group.id, linkId: link.id })}>
                              {t("navChangeTarget")}
                            </button>
                          </div>
                          {picking?.groupId === group.id && picking.linkId === link.id ? (
                            <NavTargetPicker
                              storefrontId={storefrontId}
                              t={t}
                              allowProduct={canAddFooterProduct(groups) || link.target.kind === "product"}
                              onPick={onPick}
                              onCancel={() => setPicking(null)}
                            />
                          ) : null}
                          <div className="flex flex-wrap items-center gap-1">
                            <Toggle
                              compact
                              label={t("sectionVisible")}
                              checked={link.enabled}
                              onChange={(enabled) => commitGroups(editLink.update(groups ?? [], group.id, link.id, { enabled }))}
                            />
                            <span className="ms-auto flex">
                              <button
                                type="button"
                                className={iconBtnClass}
                                aria-label={t("moveUp")}
                                onClick={() => commitGroups(editLink.move(groups ?? [], group.id, link.id, -1))}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className={iconBtnClass}
                                aria-label={t("moveDown")}
                                onClick={() => commitGroups(editLink.move(groups ?? [], group.id, link.id, 1))}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                className={`${iconBtnClass} w-auto px-1.5`}
                                onClick={() => commitGroups(editLink.remove(groups ?? [], group.id, link.id))}
                              >
                                {t("navRemove")}
                              </button>
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {!canAddLink(group) ? (
                      <p role="status" className="text-[12px] text-muted">
                        {t("footerLimitLinks")}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className={`${btnClass} disabled:opacity-50`}
                      disabled={!canAddLink(group)}
                      onClick={() => setPicking({ groupId: group.id })}
                    >
                      {t("footerAddLink")}
                    </button>
                    {picking?.groupId === group.id && !picking.linkId ? (
                      <NavTargetPicker
                        storefrontId={storefrontId}
                        t={t}
                        allowProduct={canAddFooterProduct(groups)}
                        onPick={onPick}
                        onCancel={() => setPicking(null)}
                      />
                    ) : null}
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-2">
                  <select
                    className={selectClass}
                    aria-label={t("footerGroupWidth")}
                    value={String(group.span ?? 1)}
                    onChange={(event) =>
                      commitGroups(updateGroup(groups ?? [], group.id, { span: event.target.value === "2" ? 2 : undefined }))
                    }
                  >
                    <option value="1">{t("footerGroupWidthOne")}</option>
                    <option value="2">{t("footerGroupWidthTwo")}</option>
                  </select>
                  <span className="flex items-center justify-end">
                    <button
                      type="button"
                      className={iconBtnClass}
                      aria-label={t("moveUp")}
                      disabled={!canMoveGroup(groups ?? [], group.id, -1)}
                      onClick={() => commitGroups(moveGroup(groups ?? [], group.id, -1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={iconBtnClass}
                      aria-label={t("moveDown")}
                      disabled={!canMoveGroup(groups ?? [], group.id, 1)}
                      onClick={() => commitGroups(moveGroup(groups ?? [], group.id, 1))}
                    >
                      ↓
                    </button>
                    {confirmRemove === group.id ? (
                      <>
                        <button
                          type="button"
                          className={`${iconBtnClass} w-auto px-1.5 text-negative`}
                          onClick={() => {
                            setConfirmRemove(null);
                            commitGroups(removeGroup(groups ?? [], group.id));
                          }}
                        >
                          {t("footerRemoveGroup")}
                        </button>
                        <button type="button" className={`${iconBtnClass} w-auto px-1.5`} onClick={() => setConfirmRemove(null)}>
                          {t("navCancel")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={`${iconBtnClass} w-auto px-1.5`}
                        onClick={() =>
                          group.links?.length ? setConfirmRemove(group.id) : commitGroups(removeGroup(groups ?? [], group.id))
                        }
                      >
                        {t("footerRemoveGroup")}
                      </button>
                    )}
                  </span>
                </div>
                {confirmRemove === group.id ? (
                  <p role="alert" className="text-[12px] text-negative">
                    {t("navRemoveConfirm")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      {/* ── design ── */}
      <div className="space-y-4" data-footer-design-panel="">
        <div className="space-y-1">
          <h3 className="text-[12px] font-semibold tracking-wide text-muted">{t("footerDesignTitle")}</h3>
          <p className="text-[12px] leading-5 text-muted">{t("footerDesignHint")}</p>
        </div>
        <ColourField
          dataName="footer-bg"
          label={t("footerBgColour")}
          value={design?.surface?.background}
          ctx={ctx}
          t={t}
          onChange={(background) => commitDesign(normalizeFooterDesign({ ...(design ?? {}), surface: background ? { background } : undefined }))}
        />
        <ColourField
          dataName="footer-heading"
          label={t("footerHeadingColour")}
          value={design?.heading}
          ctx={ctx}
          t={t}
          automatic={autoFor("heading", "--store-footer-foreground")}
          status={status("heading")}
          suggestion={issues.some((i) => i.field === "heading") ? { label: t("headerColourUseDefault"), onApply: () => setColour("heading", undefined) } : null}
          onChange={(next) => setColour("heading", next)}
        />
        <ColourField
          dataName="footer-text"
          label={t("footerTextColour")}
          value={design?.text}
          ctx={ctx}
          t={t}
          automatic={autoFor("text", "--store-footer-muted")}
          status={status("text")}
          suggestion={issues.some((i) => i.field === "text") ? { label: t("headerColourUseDefault"), onApply: () => setColour("text", undefined) } : null}
          onChange={(next) => setColour("text", next)}
        />
        <ColourField
          dataName="footer-link"
          label={t("footerLinkColour")}
          value={design?.link}
          ctx={ctx}
          t={t}
          automatic={autoFor("link", "--store-footer-link")}
          status={status("link")}
          suggestion={issues.some((i) => i.field === "link") ? { label: t("headerColourUseDefault"), onApply: () => setColour("link", undefined) } : null}
          onChange={(next) => setColour("link", next)}
        />
        <ColourField
          dataName="footer-divider"
          label={t("footerDividerColour")}
          value={design?.divider?.color}
          ctx={ctx}
          t={t}
          onChange={(color) => commitDesign(normalizeFooterDesign({ ...(design ?? {}), divider: color ? { color } : undefined }))}
        />
        {select("spacing-top", "footerSpacingTop", design?.spacing?.top, FOOTER_SPACING, SPACING_LABEL, (value) =>
          commitDesign(normalizeFooterDesign({ ...(design ?? {}), spacing: { ...(design?.spacing ?? {}), top: value } })),
        )}
        {select("spacing-bottom", "footerSpacingBottom", design?.spacing?.bottom, FOOTER_SPACING, SPACING_LABEL, (value) =>
          commitDesign(normalizeFooterDesign({ ...(design ?? {}), spacing: { ...(design?.spacing ?? {}), bottom: value } })),
        )}
        {select("logo-size", "footerLogoSize", design?.logo?.size, FOOTER_LOGO_SIZES, LOGO_LABEL, (value) =>
          commitDesign(normalizeFooterDesign({ ...(design ?? {}), logo: value ? { size: value } : undefined })),
        )}
        {select("align", "footerAlign", design?.align, FOOTER_ALIGNS, ALIGN_LABEL, (value) =>
          commitDesign(normalizeFooterDesign({ ...(design ?? {}), align: value })),
        )}
      </div>
    </div>
  );
}
