import type { FacetVisual } from '@/modules/store-experience-builder/presentation/facet-visual';
import type { Facet, FacetValue } from '../client';
import type { EditorKind, IndexedErrors, VisualDraft } from './document';
import type { EditorLocale } from './labels';
import type { VT } from './messages';
import type { ImageSource } from './use-image-source';

/** What the editor opens on: a whole dimension, or one of its values. */
export type EditorTarget =
  | { kind: 'facet'; facet: Facet }
  | { kind: 'value'; facet: Facet; value: FacetValue };

export type MediaAvailability = 'checking' | 'available' | 'gated';

/** The shared inputs of the identity tabs (Image & icon, Appearance). */
export interface IdentityTabProps {
  kind: EditorKind;
  locale: EditorLocale;
  t: VT;
  draft: VisualDraft;
  /** The draft as saved when the editor opened (or last saved): what a destructive choice would discard. */
  baseline: VisualDraft;
  update: (change: (draft: VisualDraft) => VisualDraft) => void;
  /** The dimension's *stored* document: what a value inherits from (a value editor never edits it). */
  facetVisual: FacetVisual | null;
  /** The identity tabs are read-only (no `commerce.manage`, or no edit right at all). */
  readOnly: boolean;
  errors: IndexedErrors;
  media: MediaAvailability;
  /** Where the preview of the edited identity's own image comes from, and whether it is usable. */
  imageSource: ImageSource;
}
