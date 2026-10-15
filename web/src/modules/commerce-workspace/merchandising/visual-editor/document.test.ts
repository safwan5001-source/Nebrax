import { describe, expect, it } from 'vitest';
import {
  applyChoice,
  changedGroups,
  pruneErrors,
  choiceOf,
  draftFromStored,
  documentOf,
  errorKey,
  indexVisualErrors,
  payloadOf,
  sameVisual,
  scopePropState,
  setFraming,
  setImage,
  setProp,
  tabsWithErrors,
  valuePropState,
  type VisualDraft,
} from './document';
import { VISUAL_EDITOR_MESSAGES, createVisualEditorT, fieldErrorMessage, fillMessage } from './messages';
import { MEDIA_A } from './test-fixtures';

const empty: VisualDraft = { own: {}, defaults: {} };

describe('draft ↔ canonical document', () => {
  it('opens a value from its stored document and a dimension as {self, defaults}', () => {
    expect(draftFromStored('value', { shape: 'arch' })).toEqual({ own: { shape: 'arch' }, defaults: {} });
    expect(draftFromStored('facet', { self: { size: 'lg' }, defaults: { shape: 'star' } })).toEqual({
      own: { size: 'lg' },
      defaults: { shape: 'star' },
    });
    expect(draftFromStored('value', null)).toEqual(empty);
  });

  it('sends the canonical document, or the null tombstone once nothing is customised', () => {
    expect(payloadOf('value', { own: { shape: 'arch' }, defaults: {} })).toEqual({ shape: 'arch' });
    expect(payloadOf('value', empty)).toBeNull();
    expect(payloadOf('facet', { own: {}, defaults: { size: 'sm' } })).toEqual({ defaults: { size: 'sm' } });
    expect(payloadOf('facet', empty)).toBeNull();
  });

  it('a draft that differs only by an empty key is not a change', () => {
    const a: VisualDraft = { own: { shape: 'arch' }, defaults: {} };
    const b = setProp(a, 'own', 'size', undefined);
    expect(sameVisual('value', a, b)).toBe(true);
    expect(sameVisual('value', a, setProp(a, 'own', 'size', 'lg'))).toBe(false);
  });

  it('never carries crop or rotate: the normaliser drops them', () => {
    const draft: VisualDraft = {
      own: { image: { mediaId: MEDIA_A, crop: { x: 0 }, rotate: 90 } as never },
      defaults: {},
    };
    const doc = documentOf('value', draft) as { image?: Record<string, unknown> };
    expect(doc.image).toEqual({ mediaId: MEDIA_A });
  });
});

describe('framing edits', () => {
  const withImage = setImage(empty, { mediaId: MEDIA_A });

  it('sends zoom 1.4 on the image itself', () => {
    expect(payloadOf('value', setFraming(withImage, { zoom: 1.4 }))).toEqual({ image: { mediaId: MEDIA_A, zoom: 1.4 } });
  });

  it('does not store the defaults (1× zoom, centred focal point)', () => {
    const framed = setFraming(setFraming(withImage, { zoom: 2 }), { focal: { x: 10, y: 90 } });
    const reset = setFraming(setFraming(framed, { zoom: 1 }), { focal: { x: 50, y: 50 } });
    expect(payloadOf('value', reset)).toEqual({ image: { mediaId: MEDIA_A } });
  });

  it('keeps the fit explicit and ignores framing when there is no image', () => {
    expect(payloadOf('value', setFraming(withImage, { fit: 'contain' }))).toEqual({ image: { mediaId: MEDIA_A, fit: 'contain' } });
    expect(setFraming(empty, { zoom: 2 })).toBe(empty);
  });
});

