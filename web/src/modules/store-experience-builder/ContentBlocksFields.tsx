"use client";

/**
 * CUST-HV V9c-2 — the `customContent` section's editor (V0 §15): a list of blocks (heading, paragraph, image, button, divider, spacer, callout,
 * columns) that the merchant adds, reorders, duplicates and deletes, with the selected block's own fields below the list. A `columns` block shows
 * its two columns as nested lists with their own "add" (a column holds up to four blocks and never another `columns`).
 *
 * Everything goes through the pure edits in `content-blocks-edit.ts`. The selected block is the one the Canvas rings and keeps in view
 * (`activeBlockId`); alt text per locale (or the decorative flag) is the media field's, judged at Publish by the generic media gate.
 */
import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { DeferredCommitField, Field, inputClass, Segmented, selectClass } from "./ControlPanels";
import {
  addBlock,
  allBlockIds,
  type BlockParent,
  BLOCK_KINDS,
  canAddKind,
  canDuplicate,
  findBlock,
  moveBlock,
  removeBlock,
  duplicateBlock,
  setAlign,
  setButtonHref,
  setButtonLabel,
  setButtonStyle,
  setCalloutIcon,
  setCalloutTone,
  setCaption,
  setDividerStyle,
  setHeadingLevel,
  setImageLink,
  setImageMedia,
  setSpacerSize,
  setText,
} from "./content-blocks-edit";
import { BufferedText } from "./BufferedText";
import { MediaPicker } from "./media/MediaPicker";
import { MediaRefField } from "./media/MediaRefField";
import { useMediaRefPreview } from "./media/use-media-ref-preview";
import type { CustomizerMessageKey } from "./messages";
import {
  BLOCK_ALIGNS,
  BLOCK_BUTTON_STYLES,
  BLOCK_CALLOUT_TONES,
  BLOCK_DIVIDER_STYLES,
  BLOCK_SPACER_SIZES,
  type ContentBlock,
  type ContentBlockKind,
  type ContentBlocks,
  MAX_BLOCK_CAPTION_LENGTH,
  MAX_CALLOUT_LENGTH,
  MAX_COLUMN_BLOCKS,
  MAX_CONTENT_BLOCKS,
  MAX_BLOCK_BUTTON_LABEL_LENGTH,
  MAX_HEADING_LENGTH,
  MAX_PARAGRAPH_LENGTH,
} from "./presentation/content-blocks";
import { ICON_KEYS, iconLabel, normalizeIconKey } from "./presentation/icon-registry";
import { fillTemplate } from "./slider-edit";

type T = (key: CustomizerMessageKey) => string;

const KIND_LABEL = {
  heading: "cbKindHeading",
  paragraph: "cbKindParagraph",
  image: "cbKindImage",
  button: "cbKindButton",
  divider: "cbKindDivider",
  spacer: "cbKindSpacer",
  callout: "cbKindCallout",
  columns: "cbKindColumns",
} as const satisfies Record<ContentBlockKind, CustomizerMessageKey>;

const iconButton =
  "inline-flex size-11 items-center justify-center text-muted hover:bg-background hover:text-text disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:size-8";

/** The block to select after `id` is removed: its next sibling, else the previous one, else its column's parent, else none. */
function neighbourAfterRemoval(content: ContentBlocks, id: string): string | null {
  const top = content.blocks.findIndex((block) => block.id === id);
  if (top >= 0) return (content.blocks[top + 1] ?? content.blocks[top - 1])?.id ?? null;
  for (const block of content.blocks) {
    if (block.kind !== "columns") continue;
    for (const column of block.columns) {
      const index = column.findIndex((leaf) => leaf.id === id);
      if (index >= 0) return (column[index + 1] ?? column[index - 1])?.id ?? block.id;
    }
  }
  return null;
}

