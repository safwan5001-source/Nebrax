/**
 * AWJ-VD-H1 / VD-3 — human labels for the values the editor shows (shapes, sizes, icons, colours…), used by the
 * inheritance badges and the controls. The shape and icon names come from the shared registries, so a new shape or
 * icon needs no change here.
 */

import {
  FACET_VISUAL_SHAPE_LABELS,
  type FacetVisualShape,
} from '@/modules/store-experience-builder/presentation/facet-visual';
import { ICON_REGISTRY, type IconKey } from '@/modules/store-experience-builder/presentation/icon-registry';
import type { InheritableKey } from './document';
import type { VT } from './messages';
import type { ImageState } from './use-image-source';

export type EditorLocale = 'ar' | 'en';

export function shapeLabel(shape: unknown, locale: EditorLocale): string {
  return shape && typeof shape === 'string' && shape in FACET_VISUAL_SHAPE_LABELS
    ? FACET_VISUAL_SHAPE_LABELS[shape as FacetVisualShape][locale]
    : String(shape ?? '');
}

export function iconLabel(key: unknown, locale: EditorLocale): string | null {
  return typeof key === 'string' && key in ICON_REGISTRY ? ICON_REGISTRY[key as IconKey].label[locale] : null;
}

export function sizeLabel(size: unknown, t: VT): string {
  return size === 'sm' ? t('sizeSm') : size === 'lg' ? t('sizeLg') : t('sizeMd');
}

export function fitLabel(fit: unknown, t: VT): string {
  return fit === 'contain' ? t('fitContain') : t('fitCover');
}

export function contentLabel(content: unknown, t: VT): string {
  return content === 'image' ? t('contentImage') : content === 'icon' ? t('contentIcon') : t('contentNone');
}

/** The effective value of a property as the badge words it («دائري»، «إظهار»، «#12372a»…). */
export function describeValue(key: InheritableKey, value: unknown, locale: EditorLocale, t: VT): string {
  switch (key) {
    case 'shape':
      return shapeLabel(value, locale);
    case 'size':
      return sizeLabel(value, t);
    case 'showLabel':
      return value === false ? t('valueOff') : t('valueOn');
    case 'fit':
      return fitLabel(value, t);
    case 'content':
      return contentLabel(value, t);
    case 'icon':
      return iconLabel(value, locale) ?? t('valueNoIcon');
    case 'iconColor':
    case 'background':
      return typeof value === 'string' && value ? value : t('valueThemeColour');
  }
}

export type ImageNoteKey = 'imageLoading' | 'imageNotReady' | 'imageDeleted' | 'imageFailed' | 'imageUnavailable';

/** The sentence that explains a non-ready preview image (`null` while it is ready or there is no image). */
export function imageNoteKey(state: ImageState): ImageNoteKey | null {
  switch (state) {
    case 'loading':
      return 'imageLoading';
    case 'not_ready':
      return 'imageNotReady';
    case 'deleted':
      return 'imageDeleted';
    case 'failed':
      return 'imageFailed';
    case 'unavailable':
      return 'imageUnavailable';
    default:
      return null;
  }
}
