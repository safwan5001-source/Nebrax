'use client';

/**
 * AWJ-VD-H1 / VD-3 — the «Image & icon» tab (UX requirements §3.4).
 *
 * A **content-type group** decides what the identity shows: for a value, inherit / image / icon / text only; for a
 * dimension's own appearance, image / icon / text only, followed by a separate «value defaults» block with the same
 * group (no image there — images are never inherited).
 *
 * - **Image:** `MediaRefField` in pick-only mode (`framing={false}`) over the shared `MediaPicker`; the field never sees
 *   framing, and its output goes through `toFacetImage()` which drops `crop` / `rotate`. A fresh pick is decorative by
 *   default: the link in the store carries the name.
 * - **Icon:** the VD-2 `IconPicker`, with `ColourField` (hex only) for the icon and background colours and a live 3:1
 *   contrast check.
 * - **Text only:** a one-line explanation.
 * - Removing the image touches nothing else (D-08).
 *
 * Read-only roles (D-04) get no picker, no upload and no library read: a summary of the saved image from the signed
 * `visual_preview` thumbnail, and every other control disabled.
 */

import { ImageOff, Info } from 'lucide-react';
import { useId, useMemo } from 'react';
import { ColourField } from '@/modules/store-experience-builder/design/ColourField';
import { IconPicker } from '@/modules/store-experience-builder/IconPicker';
import { createMediaFieldT } from '@/modules/store-experience-builder/media/media-field-messages';
import { fromFacetImage, toFacetImage } from '@/modules/store-experience-builder/media/facet-image';
import { MediaRefField } from '@/modules/store-experience-builder/media/MediaRefField';
import { customizerMessage } from '@/modules/store-experience-builder/messages';
import type { IconKey } from '@/modules/store-experience-builder/presentation/icon-registry';
import { contrastRatio, FACET_ICON_MIN_CONTRAST } from '@/modules/store-experience-builder/presentation/facet-visual-style';
import { COLOUR_FIELD_CONTEXT } from './constants';
import { FieldErrors, PropertyRow, SectionHeading, Segmented, type SegmentOption } from './controls';
import {
  applyChoice,
  choiceOf,
  type ContentChoice,
  type ContentMode,
  errorKey,
  inheritWouldClear,
  propState,
  type Scope,
  setImage,
  setProp,
} from './document';
import { describeValue, imageNoteKey } from './labels';
import type { IdentityTabProps } from './types';

/** Two decimals, truncated: 2.996 reads «2.99», never «3.00» next to a «below 3:1» warning. */
function shownRatio(ratio: number): string {
  return (Math.floor(ratio * 100) / 100).toFixed(2);
}

export function ImageTab(props: IdentityTabProps) {
  const { kind, t } = props;
  if (kind === 'value') {
    return (
      <div className="space-y-6" data-tab-panel="image">
        <IdentityBlock {...props} scope="own" mode="value" />
      </div>
    );
  }
  return (
    <div className="space-y-8" data-tab-panel="image">
      <section aria-labelledby="ve-self" className="space-y-4">
        <SectionHeading id="ve-self" title={t('selfSection')} help={t('selfSectionHelp')} />
        <IdentityBlock {...props} scope="own" mode="self" />
      </section>
      <section aria-labelledby="ve-defaults" className="space-y-4 border-t border-border pt-6">
        <SectionHeading id="ve-defaults" title={t('defaultsSection')} help={t('defaultsSectionHelp')} />
        <IdentityBlock {...props} scope="defaults" mode="defaults" />
      </section>
    </div>
  );
}

