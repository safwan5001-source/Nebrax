'use client';

/**
 * AWJ-VD-H1 / VD-3 — the «Appearance» tab (UX requirements §3.5).
 *
 * Shape (the 12 shapes drawn by the VD-2 engine), size, label, and — for an image — fit, focal point and zoom. **Every
 * property carries its own inheritance state**: «inherited from the dimension: X» while it is not overridden, and a
 * «restore inheritance» button once it is (D-08: each property resolves independently, so changing one never changes
 * another). The state is read from the shared resolver, not recomputed here.
 *
 * The focal point and zoom describe one picture, so they exist only with an image, and the focal point is editable only
 * while that image is usable (the grid, or a drag on the preview, needs a picture to aim at).
 */

import { Switch } from '@/components/ui/switch';
import {
  FACET_VISUAL_SIZES,
  type FacetVisualFit,
  type FacetVisualShape,
  type FacetVisualSize,
} from '@/modules/store-experience-builder/presentation/facet-visual';
import { FocalGrid, PropertyRow, SectionHeading, Segmented, ShapeGrid, ZoomSlider } from './controls';
import {
  choiceOf,
  errorKey,
  propState,
  type PropState,
  type Scope,
  setFraming,
  setProp,
} from './document';
import { fitLabel, imageNoteKey, sizeLabel } from './labels';
import type { IdentityTabProps } from './types';

export function AppearanceTab(props: IdentityTabProps) {
  const { kind, t } = props;
  if (kind === 'value') {
    return (
      <div className="space-y-6" data-tab-panel="appearance">
        <AppearanceBlock {...props} scope="own" />
      </div>
    );
  }
  return (
    <div className="space-y-8" data-tab-panel="appearance">
      <section aria-labelledby="ve-self-look" className="space-y-4">
        <SectionHeading id="ve-self-look" title={t('selfSection')} help={t('selfSectionHelp')} />
        <AppearanceBlock {...props} scope="own" />
      </section>
      <section aria-labelledby="ve-defaults-look" className="space-y-4 border-t border-border pt-6">
        <SectionHeading id="ve-defaults-look" title={t('defaultsSection')} help={t('defaultsSectionHelp')} />
        <AppearanceBlock {...props} scope="defaults" />
      </section>
    </div>
  );
}

