import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

import { ApiError } from '@/lib/api';
import {
  CONTENT_TYPES,
  availableTypes,
  blockProblems,
  blockValid,
  bodyProblem,
  charCount,
  contentPayload,
  contentSignature,
  loadContent,
  mapBlocks,
  saveContent,
  type ContentBlock,
} from './content';

afterEach(() => apiMock.mockReset());

const body = { data: { blocks: [
  { block_type: 'composition', body: 'ورد جوري أحمر ٢٤ ساق', body_en: '24 red roses', is_active: true },
  { block_type: 'care', body: 'تُحفظ في مكان بارد', body_en: null, is_active: false },
] } };

describe('structured content client', () => {
  it('has exactly the ten governed types from the backend list', () => {
    expect([...CONTENT_TYPES]).toEqual(['composition', 'care', 'natural_variation', 'included_items', 'dimensions', 'materials', 'allergens', 'storage', 'preparation_notes', 'personalization_instructions']);
  });

  it('maps ordered blocks and fails the load on an unknown type (a whole-set save would delete it server-side)', () => {
    const blocks = mapBlocks(body)!;
    expect(blocks.map((b) => [b.type, b.isActive, b.bodyEn])).toEqual([['composition', true, '24 red roses'], ['care', false, '']]);
    expect(mapBlocks({ data: { blocks: [{ block_type: 'video', body: 'x' }, { block_type: 'care', body: 'ok' }] } })).toBeNull();
    expect(mapBlocks({ data: { blocks: [{ block_type: 'care', body: 'ok' }] } })!.map((b) => b.type)).toEqual(['care']);
    expect(mapBlocks({ data: {} })).toBeNull();
  });

  it('builds the API payload with block_type, trimmed text and null for an empty English body', () => {
    const blocks = mapBlocks(body)!;
    expect(contentPayload([{ ...blocks[0], body: '  نص  ' }, blocks[1]]).blocks).toEqual([
      { block_type: 'composition', body: 'نص', body_en: '24 red roses', is_active: true },
      { block_type: 'care', body: 'تُحفظ في مكان بارد', body_en: null, is_active: false },
    ]);
    expect(contentSignature(blocks)).toBe(contentSignature(mapBlocks(body)!));
  });

  it('validates required text, length (in code points) and lines like the server', () => {
    expect(bodyProblem('', true)).toBe('required');
    expect(bodyProblem('   ', true)).toBe('required');
    expect(bodyProblem('', false)).toBeNull();
    expect(bodyProblem('x'.repeat(2000), true)).toBeNull();
    expect(bodyProblem('x'.repeat(2001), true)).toBe('tooLong');
    expect(bodyProblem('🌹'.repeat(2000), true)).toBeNull();
    expect(charCount('🌹🌹')).toBe(2);
    expect(bodyProblem(Array.from({ length: 40 }, () => 'a').join('\n'), true)).toBeNull();
    expect(bodyProblem(Array.from({ length: 41 }, () => 'a').join('\n'), true)).toBe('tooManyLines');
    expect(bodyProblem('a\r\nb', true)).toBeNull();
    const block: ContentBlock = { type: 'care', body: '', bodyEn: 'x'.repeat(2001), isActive: true };
    expect(blockProblems(block)).toEqual({ body: 'required', bodyEn: 'tooLong' });
    expect(blockValid({ ...block, body: 'ok', bodyEn: '' })).toBe(true);
  });

  it('offers only unused types, in the governed order', () => {
    const blocks = mapBlocks(body)!;
    expect(availableTypes(blocks)).toEqual(CONTENT_TYPES.filter((t) => t !== 'composition' && t !== 'care'));
    expect(availableTypes([])).toHaveLength(10);
  });

  it('reads/writes the product-scoped path and surfaces a server rejection', async () => {
    apiMock.mockResolvedValue(body);
    await loadContent('p1');
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/workspace/products/p1/content');
    await saveContent('p1', mapBlocks(body)!);
    expect(apiMock.mock.calls.at(-1)![1]).toMatchObject({ method: 'PUT', body: { blocks: [{ block_type: 'composition' }, { block_type: 'care' }] } });
    apiMock.mockRejectedValueOnce(new ApiError(422, 'كتلة واحدة فقط لكل نوع محتوى.', {}));
    expect(await saveContent('p1', [])).toMatchObject({ ok: false, kind: 'invalid', message: 'كتلة واحدة فقط لكل نوع محتوى.' });
  });
});
