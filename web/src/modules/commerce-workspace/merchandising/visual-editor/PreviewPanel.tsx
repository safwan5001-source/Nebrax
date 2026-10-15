'use client';

/**
 * AWJ-VD-H1 / VD-3 — the live preview of the identity being edited (UX requirements §3.6).
 *
 * - Drawn by `FacetVisualTile`, the admin twin of the tile the storefront renders, so what is previewed is what shoppers
 *   see — shape, size, framing, fallback chain and all.
 * - Inside a frame that takes the **store's** theme tokens (`.awj-store-preview`), not the admin colours.
 * - A layout switcher (grid / cards / rail / icons / list) changes only how the sample is laid out here. It is not
 *   saved and not a display setting: columns, gaps and templates belong to the builder's section settings (VD-4c).
 * - The edited item sits between its real neighbours in the dimension (or, for a dimension, next to its own values), so
 *   a shape or size is judged in context. Every change shows instantly: it only re-resolves local state.
 * - A drag on the edited item's picture sets the focal point (pointer enhancement; the 3 × 3 grid is the keyboard path).
 */

import { type PointerEvent, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { FacetVisualTile, type FacetVisualTileImage } from '@/modules/store-experience-builder/FacetVisualTile';
import type { ResolvedFacetVisual } from '@/modules/store-experience-builder/presentation/facet-visual';
import '@/modules/store-experience-builder/store-preview.css';
import { optionClass } from './controls';
import type { VT, VisualEditorMessageKey } from './messages';

export type PreviewLayout = 'grid' | 'cards' | 'rail' | 'icons' | 'list';

const LAYOUTS: readonly { id: PreviewLayout; label: VisualEditorMessageKey }[] = [
  { id: 'grid', label: 'layoutGrid' },
  { id: 'cards', label: 'layoutCards' },
  { id: 'rail', label: 'layoutRail' },
  { id: 'icons', label: 'layoutIcons' },
  { id: 'list', label: 'layoutList' },
];

export interface PreviewItem {
  id: string;
  label: string;
  visual: ResolvedFacetVisual;
  image: FacetVisualTileImage | null;
  /** The identity being edited (highlighted, and the focal-point drag target). */
  edited?: boolean;
}

export interface PreviewGroup {
  id: string;
  title?: string;
  items: PreviewItem[];
}

/** `icon-grid` shows the resolved icon, then the image, then the text (D-08 rule 3). */
function iconFirst(visual: ResolvedFacetVisual): ResolvedFacetVisual {
  if (visual.content === 'image' && visual.fallbackIcon) {
    const { image: _image, ...rest } = visual;
    return { ...rest, content: 'icon', icon: visual.fallbackIcon };
  }
  return visual;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function PreviewPanel({
  t,
  groups,
  notes,
  dragEnabled,
  onFocal,
  dir,
  showTitle = true,
  className,
}: {
  t: VT;
  groups: PreviewGroup[];
  notes: string[];
  /** Whether a drag on the edited picture may set the focal point (Appearance tab, usable image). */
  dragEnabled: boolean;
  onFocal?: (point: { x: number; y: number }) => void;
  dir: 'ltr' | 'rtl';
  /** The mobile strip already carries its own header, so it hides this one. */
  showTitle?: boolean;
  className?: string;
}) {
  const [layout, setLayout] = useState<PreviewLayout>('grid');
  const dragging = useRef(false);

  const focalFrom = (event: PointerEvent<HTMLElement>) => {
    const frame = event.currentTarget.querySelector<HTMLElement>('[data-facet-content] > span[aria-hidden="true"]');
    const rect = frame?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    onFocal?.({
      x: clampPercent(((event.clientX - rect.left) / rect.width) * 100),
      y: clampPercent(((event.clientY - rect.top) / rect.height) * 100),
    });
  };

  const draggable = dragEnabled && layout !== 'icons' && layout !== 'list';

  const renderItem = (item: PreviewItem) => {
    const visual = layout === 'icons' ? iconFirst(item.visual) : item.visual;
    const tile =
      layout === 'list' ? (
        <span className="text-sm text-store-foreground">{item.label}</span>
      ) : (
        // `w-full`: the tile's frame is capped at its size but shrinks (max-width 100%) to the cell, as in a store column.
        <FacetVisualTile visual={visual} label={item.label} image={item.image} className="w-full" />
      );
    const edited = item.edited === true;
    return (
      <div
        key={item.id}
        data-preview-item={item.id}
        data-preview-edited={edited ? '' : undefined}
        aria-current={edited ? 'true' : undefined}
        onPointerDown={
          edited && draggable
            ? (event) => {
                dragging.current = true;
                event.currentTarget.setPointerCapture?.(event.pointerId);
                focalFrom(event);
              }
            : undefined
        }
        onPointerMove={edited && draggable ? (event) => dragging.current && focalFrom(event) : undefined}
        onPointerUp={edited && draggable ? () => (dragging.current = false) : undefined}
        onPointerCancel={edited && draggable ? () => (dragging.current = false) : undefined}
        className={cn(
          'min-w-0 rounded-store p-1.5',
          layout === 'list' ? 'flex items-center' : 'flex justify-center',
          layout === 'cards' && 'border border-store-border bg-store-surface p-2.5',
          layout === 'rail' && 'w-24 shrink-0 snap-start',
          edited && 'outline outline-2 outline-offset-2 outline-primary',
          edited && draggable && 'cursor-crosshair touch-none',
        )}
      >
        {tile}
      </div>
    );
  };

  const container = cn(
    layout === 'grid' && 'grid grid-cols-3 gap-2',
    layout === 'cards' && 'grid grid-cols-2 gap-2',
    layout === 'rail' && 'flex snap-x gap-2 overflow-x-auto pb-1',
    layout === 'icons' && 'grid grid-cols-4 gap-2',
    layout === 'list' && 'flex flex-col gap-1',
  );

  return (
    <div className={cn('space-y-3', className)} data-preview-panel="">
      {showTitle ? <h3 className="text-sm font-semibold text-text">{t('previewTitle')}</h3> : null}
      <div className="space-y-1.5">
        <span className="block text-xs font-medium text-muted">{t('previewLayoutGroup')}</span>
        <div role="group" aria-label={t('previewLayoutGroup')} className="grid grid-cols-5 gap-1">
          {LAYOUTS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={layout === id}
              onClick={() => setLayout(id)}
              className={cn(optionClass(layout === id), 'px-1 text-xs')}
              data-preview-layout={id}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>

      <div className="awj-store-preview space-y-3 rounded border border-border p-3" dir={dir} data-store-frame="">
        {groups.map((group) => (
          <div key={group.id} className="space-y-1.5">
            {group.title ? <p className="text-xs font-medium text-store-muted-foreground">{group.title}</p> : null}
            <div className={container}>{group.items.map(renderItem)}</div>
          </div>
        ))}
      </div>

      {notes.map((note) => (
        <p key={note} role="status" className="text-xs leading-5 text-muted">
          {note}
        </p>
      ))}
    </div>
  );
}