function IdentityBlock({
  scope,
  mode,
  ...props
}: IdentityTabProps & { scope: Scope; mode: ContentMode }) {
  const { kind, locale, t, draft, baseline, update, facetVisual, readOnly, busy, errors, media } = props;
  const gatedId = useId();
  const doc = draft[scope];
  const choice = choiceOf(doc, mode);
  const err = (group: Parameters<typeof errorKey>[1]) => errors.byField[errorKey(scope, group)];
  const contentState = propState(kind, facetVisual, draft, scope, 'content');
  // The explanation is for someone who could have used the library; a read-only role has its own banner instead.
  const gated = media === 'gated' && !readOnly;
  const hasImageChoice = mode !== 'defaults';

  const options: SegmentOption<ContentChoice>[] = [
    ...(mode === 'self' ? [] : [{ value: 'inherit' as const, label: mode === 'value' ? t('contentInherit') : t('contentUnset') }]),
    ...(hasImageChoice
      ? [{ value: 'image' as const, label: t('contentImage'), disabled: gated, describedBy: gated ? gatedId : undefined }]
      : []),
    { value: 'icon', label: t('contentIcon') },
    { value: 'none', label: t('contentNone') },
  ];

  // What the icon section is about: the icon itself, or the fallback behind an image, or what a value inherits.
  const effective = choice === 'inherit' ? contentState.value : choice;
  const showIcon = mode === 'defaults' ? choice !== 'none' : effective === 'icon' || effective === 'image';
  const iconIsFallback = effective === 'image';

  const baselineDoc = baseline[scope];
  const inheritClears = mode === 'value' && choice === 'inherit' && inheritWouldClear(baselineDoc);

  return (
    <div className="space-y-5" data-identity-scope={scope}>
      <div className="space-y-2">
        <span className="text-sm font-medium text-text">{t('contentTitle')}</span>
        <Segmented
          label={t('contentTitle')}
          value={choice}
          options={options}
          disabled={readOnly || busy}
          onChange={(next) => update((d) => applyChoice(d, scope, next))}
          className={options.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}
        />
        {gated && hasImageChoice ? (
          <p id={gatedId} className="flex items-start gap-1.5 text-xs leading-5 text-muted" data-media-gated="">
            <Info className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.7} aria-hidden="true" />
            {t('imageGated')}
          </p>
        ) : null}
        {choice === 'inherit' && mode === 'value' ? (
          <p className="text-xs text-muted" data-content-now="">
            {t('contentNow', { value: describeValue('content', contentState.value, locale, t) })}
          </p>
        ) : null}
        {inheritClears ? <p className="text-xs leading-5 text-muted">{t('contentInheritClears')}</p> : null}
        {choice === 'none' ? <p className="text-xs leading-5 text-muted">{t('contentNoneHelp')}</p> : null}
        <FieldErrors codes={err('content')} t={t} />
      </div>

      {hasImageChoice && choice === 'image' ? <ImageSection {...props} scope={scope} /> : null}

      {showIcon ? (
        <IconSection {...props} scope={scope} mode={mode} fallback={iconIsFallback} />
      ) : null}
    </div>
  );
}

// ───────────────────────────── image ─────────────────────────────

function ImageSection({ scope, ...props }: IdentityTabProps & { scope: Scope }) {
  const { locale, t, draft, update, readOnly, busy, errors, media, imageSource } = props;
  const image = draft.own.image;
  const mediaT = useMemo(
    () =>
      createMediaFieldT(locale, {
        mediaDecorativeHint: t('imageDecorativeHint'),
        mediaAltMissing: t('imageAltOptional'),
      }),
    [locale, t],
  );
  const note = imageNoteKey(imageSource.state);

  return (
    <div
      className="space-y-2 [&_button]:min-h-11 [&_input:not([type=checkbox])]:h-11 [&_label.cursor-pointer]:min-h-11"
      data-section="image"
      // While a save is in flight the field stays mounted (so it does not refetch its asset) but cannot be used.
      {...(busy ? ({ inert: '' } as Record<string, string>) : {})}
    >
      {readOnly ? (
        <ReadOnlyImage {...props} />
      ) : (
        <MediaRefField
          slot={`facet-${scope}`}
          label={t('imageTitle')}
          value={fromFacetImage(image)}
          t={mediaT}
          locale={locale}
          framing={false}
          altRequired={false}
          onChange={(ref) =>
            update((d) => {
              const previous = d.own.image;
              let next = toFacetImage(ref, previous);
              // A newly picked picture is decorative until the merchant says otherwise.
              if (next && !previous && !next.decorative && !next.alt) next = { ...next, decorative: true };
              return setImage(d, next);
            })
          }
        />
      )}
      {!image && !readOnly && media !== 'gated' ? (
        <p className="text-xs leading-5 text-muted" data-image-need-pick="">
          {t('imageNeedPick')}
        </p>
      ) : null}
      {image && note ? (
        <p role="status" className="flex items-start gap-1.5 text-xs leading-5 text-muted" data-image-state={imageSource.state}>
          <ImageOff className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.7} aria-hidden="true" />
          {t(note)}
        </p>
      ) : null}
      <FieldErrors codes={errors.byField[errorKey(scope, 'image')]} t={t} />
    </div>
  );
}

