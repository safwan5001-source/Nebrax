// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReplacePreview } from './ReplacePreview';
import type { ImportPreview } from './contract';

const t = ((key: string, values: Record<string, unknown> = {}) =>
  Object.keys(values).length ? `${key}:${Object.values(values).join(',')}` : key) as never;

type Media = NonNullable<ImportPreview['media']>;

function media(over: Partial<Media> = {}): Media {
  return {
    mode: 'replace',
    source_count: 3,
    ready_rows: 0,
    needs_approval_rows: 1,
    error_rows: 0,
    unchanged_rows: 0,
    affected_products: 1,
    images_to_add: 3,
    images_to_remove: 2,
    images_kept: 0,
    unmatched_archive: ['ORPHAN.png'],
    missing_rows: [3],
    rows: [
      {
        row: 2, sku: 'SKU-A', barcode: null, product_id: 'p1', product_action: 'replace_images', status: 'needs_approval',
        sources: [
          { kind: 'archive', name: 'SKU-A.png', role: 'primary' },
          { kind: 'archive', name: 'SKU-A__2.png', role: 'additional' },
          { kind: 'archive', name: 'SKU-A__3.png', role: 'additional' },
        ],
        replacement: { existing_count: 2, new_count: 3, keep_count: 0, add_count: 3, remove_count: 2, existing_names: ['old1.png', 'old2.png'] },
        messages: ['استبدال الصور الموجودة يحتاج تأكيداً صريحاً.'],
      },
    ],
    ...over,
  };
}

afterEach(cleanup);

describe('ReplacePreview', () => {
  it('يعرض المنتجات المتأثرة والصور القديمة والجديدة لكل منتج', () => {
    render(<ReplacePreview media={media()} confirmed={false} busy={false} onConfirmChange={vi.fn()} t={t} />);
    expect(screen.getByText('import_replace_old:2')).toBeTruthy();
    expect(screen.getByText('import_replace_new:3')).toBeTruthy();
    expect(screen.getByText('old1.png · old2.png')).toBeTruthy();
    expect(screen.getByText(/★ SKU-A\.png · SKU-A__2\.png · SKU-A__3\.png/)).toBeTruthy();
    expect(screen.getByText('import_images_unmatched:1')).toBeTruthy();
  });

  it('يطلب تأكيداً صريحاً ويُبلغ بتبديله ولا يعتبره مؤكَّداً من تلقاء نفسه', async () => {
    const onConfirmChange = vi.fn();
    render(<ReplacePreview media={media()} confirmed={false} busy={false} onConfirmChange={onConfirmChange} t={t} />);
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByText('import_replace_confirm_required')).toBeTruthy();
    await userEvent.click(box);
    expect(onConfirmChange).toHaveBeenCalledWith(true);
  });

  it('لا يعرض تأكيداً حين لا شيء سيُزال، ويقول إن لا تغيير مطلوب', () => {
    render(
      <ReplacePreview
        media={media({ needs_approval_rows: 0, affected_products: 0, images_to_add: 0, images_to_remove: 0, unchanged_rows: 1, rows: [], missing_rows: [], unmatched_archive: [] })}
        confirmed={false} busy={false} onConfirmChange={vi.fn()} t={t}
      />
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('import_replace_nothing')).toBeTruthy();
  });

  it('يعطّل التأكيد عند وجود أخطاء', () => {
    render(<ReplacePreview media={media({ error_rows: 1 })} confirmed={false} busy={false} onConfirmChange={vi.fn()} t={t} />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  });
});
