"use client";

/**
 * CUST-HV V8f — the `gallery` section's editor (V0 §13.2): the pictures (add, duplicate, reorder, delete), the selected picture's media /
 * caption / link, and the display options (columns, shape, gap, captions, viewer). The shape of the gallery — grid or scrolling strip — is the
 * section design's `layout`, chosen in the Design tab.
 *
 * Everything goes through the pure edits in `gallery-edit.ts`. The selected picture is the one the Canvas rings and keeps in view
 * (`activeImageId`); alt text per locale (or the decorative flag) is the media field's, judged at Publish by the generic media gate.
 */
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { DeferredCommitField, Field, inputClass, Segmented, Toggle } from "./ControlPanels";
import {
  addImage,
  canAddImage,
  duplicateImage,
  moveImage,
  removeImage,
  setImageCaption,
  setImageLink,
  setImageMedia,
  setOptions,
} from "./gallery-edit";
import { MediaPicker } from "./media/MediaPicker";
import { MediaRefField } from "./media/MediaRefField";
import { useMediaRefPreview } from "./media/use-media-ref-preview";
import type { CustomizerMessageKey } from "./messages";
import {
  GALLERY_ASPECTS,
  GALLERY_COLUMNS,
  GALLERY_GAPS,
  type GalleryContent,
  type GalleryImage,
  MAX_GALLERY_CAPTION_LENGTH,
  MAX_GALLERY_IMAGES,
  MIN_GALLERY_IMAGES_TO_PUBLISH,
  resolveGalleryOptions,
} from "./presentation/gallery-content";
import { fillTemplate } from "./slider-edit";

type T = (key: CustomizerMessageKey) => string;

const GAP_LABEL = {
  none: "galleryGapNone",
  xs: "galleryGapXs",
  sm: "galleryGapSm",
  md: "galleryGapMd",
  lg: "galleryGapLg",
  xl: "galleryGapXl",
} as const satisfies Record<(typeof GALLERY_GAPS)[number], CustomizerMessageKey>;

const iconButton =
  "inline-flex size-11 items-center justify-center text-muted hover:bg-background hover:text-text disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:size-8";