describe('content type', () => {
  it('shows the explicit choice, else what the media implies', () => {
    expect(choiceOf({}, 'value')).toBe('inherit');
    expect(choiceOf({}, 'self')).toBe('none');
    expect(choiceOf({}, 'defaults')).toBe('inherit');
    expect(choiceOf({ image: { mediaId: MEDIA_A } }, 'value')).toBe('image');
    expect(choiceOf({ icon: 'gift' }, 'value')).toBe('icon');
    expect(choiceOf({ content: 'none', icon: 'gift' }, 'value')).toBe('none');
    // a dimension's defaults imply nothing from an icon alone
    expect(choiceOf({ icon: 'gift' }, 'defaults')).toBe('inherit');
  });

  it('switching image / icon / text only sets `content` and removes nothing (D-08)', () => {
    const draft: VisualDraft = { own: { image: { mediaId: MEDIA_A }, icon: 'gift', shape: 'arch', size: 'lg' }, defaults: {} };
    const asIcon = applyChoice(draft, 'own', 'icon');
    expect(asIcon.own).toEqual({ ...draft.own, content: 'icon' });
    expect(applyChoice(asIcon, 'own', 'none').own).toEqual({ ...draft.own, content: 'none' });
  });

  it('«inherit» removes what the value set itself but leaves shape, size and label alone', () => {
    const draft: VisualDraft = {
      own: { content: 'image', image: { mediaId: MEDIA_A }, icon: 'gift', shape: 'arch', size: 'lg', showLabel: false, iconColor: '#112233' },
      defaults: {},
    };
    expect(applyChoice(draft, 'own', 'inherit').own).toEqual({ shape: 'arch', size: 'lg', showLabel: false, iconColor: '#112233' });
  });

  it('«not set» on a dimension’s defaults removes the content only, never its icon', () => {
    const draft: VisualDraft = { own: {}, defaults: { content: 'icon', icon: 'gift' } };
    expect(applyChoice(draft, 'defaults', 'inherit').defaults).toEqual({ icon: 'gift' });
  });

  it('removing the image touches no other property', () => {
    const draft: VisualDraft = { own: { image: { mediaId: MEDIA_A, zoom: 2 }, shape: 'arch', size: 'lg', showLabel: false }, defaults: {} };
    expect(setImage(draft, null).own).toEqual({ shape: 'arch', size: 'lg', showLabel: false });
  });
});

describe('inheritance state (read from the shared resolver)', () => {
  // The governing example (D-08): the value customises only its image; the dimension supplies shape, size, label, icon.
  const facetVisual = { defaults: { shape: 'arch', size: 'lg', showLabel: true, icon: 'gift', fit: 'contain' } } as never;
  const own = { image: { mediaId: MEDIA_A } } as never;

  it('every property the value does not set is inherited from the dimension', () => {
    expect(valuePropState(facetVisual, own, 'shape')).toEqual({ source: 'facet', value: 'arch' });
    expect(valuePropState(facetVisual, own, 'size')).toEqual({ source: 'facet', value: 'lg' });
    expect(valuePropState(facetVisual, own, 'showLabel')).toEqual({ source: 'facet', value: true });
    expect(valuePropState(facetVisual, own, 'icon')).toEqual({ source: 'facet', value: 'gift' });
    expect(valuePropState(facetVisual, own, 'fit')).toEqual({ source: 'facet', value: 'contain' });
  });

  it('customising one property changes only that property’s state', () => {
    const next = { ...(own as object), shape: 'star' } as never;
    expect(valuePropState(facetVisual, next, 'shape')).toEqual({ source: 'own', value: 'star' });
    expect(valuePropState(facetVisual, next, 'size')).toEqual({ source: 'facet', value: 'lg' });
    expect(valuePropState(facetVisual, next, 'icon')).toEqual({ source: 'facet', value: 'gift' });
  });

  it('with nothing set anywhere the system default applies', () => {
    expect(valuePropState(null, {}, 'shape')).toEqual({ source: 'system', value: 'circle' });
    expect(valuePropState(null, {}, 'size')).toEqual({ source: 'system', value: 'md' });
    expect(valuePropState(null, {}, 'fit')).toEqual({ source: 'system', value: 'cover' });
    expect(valuePropState(null, {}, 'icon')).toEqual({ source: 'system', value: undefined });
  });

  it('an image implies the content (source «own»), a dimension default content is «facet»', () => {
    expect(valuePropState(null, own, 'content')).toEqual({ source: 'own', value: 'image' });
    expect(valuePropState({ defaults: { content: 'icon' } } as never, {}, 'content')).toEqual({ source: 'facet', value: 'icon' });
  });

  it('a dimension’s own appearance has no parent: set or the system default', () => {
    expect(scopePropState({ own: { shape: 'heart' }, defaults: {} }, 'own', 'shape')).toEqual({ source: 'own', value: 'heart' });
    expect(scopePropState(empty, 'own', 'shape')).toEqual({ source: 'system', value: 'circle' });
    expect(scopePropState({ own: {}, defaults: { fit: 'contain' } }, 'defaults', 'fit')).toEqual({ source: 'own', value: 'contain' });
  });
});