function AppearanceBlock({ scope, ...props }: IdentityTabProps & { scope: Scope }) {
  const { kind, locale, t, draft, update, facetVisual, readOnly, errors, imageSource } = props;
  const parent = kind === 'value' ? 'facet' : 'none';
  const err = (group: Parameters<typeof errorKey>[1]) => errors.byField[errorKey(scope, group)];
  const state = (key: Parameters<typeof propState>[4]) => propState(kind, facetVisual, draft, scope, key);
  const restore = (key: Parameters<typeof setProp>[2]) => update((d) => setProp(d, scope, key, undefined));
  const row = (key: Parameters<typeof propState>[4], label: string, children: React.ReactNode, onRestore?: () => void, current?: PropState) => (
    <PropertyRow
      label={label}
      propKey={key}
      state={current ?? state(key)}
      parent={parent}
      locale={locale}
      t={t}
      readOnly={readOnly}
      errors={err(key as Parameters<typeof errorKey>[1])}
      onRestore={onRestore ?? (() => restore(key as Parameters<typeof setProp>[2]))}
    >
      {children}
    </PropertyRow>
  );

  const shape = state('shape');
  const size = state('size');
  const showLabel = state('showLabel');

  // Framing exists only for an own image the identity actually shows. For the defaults scope there is no image, only
  // the fit the values' own images fall back to.
  const image = scope === 'own' ? draft.own.image : undefined;
  const showsImage = scope === 'own' && image !== undefined && choiceOf(draft.own, kind === 'value' ? 'value' : 'self') === 'image';
  const fit = state('fit');
  const focal = image?.focal ?? { x: 50, y: 50 };
  const zoom = image?.zoom ?? 1;
  const imageUsable = imageSource.state === 'ready';

  const framingState = (own: boolean, text: string): PropState => ({ source: own ? 'own' : 'system', value: text });

  return (
    <div className="space-y-6" data-appearance-scope={scope}>
      {row(
        'shape',
        t('shapeTitle'),
        <ShapeGrid
          value={shape.value as FacetVisualShape}
          onChange={(next) => update((d) => setProp(d, scope, 'shape', next))}
          disabled={readOnly}
          label={t('shapeTitle')}
          locale={locale}
        />,
      )}

      {row(
        'size',
        t('sizeTitle'),
        <Segmented
          label={t('sizeTitle')}
          value={size.value as FacetVisualSize}
          disabled={readOnly}
          onChange={(next) => update((d) => setProp(d, scope, 'size', next))}
          options={FACET_VISUAL_SIZES.map((value) => ({ value, label: sizeLabel(value, t) }))}
          className="grid-cols-3"
        />,
      )}

      {row(
        'showLabel',
        t('showLabelTitle'),
        <div className="flex min-h-11 items-center gap-3">
          <Switch
            checked={showLabel.value !== false}
            onCheckedChange={(next) => update((d) => setProp(d, scope, 'showLabel', next))}
            disabled={readOnly}
            aria-label={t('showLabelTitle')}
          />
          <span className="text-xs leading-5 text-muted">{t('showLabelHelp')}</span>
        </div>,
      )}

      {scope === 'defaults' ? (
        row(
          'fit',
          t('fitTitle'),
          <FitGroup value={fit.value as FacetVisualFit} disabled={readOnly} t={t} onChange={(next) => update((d) => setProp(d, 'defaults', 'fit', next))} />,
        )
      ) : showsImage && image ? (
        <>
          {row(
            'fit',
            t('fitTitle'),
            <FitGroup
              value={fit.value as FacetVisualFit}
              disabled={readOnly}
              t={t}
              onChange={(next) => update((d) => setFraming(d, { fit: next }))}
            />,
            () => update((d) => setFraming(d, { fit: null })),
          )}

          <PropertyRow
            label={t('focalTitle')}
            propKey="focal"
            state={framingState(image.focal !== undefined, t('focalCenter'))}
            parent="none"
            locale={locale}
            t={t}
            readOnly={readOnly}
            valueText={t('focalCenter')}
            errors={errors.byField[errorKey(scope, 'focal')]}
            onRestore={() => update((d) => setFraming(d, { focal: null }))}
          >
            <p className="text-xs leading-5 text-muted">{t('focalHelp')}</p>
            <FocalGrid
              value={focal}
              onChange={(next) => update((d) => setFraming(d, { focal: next }))}
              disabled={readOnly || !imageUsable}
              label={t('focalTitle')}
              t={t}
            />
            {!imageUsable && imageNoteKey(imageSource.state) ? (
              <p className="text-xs leading-5 text-muted" data-focal-unavailable="">
                {t(imageNoteKey(imageSource.state) as 'imageLoading')}
              </p>
            ) : null}
          </PropertyRow>

          <PropertyRow
            label={t('zoomTitle')}
            propKey="zoom"
            state={framingState(image.zoom !== undefined, t('valueNoZoom'))}
            parent="none"
            locale={locale}
            t={t}
            readOnly={readOnly}
            valueText={t('valueNoZoom')}
            errors={errors.byField[errorKey(scope, 'zoom')]}
            onRestore={() => update((d) => setFraming(d, { zoom: null }))}
          >
            <ZoomSlider
              value={zoom}
              onChange={(next) => update((d) => setFraming(d, { zoom: next }))}
              disabled={readOnly}
              label={t('zoomTitle')}
            />
          </PropertyRow>
        </>
      ) : (
        <p className="text-xs leading-5 text-muted" data-image-only-hint="">
          {t('imageOnlyHint')}
        </p>
      )}
    </div>
  );
}

function FitGroup({
  value,
  onChange,
  disabled,
  t,
}: {
  value: FacetVisualFit;
  onChange: (next: FacetVisualFit) => void;
  disabled: boolean;
  t: IdentityTabProps['t'];
}) {
  return (
    <Segmented
      label={t('fitTitle')}
      value={value}
      disabled={disabled}
      onChange={onChange}
      options={(['cover', 'contain'] as const).map((fit) => ({ value: fit, label: fitLabel(fit, t) }))}
      className="grid-cols-2"
    />
  );
}