export function GalleryFields({
  content,
  locale,
  t,
  activeImageId,
  onActiveImageChange,
  onChange,
}: {
  content: GalleryContent;
  locale: "ar" | "en";
  t: T;
  /** The picture the Canvas rings; absent / unknown ⇒ the first. */
  activeImageId: string | null;
  onActiveImageChange: (id: string) => void;
  onChange: (content: GalleryContent) => void;
}) {
  const [picking, setPicking] = useState(false);
  const images = content.images;
  const selectedIndex = Math.max(
    0,
    images.findIndex((image) => image.id === activeImageId),
  );
  const selected = images[selectedIndex] ?? null;
  const options = resolveGalleryOptions(content.options);

  const remove = (index: number) => {
    onChange(removeImage(content, images[index].id));
    const neighbour = images[index + 1] ?? images[index - 1];
    if (neighbour) onActiveImageChange(neighbour.id);
  };
  const duplicate = (index: number) => {
    const result = duplicateImage(content, images[index].id);
    if (!result.id) return;
    onChange(result.content);
    onActiveImageChange(result.id);
  };

  return (
    <div className="space-y-4" data-gallery-fields="">
      <section className="space-y-2" aria-labelledby="gallery-images-title">
        <div className="flex items-center justify-between gap-2">
          <h3 id="gallery-images-title" className="text-[12px] font-semibold tracking-wide text-muted">
            {t("galleryImagesTitle")}
          </h3>
          <span className="text-[12px] tabular-nums text-muted" data-gallery-count="">
            {fillTemplate(t("galleryCount"), { count: images.length, max: MAX_GALLERY_IMAGES })}
          </span>
        </div>
        {images.length < MIN_GALLERY_IMAGES_TO_PUBLISH ? (
          <p role="status" data-gallery-min="" className="text-[12px] leading-5 text-muted">
            {t("galleryMinHint")}
          </p>
        ) : null}
        <ol className="space-y-1.5" data-gallery-image-list="">
          {images.map((image, index) => (
            <ImageRow
              key={image.id}
              image={image}
              index={index}
              total={images.length}
              selected={index === selectedIndex}
              canDuplicate={canAddImage(content)}
              t={t}
              onSelect={() => onActiveImageChange(image.id)}
              onMove={(delta) => onChange(moveImage(content, image.id, delta))}
              onDuplicate={() => duplicate(index)}
              onRemove={() => remove(index)}
            />
          ))}
        </ol>
        <button
          type="button"
          data-gallery-add=""
          disabled={!canAddImage(content)}
          onClick={() => setPicking(true)}
          className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 border border-dashed border-border bg-surface px-3 text-[13px] font-medium text-text hover:bg-background disabled:cursor-not-allowed disabled:opacity-50 md:min-h-9"
        >
          <Plus aria-hidden="true" className="size-4" />
          {t("galleryAdd")}
        </button>
        {!canAddImage(content) ? (
          <p className="text-[12px] leading-5 text-muted">{fillTemplate(t("galleryAddMax"), { max: MAX_GALLERY_IMAGES })}</p>
        ) : null}
        <MediaPicker
          open={picking}
          onClose={() => setPicking(false)}
          onSelect={(asset) => {
            setPicking(false);
            const next = addImage(content, { mediaId: asset.id });
            if (next === content) return;
            onChange(next);
            onActiveImageChange(next.images[next.images.length - 1].id);
          }}
          t={t}
          locale={locale}
        />
      </section>

      {selected ? (
        <section
          key={selected.id}
          className="space-y-3 border-t border-border pt-3"
          data-gallery-image-editor={selected.id}
          aria-label={fillTemplate(t("galleryImageLabel"), { number: selectedIndex + 1 })}
        >
          <h3 className="text-[13px] font-semibold text-text">{fillTemplate(t("galleryImageLabel"), { number: selectedIndex + 1 })}</h3>
          <MediaRefField
            slot="gallery-image"
            label={t("galleryPicture")}
            value={selected.media}
            // an image always needs its picture: removing it is "delete the picture", which the list offers
            onChange={(media) => media && onChange(setImageMedia(content, selected.id, media))}
            t={t}
            locale={locale}
          />
          <Field label={t("galleryCaption")} hint={`${Array.from(selected.caption ?? "").length}/${MAX_GALLERY_CAPTION_LENGTH}`}>
            <input
              className={inputClass}
              data-gallery-caption-input=""
              value={selected.caption ?? ""}
              onChange={(event) => onChange(setImageCaption(content, selected.id, event.target.value))}
            />
          </Field>
          <DeferredCommitField
            label={t("galleryLink")}
            hint={t("galleryLinkHint")}
            value={selected.link ?? ""}
            dir="ltr"
            onCommit={(href) => onChange(setImageLink(content, selected.id, href))}
          />
        </section>
      ) : null}

      <fieldset className="min-w-0 space-y-3" data-gallery-options="">
        <legend className="mb-1 text-[12px] font-semibold tracking-wide text-muted">{t("galleryOptionsTitle")}</legend>
        <p className="text-[12px] leading-5 text-muted">{t("galleryLayoutHint")}</p>
        <Field label={t("galleryColumns")} hint={t("galleryColumnsHint")}>
          <Segmented
            value={String(options.columns)}
            onChange={(id) => onChange(setOptions(content, { columns: Number(id) as typeof options.columns }))}
            options={GALLERY_COLUMNS.map((columns) => ({ id: String(columns), label: String(columns) }))}
          />
        </Field>
        <Field label={t("galleryAspect")}>
          <Segmented
            value={options.aspect}
            onChange={(aspect) => onChange(setOptions(content, { aspect }))}
            options={GALLERY_ASPECTS.map((aspect) => ({ id: aspect, label: aspect }))}
          />
        </Field>
        <Field label={t("galleryGap")}>
          <Segmented
            value={options.gap}
            onChange={(gap) => onChange(setOptions(content, { gap }))}
            options={GALLERY_GAPS.map((gap) => ({ id: gap, label: t(GAP_LABEL[gap]) }))}
          />
        </Field>
        <Toggle label={t("galleryCaptions")} checked={options.captions} onChange={(captions) => onChange(setOptions(content, { captions }))} />
        <Toggle label={t("galleryLightbox")} checked={options.lightbox} onChange={(lightbox) => onChange(setOptions(content, { lightbox }))} />
        <Toggle
          label={t("galleryShowMotionControls")}
          checked={options.showMotionControls}
          onChange={(showMotionControls) => onChange(setOptions(content, { showMotionControls }))}
        />
        <p className="text-[12px] leading-5 text-muted" data-gallery-motion-hint="">
          {t("galleryShowMotionControlsHint")}
        </p>
      </fieldset>
    </div>
  );
}

function ImageRow({
  image,
  index,
  total,
  selected,
  canDuplicate,
  t,
  onSelect,
  onMove,
  onDuplicate,
  onRemove,
}: {
  image: GalleryImage;
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
  const thumb = useMediaRefPreview(image.media);
  const number = index + 1;
  return (
    <li
      data-gallery-image-row={image.id}
      data-selected={selected ? "" : undefined}
      className={`flex items-center gap-1 border ${selected ? "border-primary bg-primary-soft" : "border-border bg-surface"}`}
    >
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:min-h-10"
      >
        <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden border border-border bg-background">
          {thumb ? (
            // biome-ignore lint/performance/noImgElement: editor-only signed preview URL
            <img src={thumb} alt="" className="size-full object-cover" />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-medium text-text">{fillTemplate(t("galleryImageLabel"), { number })}</span>
          <span className="block truncate text-[12px] text-muted" dir="auto">
            {image.caption || t("galleryImageNoCaption")}
          </span>
        </span>
      </button>
      <button type="button" className={iconButton} disabled={index === 0} aria-label={fillTemplate(t("galleryMoveUp"), { number })} onClick={() => onMove(-1)}>
        <ArrowUp aria-hidden="true" className="size-4" />
      </button>
      <button type="button" className={iconButton} disabled={index === total - 1} aria-label={fillTemplate(t("galleryMoveDown"), { number })} onClick={() => onMove(1)}>
        <ArrowDown aria-hidden="true" className="size-4" />
      </button>
      <button type="button" className={iconButton} disabled={!canDuplicate} aria-label={fillTemplate(t("galleryDuplicate"), { number })} onClick={onDuplicate}>
        <Copy aria-hidden="true" className="size-4" />
      </button>
      <button type="button" className={iconButton} aria-label={fillTemplate(t("galleryRemove"), { number })} onClick={onRemove}>
        <Trash2 aria-hidden="true" className="size-4" />
      </button>
    </li>
  );
}