describe('server field errors', () => {
  it('maps a value’s paths to its controls', () => {
    const indexed = indexVisualErrors('value', {
      'visual.image.mediaId': ['media_not_ready'],
      'visual.image.zoom': ['out_of_range'],
      'visual.shape': ['unknown_shape'],
      'visual.iconColor': ['invalid_color'],
      'visual.image.crop': ['forbidden'],
    });
    expect(indexed.byField[errorKey('own', 'image')]).toEqual(['media_not_ready', 'forbidden']);
    expect(indexed.byField[errorKey('own', 'zoom')]).toEqual(['out_of_range']);
    expect(indexed.byField[errorKey('own', 'shape')]).toEqual(['unknown_shape']);
    expect(indexed.byField[errorKey('own', 'iconColor')]).toEqual(['invalid_color']);
    expect(indexed.unmapped).toEqual([]);
  });

  it('maps a dimension’s self and defaults paths separately', () => {
    const indexed = indexVisualErrors('facet', {
      'visual.self.image.mediaId': ['media_not_found'],
      'visual.defaults.shape': ['unknown_shape'],
      'visual.self.image.fit': ['invalid_value'],
    });
    expect(indexed.byField[errorKey('own', 'image')]).toEqual(['media_not_found']);
    expect(indexed.byField[errorKey('defaults', 'shape')]).toEqual(['unknown_shape']);
    expect(indexed.byField[errorKey('own', 'fit')]).toEqual(['invalid_value']);
  });

  it('keeps an unknown path as unmapped and flags the right tabs', () => {
    const indexed = indexVisualErrors('value', { visual: ['invalid_object'], 'visual.image.mediaId': ['media_not_found'], 'visual.shape': ['unknown_shape'] });
    expect(indexed.unmapped).toEqual(['invalid_object']);
    expect([...tabsWithErrors(indexed)].sort()).toEqual(['appearance', 'image']);
  });
});

describe('wording', () => {
  it('has the same keys in Arabic and English', () => {
    expect(Object.keys(VISUAL_EDITOR_MESSAGES.en).sort()).toEqual(Object.keys(VISUAL_EDITOR_MESSAGES.ar).sort());
  });

  it('fills holes and leaves an unknown hole visible', () => {
    expect(fillMessage('Edit {name} ({n})', { name: 'X' })).toBe('Edit X ({n})');
    expect(createVisualEditorT('en')('titleValue')).toBe('Edit value');
    expect(createVisualEditorT('ar')('titleValue')).toBe('تعديل القيمة');
  });

  it('translates each server code and falls back to a generic message for an unknown one', () => {
    const t = createVisualEditorT('en');
    for (const code of ['media_not_found', 'media_not_ready', 'invalid_media_id', 'unknown_icon', 'unknown_shape', 'invalid_color', 'out_of_range', 'invalid_value', 'forbidden', 'unknown_field', 'invalid_object']) {
      expect(fieldErrorMessage(t, code)).not.toBe(t('err_generic'));
    }
    expect(fieldErrorMessage(t, 'something_new')).toBe(t('err_generic'));
  });
});

describe('clearing a field error when its control changes', () => {
  const draft: VisualDraft = { own: { shape: 'arch', image: { mediaId: MEDIA_A, zoom: 1.4 } }, defaults: {} };

  it('names only the controls whose value changed', () => {
    expect([...changedGroups(draft, setProp(draft, 'own', 'size', 'lg'))]).toEqual(['own:size']);
    expect([...changedGroups(draft, setFraming(draft, { zoom: 2 }))]).toEqual(['own:zoom']);
    expect([...changedGroups(draft, setImage(draft, null))].sort()).toEqual(['own:image', 'own:zoom']);
    expect([...changedGroups(draft, setProp(draft, 'defaults', 'shape', 'star'))]).toEqual(['defaults:shape']);
    expect(changedGroups(draft, draft).size).toBe(0);
  });

  it('a framing edit is not an edit of the image control (and vice versa)', () => {
    expect(changedGroups(draft, setFraming(draft, { fit: 'contain' })).has('own:image')).toBe(false);
    const alt = setImage(draft, { mediaId: MEDIA_A, zoom: 1.4, alt: { en: 'x' } });
    expect([...changedGroups(draft, alt)]).toEqual(['own:image']);
  });

  it('drops exactly the errors of the changed controls', () => {
    const indexed = indexVisualErrors('value', { 'visual.shape': ['unknown_shape'], 'visual.size': ['invalid_value'] });
    const pruned = pruneErrors(indexed, new Set(['own:shape']));
    expect(Object.keys(pruned.byField)).toEqual(['own:size']);
    expect(pruneErrors(indexed, new Set(['own:icon']))).toBe(indexed);
  });
});
