import { describe, expect, it } from 'vitest';
import { BULK_PUBLICATION_MAX_IDS } from '@/modules/products/publication';
import { fillTemplate, keepFailedOnly, pageSelectionState, SELECTION_LIMIT, toggleOne, togglePage } from './selection';

const sel = (...ids: string[]) => new Map(ids.map((id) => [id, `n-${id}`]));
const items = (...ids: string[]) => ids.map((id) => ({ id, name: `n-${id}` }));

describe('publication bulk selection', () => {
  it('mirrors the server batch cap', () => {
    expect(SELECTION_LIMIT).toBe(BULK_PUBLICATION_MAX_IDS);
  });

  it('toggles a single row on and off', () => {
    const on = toggleOne(new Map(), { id: 'a', name: 'A' });
    expect([...on.selection.keys()]).toEqual(['a']);
    expect(toggleOne(on.selection, { id: 'a', name: 'A' }).selection.size).toBe(0);
  });

  it('reports none / some / all for the current page', () => {
    expect(pageSelectionState(sel(), ['a', 'b'])).toBe('none');
    expect(pageSelectionState(sel('a'), ['a', 'b'])).toBe('some');
    expect(pageSelectionState(sel('a', 'b', 'z'), ['a', 'b'])).toBe('all');
    expect(pageSelectionState(sel('a'), [])).toBe('none');
  });

  it('select-all-on-page adds only this page and keeps other pages selected', () => {
    const next = togglePage(sel('x'), items('a', 'b')).selection;
    expect([...next.keys()].sort()).toEqual(['a', 'b', 'x']);
    // الضغط ثانيةً يُلغي هذه الصفحة وحدها.
    expect([...togglePage(next, items('a', 'b')).selection.keys()]).toEqual(['x']);
  });

  it('a partially selected page completes instead of clearing', () => {
    const next = togglePage(sel('a'), items('a', 'b', 'c')).selection;
    expect([...next.keys()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('never exceeds the server limit and says so', () => {
    const full = new Map(Array.from({ length: SELECTION_LIMIT }, (_, i) => [`id-${i}`, 'x'] as const));
    const one = toggleOne(full, { id: 'extra', name: 'E' });
    expect(one.limitReached).toBe(true);
    expect(one.selection.size).toBe(SELECTION_LIMIT);

    const almost = new Map(Array.from({ length: SELECTION_LIMIT - 1 }, (_, i) => [`id-${i}`, 'x'] as const));
    const page = togglePage(almost, items('p1', 'p2', 'p3'));
    expect(page.limitReached).toBe(true);
    expect(page.selection.size).toBe(SELECTION_LIMIT);
  });

  it('keeps only failed ids after a result', () => {
    const kept = keepFailedOnly(sel('a', 'b', 'c', 'd'), [
      { id: 'a', status: 'updated' },
      { id: 'b', status: 'failed' },
      { id: 'c', status: 'rejected' },
      { id: 'd', status: 'unchanged' },
    ]);
    expect([...kept.keys()]).toEqual(['b']);
  });

  it('fills templates and leaves unknown placeholders intact', () => {
    expect(fillTemplate('{n} of {noun} · {missing}', { n: 3, noun: 'x' })).toBe('3 of x · {missing}');
  });
});