/** What a role without `commerce.manage` sees: the saved image from its signed thumbnail, and its alt text. */
function ReadOnlyImage({ draft, imageSource, t }: IdentityTabProps) {
  const image = draft.own.image;
  if (!image) return <p className="text-sm text-muted">{t('imageNoneStored')}</p>;
  return (
    <div className="space-y-2 rounded border border-border bg-surface p-3" data-readonly-image="">
      <span className="block text-xs font-medium text-muted">{t('imageTitle')}</span>
      <div className="flex items-start gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-background">
          {imageSource.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived workspace thumbnail
            <img src={imageSource.image.src} alt="" className="size-full object-contain" />
          ) : (
            <ImageOff className="size-5 text-muted" strokeWidth={1.7} aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 space-y-1 text-sm">
          {image.decorative ? <p className="text-muted">{t('imageDecorativeOn')}</p> : null}
          {(['ar', 'en'] as const).map((lang) =>
            image.alt?.[lang] ? (
              <p key={lang} className="break-words">
                <span className="text-xs text-muted">{t('imageReadOnlyAlt', { lang: lang.toUpperCase() })}: </span>
                <span dir={lang === 'ar' ? 'rtl' : 'ltr'}>{image.alt[lang]}</span>
              </p>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── icon and colours ─────────────────────────────

function IconSection({
  scope,
  mode,
  fallback,
  ...props
}: IdentityTabProps & { scope: Scope; mode: ContentMode; fallback: boolean }) {
  const { kind, locale, t, draft, update, facetVisual, readOnly, busy, errors } = props;
  const err = (group: Parameters<typeof errorKey>[1]) => errors.byField[errorKey(scope, group)];
  const parent = kind === 'value' ? 'facet' : 'none';
  const icon = propState(kind, facetVisual, draft, scope, 'icon');
  const iconColour = propState(kind, facetVisual, draft, scope, 'iconColor');
  const background = propState(kind, facetVisual, draft, scope, 'background');
  const customizerT = useMemo(() => (key: Parameters<typeof customizerMessage>[1]) => customizerMessage(locale, key), [locale]);
  const context = useMemo(() => COLOUR_FIELD_CONTEXT(locale === 'ar' ? 'rtl' : 'ltr'), [locale]);

  const iconHex = typeof iconColour.value === 'string' ? iconColour.value : undefined;
  const backgroundHex = typeof background.value === 'string' ? background.value : undefined;
  // Judged only when both colours are known: a theme colour on a merchant background is picked readable at render time.
  const ratio = iconHex && backgroundHex ? contrastRatio(iconHex, backgroundHex) : null;
  const status =
    ratio === null
      ? null
      : ratio < FACET_ICON_MIN_CONTRAST
        ? { tone: 'bad' as const, text: t('contrastLow', { ratio: shownRatio(ratio) }) }
        : { tone: 'ok' as const, text: t('contrastGood', { ratio: shownRatio(ratio) }) };

  const colourRow = (key: 'iconColor' | 'background', label: string, state: typeof iconColour, hex: string | undefined) => (
    <PropertyRow
      label={label}
      propKey={key}
      state={state}
      parent={parent}
      locale={locale}
      t={t}
      readOnly={readOnly}
      busy={busy}
      hideLabel
      errors={err(key)}
      onRestore={() => update((d) => setProp(d, scope, key, undefined))}
    >
      <ColourField
        label={label}
        value={hex ? { hex } : undefined}
        onChange={(ref) => update((d) => setProp(d, scope, key, ref && 'hex' in ref ? ref.hex : undefined))}
        ctx={context}
        t={customizerT}
        hexOnly
        clearable={false}
        disabled={readOnly || busy}
        dataName={`${scope}-${key}`}
        status={key === 'iconColor' ? status : null}
      />
    </PropertyRow>
  );

  return (
    <div
      className="space-y-5 [&_button]:min-h-11 [&_button]:min-w-11 [&_input]:h-11 [&_input[type=color]]:w-11"
      data-section="icon"
    >
      <div className="space-y-2">
        <SectionHeading title={fallback ? t('iconFallbackTitle') : t('iconTitle')} help={fallback ? t('iconFallbackHelp') : undefined} />
        <PropertyRow
          label={fallback ? t('iconFallbackTitle') : t('iconTitle')}
          propKey="icon"
          state={icon}
          parent={parent}
          locale={locale}
          t={t}
          readOnly={readOnly}
          busy={busy}
          hideLabel
          errors={err('icon')}
          onRestore={() => update((d) => setProp(d, scope, 'icon', undefined))}
        >
          <IconPicker
            value={typeof icon.value === 'string' ? (icon.value as IconKey) : undefined}
            onChange={(next) => update((d) => setProp(d, scope, 'icon', next))}
            locale={locale}
            disabled={readOnly || busy}
            labels={{
              group: t('iconGroup'),
              search: t('iconSearch'),
              none: t('iconNone'),
              noResults: t('iconNoResults'),
            }}
          />
        </PropertyRow>
      </div>
      {mode === 'defaults' || mode === 'self' || mode === 'value' ? (
        <div className="grid gap-5 sm:grid-cols-2">
          {colourRow('iconColor', t('iconColour'), iconColour, iconHex)}
          {colourRow('background', t('backgroundColour'), background, backgroundHex)}
        </div>
      ) : null}
    </div>
  );
}