export function ContentBlocksFields({
  content,
  locale,
  t,
  activeBlockId,
  onActiveBlockChange,
  onChange,
}: {
  content: ContentBlocks;
  locale: "ar" | "en";
  t: T;
  /** The block the Canvas rings; absent / unknown ⇒ the first. */
  activeBlockId: string | null;
  onActiveBlockChange: (id: string) => void;
  onChange: (content: ContentBlocks) => void;
}) {
  const [pickingFor, setPickingFor] = useState<{ parent: BlockParent } | null>(null);
  const known = new Set(allBlockIds(content));
  const firstId = content.blocks[0]?.id ?? null;
  const selectedId = activeBlockId && known.has(activeBlockId) ? activeBlockId : firstId;
  const selected = selectedId ? findBlock(content, selectedId) : null;

  const add = (kind: ContentBlockKind, parent: BlockParent) => {
    if (kind === "image") {
      setPickingFor({ parent });
      return;
    }
    const result = addBlock(content, kind, parent, { buttonLabel: t("cbButtonDefault") });
    if (!result.id) return;
    onChange(result.content);
    onActiveBlockChange(result.id);
  };
  const remove = (id: string, neighbour: string | null) => {
    onChange(removeBlock(content, id));
    if (neighbour) onActiveBlockChange(neighbour);
  };
  const duplicate = (id: string) => {
    const result = duplicateBlock(content, id);
    if (!result.id) return;
    onChange(result.content);
    onActiveBlockChange(result.id);
  };

  const rowProps = (block: ContentBlock, list: readonly ContentBlock[], parent: BlockParent) => {
    const index = list.findIndex((entry) => entry.id === block.id);
    return {
      block,
      index,
      total: list.length,
      selected: block.id === selectedId,
      canDuplicate: canDuplicate(content, block.id),
      t,
      onSelect: () => onActiveBlockChange(block.id),
      onMove: (delta: -1 | 1) => onChange(moveBlock(content, block.id, delta)),
      onDuplicate: () => duplicate(block.id),
      onRemove: () => remove(block.id, (list[index + 1] ?? list[index - 1])?.id ?? (parent?.id ?? null)),
    };
  };

  return (
    <div className="space-y-4" data-content-blocks-fields="">
      <section className="space-y-2" aria-labelledby="content-blocks-title">
        <div className="flex items-center justify-between gap-2">
          <h3 id="content-blocks-title" className="text-[12px] font-semibold tracking-wide text-muted">
            {t("cbTitle")}
          </h3>
          <span className="text-[12px] tabular-nums text-muted" data-content-blocks-count="">
            {fillTemplate(t("cbCount"), { count: content.blocks.length, max: MAX_CONTENT_BLOCKS })}
          </span>
        </div>
        {content.blocks.length === 0 ? (
          <p role="status" className="text-[12px] leading-5 text-muted" data-content-blocks-empty="">
            {t("cbEmpty")}
          </p>
        ) : null}
        <ol className="space-y-1.5" data-content-block-list="">
          {content.blocks.map((block) => (
            <li key={block.id} className="space-y-1.5">
              <BlockRow {...rowProps(block, content.blocks, null)} />
              {block.kind === "columns" ? (
                <div className="grid gap-2 ps-3 sm:grid-cols-1" data-content-columns-editor={block.id}>
                  {block.columns.map((column, columnIndex) => {
                    const parent: BlockParent = { id: block.id, column: columnIndex as 0 | 1 };
                    return (
                      <section
                        // biome-ignore lint/suspicious/noArrayIndexKey: a column is its position
                        key={columnIndex}
                        className="space-y-1.5 border-s-2 border-border ps-2"
                        aria-label={fillTemplate(t("cbColumnLabel"), { number: columnIndex + 1 })}
                        data-content-column-editor={columnIndex}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-[12px] font-medium text-muted">{fillTemplate(t("cbColumnLabel"), { number: columnIndex + 1 })}</h4>
                          <span className="text-[12px] tabular-nums text-muted">
                            {fillTemplate(t("cbCount"), { count: column.length, max: MAX_COLUMN_BLOCKS })}
                          </span>
                        </div>
                        {column.length === 0 ? <p className="text-[12px] leading-5 text-muted">{t("cbColumnEmpty")}</p> : null}
                        <ol className="space-y-1.5">
                          {column.map((leaf) => (
                            <li key={leaf.id}>
                              <BlockRow {...rowProps(leaf, column, parent)} />
                            </li>
                          ))}
                        </ol>
                        <AddBlock content={content} parent={parent} t={t} onAdd={(kind) => add(kind, parent)} />
                      </section>
                    );
                  })}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        <AddBlock content={content} parent={null} t={t} onAdd={(kind) => add(kind, null)} />
        <MediaPicker
          open={pickingFor !== null}
          onClose={() => setPickingFor(null)}
          onSelect={(asset) => {
            const parent = pickingFor?.parent ?? null;
            setPickingFor(null);
            const result = addBlock(content, "image", parent, { media: { mediaId: asset.id } });
            if (!result.id) return;
            onChange(result.content);
            onActiveBlockChange(result.id);
          }}
          t={t}
          locale={locale}
        />
      </section>

      {selected ? (
        <section
          key={selected.id}
          className="space-y-3 border-t border-border pt-3"
          data-content-block-editor={selected.id}
          data-kind={selected.kind}
          aria-label={t(KIND_LABEL[selected.kind])}
        >
          <h3 className="text-[13px] font-semibold text-text">{t(KIND_LABEL[selected.kind])}</h3>
          <BlockEditor
            block={selected}
            content={content}
            locale={locale}
            t={t}
            onChange={onChange}
            onRemove={() => remove(selected.id, neighbourAfterRemoval(content, selected.id))}
          />
        </section>
      ) : null}
    </div>
  );
}

function AddBlock({
  content,
  parent,
  t,
  onAdd,
}: {
  content: ContentBlocks;
  parent: BlockParent;
  t: T;
  onAdd: (kind: ContentBlockKind) => void;
}) {
  const kinds = BLOCK_KINDS.filter((kind) => canAddKind(content, kind, parent));
  const full = !canAddKind(content, "paragraph", parent);
  return (
    <div className="space-y-1">
      <select
        className={selectClass}
        data-content-add-block={parent ? `${parent.id}:${parent.column}` : "top"}
        aria-label={t("cbAdd")}
        disabled={full}
        value=""
        onChange={(event) => {
          const kind = event.target.value as ContentBlockKind;
          if (kind) onAdd(kind);
        }}
      >
        <option value="">+ {t("cbAdd")}</option>
        {kinds.map((kind) => (
          <option key={kind} value={kind}>
            {t(KIND_LABEL[kind])}
          </option>
        ))}
      </select>
      {full ? (
        <p className="text-[12px] leading-5 text-muted">
          {fillTemplate(t("cbAddMax"), { max: parent ? MAX_COLUMN_BLOCKS : MAX_CONTENT_BLOCKS })}
        </p>
      ) : null}
    </div>
  );
}

function summary(block: ContentBlock, t: T): string {
  switch (block.kind) {
    case "heading":
    case "paragraph":
    case "callout":
      return block.text;
    case "image":
      return block.caption ?? "";
    case "button":
      return block.label;
    case "columns":
      return fillTemplate(t("cbColumnsSummary"), { first: block.columns[0].length, second: block.columns[1].length });
    default:
      return "";
  }
}

function BlockRow({
  block,
  index,
  total,
  selected,
  canDuplicate: duplicable,
  t,
  onSelect,
  onMove,
  onDuplicate,
  onRemove,
}: {
  block: ContentBlock;
  index: number;
  total: number;
  selected: boolean;
  canDuplicate: boolean;
  t: T;
  onSelect: () => void;
  onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const thumb = useMediaRefPreview(block.kind === "image" ? block.media : null);
  const number = index + 1;
  const kind = t(KIND_LABEL[block.kind]);
  const text = summary(block, t);
  const labels = { number, kind };
  return (
    <div
      data-content-block-row={block.id}
      data-kind={block.kind}
      data-selected={selected ? "" : undefined}
      className={`flex items-center gap-1 border ${selected ? "border-primary bg-primary-soft" : "border-border bg-surface"}`}
    >
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:min-h-10"
      >
        {block.kind === "image" ? (
          <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden border border-border bg-background">
            {thumb ? (
              // biome-ignore lint/performance/noImgElement: editor-only signed preview URL
              <img src={thumb} alt="" className="size-full object-cover" />
            ) : null}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-medium text-text">{kind}</span>
          <span className="block truncate text-[12px] text-muted" dir="auto">
            {text || t("cbRowEmpty")}
          </span>
        </span>
      </button>
      <button type="button" className={iconButton} disabled={index === 0} aria-label={fillTemplate(t("cbMoveUp"), labels)} onClick={() => onMove(-1)}>
        <ArrowUp aria-hidden="true" className="size-4" />
      </button>
      <button type="button" className={iconButton} disabled={index === total - 1} aria-label={fillTemplate(t("cbMoveDown"), labels)} onClick={() => onMove(1)}>
        <ArrowDown aria-hidden="true" className="size-4" />
      </button>
      <button type="button" className={iconButton} disabled={!duplicable} aria-label={fillTemplate(t("cbDuplicate"), labels)} onClick={onDuplicate}>
        <Copy aria-hidden="true" className="size-4" />
      </button>
      <button type="button" className={iconButton} aria-label={fillTemplate(t("cbRemove"), labels)} onClick={onRemove}>
        <Trash2 aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

/**
 * A labelled group of toggle buttons. Not a `<label>` around the buttons (the shared `Field`): a label's text becomes the accessible name of
 * its FIRST button, so the first segment would be announced as the whole field.
 */
function SegmentedField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="space-y-1.5">
      <span id={id} className="block text-[12px] font-medium text-muted">
        {label}
      </span>
      {children}
      {hint ? <span className="block text-[12px] leading-5 text-muted">{hint}</span> : null}
    </div>
  );
}

function AlignField({ value, t, onChange }: { value: "start" | "center" | "end"; t: T; onChange: (align: "start" | "center" | "end") => void }) {
  return (
    <SegmentedField label={t("cbAlign")}>
      <Segmented
        value={value}
        onChange={onChange}
        options={[
          { id: "start" as const, label: t("cbAlignStart") },
          ...BLOCK_ALIGNS.map((align) => ({ id: align, label: t(align === "center" ? "cbAlignCenter" : "cbAlignEnd") })),
        ]}
      />
    </SegmentedField>
  );
}

/**
 * A button's label and link. A button with neither is not a button (the normaliser drops it), so while it has no link an emptied label is
 * kept in the field and not committed — the block survives until text is typed. If the link is entered first, the field is brought back to
 * the label that is really stored, so the editor never shows a blank the Canvas and the saved page do not honour.
 */
function ButtonTextFields({
  block,
  content,
  t,
  onChange,
}: {
  block: Extract<ContentBlock, { kind: "button" }>;
  content: ContentBlocks;
  t: T;
  onChange: (content: ContentBlocks) => void;
}) {
  const [pendingEmpty, setPendingEmpty] = useState(false);
  const [generation, setGeneration] = useState(0);
  return (
    <>
      <Field label={t("cbButtonLabel")}>
        <BufferedText
          key={generation}
          value={block.label}
          limit={MAX_BLOCK_BUTTON_LABEL_LENGTH}
          onCommit={(label) => {
            if (label.trim() === "" && block.href.trim() === "") {
              setPendingEmpty(true);
              return;
            }
            setPendingEmpty(false);
            onChange(setButtonLabel(content, block.id, label));
          }}
          data-content-button-label=""
        />
      </Field>
      <DeferredCommitField
        label={t("cbButtonHref")}
        hint={t("cbButtonHrefHint")}
        value={block.href}
        dir="ltr"
        onCommit={(href) => {
          if (pendingEmpty && href.trim() !== "") {
            setPendingEmpty(false);
            setGeneration((n) => n + 1);
          }
          onChange(setButtonHref(content, block.id, href));
        }}
      />
    </>
  );
}

function BlockEditor({
  block,
  content,
  locale,
  t,
  onChange,
  onRemove,
}: {
  block: ContentBlock;
  content: ContentBlocks;
  locale: "ar" | "en";
  t: T;
  onChange: (content: ContentBlocks) => void;
  /** Remove this block the way the list's delete does (and select its neighbour). */
  onRemove: () => void;
}) {
  switch (block.kind) {
    case "heading":
      return (
        <>
          <Field label={t("blockText")} hint={`${Array.from(block.text).length}/${MAX_HEADING_LENGTH}`}>
            <BufferedText value={block.text} limit={MAX_HEADING_LENGTH} onCommit={(v) => onChange(setText(content, block.id, v))} data-content-text="" />
          </Field>
          <SegmentedField label={t("cbHeadingLevel")} hint={t("cbHeadingLevelHint")}>
            <Segmented
              value={block.level === 3 ? "3" : "2"}
              onChange={(level) => onChange(setHeadingLevel(content, block.id, level === "3" ? 3 : 2))}
              options={[
                { id: "2", label: t("cbHeadingLevel2") },
                { id: "3", label: t("cbHeadingLevel3") },
              ]}
            />
          </SegmentedField>
          <AlignField value={block.align ?? "start"} t={t} onChange={(align) => onChange(setAlign(content, block.id, align))} />
        </>
      );
    case "paragraph":
      return (
        <>
          <Field label={t("blockText")} hint={`${Array.from(block.text).length}/${MAX_PARAGRAPH_LENGTH}`}>
            <BufferedText multiline value={block.text} limit={MAX_PARAGRAPH_LENGTH} onCommit={(v) => onChange(setText(content, block.id, v))} data-content-text="" />
          </Field>
          <AlignField value={block.align ?? "start"} t={t} onChange={(align) => onChange(setAlign(content, block.id, align))} />
        </>
      );
    case "image":
      return (
        <>
          <MediaRefField
            slot="content-block-image"
            label={t("cbPicture")}
            value={block.media}
            // an image always needs its picture, so the field's Remove deletes the block — through the same path as the list's delete
            onChange={(media) => (media ? onChange(setImageMedia(content, block.id, media)) : onRemove())}
            t={t}
            locale={locale}
          />
          <Field label={t("cbCaption")} hint={`${Array.from(block.caption ?? "").length}/${MAX_BLOCK_CAPTION_LENGTH}`}>
            <input
              className={inputClass}
              data-content-caption=""
              value={block.caption ?? ""}
              onChange={(event) => onChange(setCaption(content, block.id, event.target.value))}
            />
          </Field>
          <DeferredCommitField
            label={t("cbLink")}
            hint={t("cbLinkHint")}
            value={block.link ?? ""}
            dir="ltr"
            onCommit={(href) => onChange(setImageLink(content, block.id, href))}
          />
        </>
      );
    case "button":
      return (
        <>
          <ButtonTextFields key={block.id} block={block} content={content} t={t} onChange={onChange} />
          <SegmentedField label={t("cbButtonStyle")}>
            <Segmented
              value={block.style ?? "solid"}
              onChange={(style) => onChange(setButtonStyle(content, block.id, style))}
              options={[
                { id: "solid" as const, label: t("cbButtonStyleSolid") },
                ...BLOCK_BUTTON_STYLES.map((style) => ({ id: style, label: t(style === "outline" ? "cbButtonStyleOutline" : "cbButtonStyleLink") })),
              ]}
            />
          </SegmentedField>
          {block.label !== "" && block.href === "" ? (
            <p role="status" className="text-[12px] leading-5 text-muted" data-content-button-incomplete="">
              {t("cbButtonIncomplete")}
            </p>
          ) : null}
        </>
      );
    case "divider":
      return (
        <SegmentedField label={t("cbDividerStyle")}>
          <Segmented
            value={block.style ?? "line"}
            onChange={(style) => onChange(setDividerStyle(content, block.id, style))}
            options={[
              { id: "line" as const, label: t("cbDividerLine") },
              ...BLOCK_DIVIDER_STYLES.map((style) => ({ id: style, label: t("cbDividerDots") })),
            ]}
          />
        </SegmentedField>
      );
    case "spacer":
      return (
        <SegmentedField label={t("cbSpacerSize")}>
          <Segmented
            value={block.size ?? "md"}
            onChange={(size) => onChange(setSpacerSize(content, block.id, size))}
            options={[
              { id: "sm" as const, label: t("cbSpacerSm") },
              { id: "md" as const, label: t("cbSpacerMd") },
              { id: "lg" as const, label: t("cbSpacerLg") },
            ]}
          />
        </SegmentedField>
      );
    case "callout":
      return (
        <>
          <Field label={t("blockText")} hint={`${Array.from(block.text).length}/${MAX_CALLOUT_LENGTH}`}>
            <textarea
              className={`${inputClass} h-24 py-2`}
              data-content-text=""
              value={block.text}
              onChange={(event) => onChange(setText(content, block.id, event.target.value))}
            />
          </Field>
          <SegmentedField label={t("cbCalloutTone")}>
            <Segmented
              value={block.tone ?? "info"}
              onChange={(tone) => onChange(setCalloutTone(content, block.id, tone))}
              options={[
                { id: "info" as const, label: t("cbToneInfo") },
                ...BLOCK_CALLOUT_TONES.map((tone) => ({ id: tone, label: t(tone === "success" ? "cbToneSuccess" : "cbToneWarning") })),
              ]}
            />
          </SegmentedField>
          <Field label={t("navItemIcon")}>
            <select
              className={selectClass}
              data-content-callout-icon=""
              value={block.icon ?? ""}
              onChange={(event) => onChange(setCalloutIcon(content, block.id, normalizeIconKey(event.target.value)))}
            >
              <option value="">{t("navIconNone")}</option>
              {ICON_KEYS.map((key) => (
                <option key={key} value={key}>
                  {iconLabel(key, locale)}
                </option>
              ))}
            </select>
          </Field>
        </>
      );
    case "columns":
      return <p className="text-[12px] leading-5 text-muted">{t("cbColumnsHint")}</p>;
  }
}
