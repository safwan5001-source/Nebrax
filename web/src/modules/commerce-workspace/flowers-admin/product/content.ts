/**
 * FLOWERS-H2-9 / ADR-17 — كتل المحتوى المهيكلة لمنتج (`GET|PUT commerce/workspace/products/{id}/content`). قائمة مغلقة
 * من عشرة أنواع، كتلة واحدة لكل نوع، نصٌّ عادي فقط (≤2000 حرف و≤40 سطراً)، مرتّبة وقابلة للإيقاف. لا HTML ولا أنواع
 * جديدة. الخادم يستبدل المجموعة كاملةً ويطبّع النص؛ التحقق هنا يعكس حدوده لفشلٍ مبكر.
 */

import { api } from '@/lib/api';
import { adminCall, bool, list, obj, productPath, str, type AdminResult } from '../admin-http';

export const CONTENT_TYPES = [
  'composition',
  'care',
  'natural_variation',
  'included_items',
  'dimensions',
  'materials',
  'allergens',
  'storage',
  'preparation_notes',
  'personalization_instructions',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const MAX_BODY_LENGTH = 2000;
export const MAX_LINES = 40;

export type ContentBlock = { type: ContentType; body: string; bodyEn: string; isActive: boolean };

const isType = (v: unknown): v is ContentType => (CONTENT_TYPES as readonly unknown[]).includes(v);

export function mapBlocks(payload: unknown): ContentBlock[] | null {
  const rows = obj(obj(payload)?.data)?.blocks;
  if (!Array.isArray(rows)) return null;

  return list(rows)
    .map((raw): ContentBlock | null => {
      const row = obj(raw);
      const body = str(row?.body);

      return row && isType(row.block_type) && body !== null ? { type: row.block_type, body, bodyEn: str(row.body_en) ?? '', isActive: bool(row.is_active, true) } : null;
    })
    .filter((b): b is ContentBlock => b !== null);
}

export const loadContent = (productId: string): Promise<AdminResult<ContentBlock[]>> =>
  adminCall(async () => mapBlocks(await api<unknown>(productPath(productId, 'content'))));

export const contentPayload = (blocks: readonly ContentBlock[]) => ({
  blocks: blocks.map((b) => ({ block_type: b.type, body: b.body.trim(), body_en: b.bodyEn.trim() === '' ? null : b.bodyEn.trim(), is_active: b.isActive })),
});

export const saveContent = (productId: string, blocks: readonly ContentBlock[]): Promise<AdminResult<ContentBlock[]>> =>
  adminCall(async () => mapBlocks(await api<unknown>(productPath(productId, 'content'), { method: 'PUT', body: contentPayload(blocks) })));

export const contentSignature = (blocks: readonly ContentBlock[]): string => JSON.stringify(contentPayload(blocks));

export type BodyProblem = 'required' | 'tooLong' | 'tooManyLines';

/** عدّ المحارف بوحدات الرموز (لا وحدات UTF-16) كما يفعل الخادم (`PlainText::length`). */
export const charCount = (text: string): number => Array.from(text).length;
export const lineCount = (text: string): number => (text === '' ? 0 : text.split('\n').length);

export function bodyProblem(text: string, required: boolean): BodyProblem | null {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (normalized === '') return required ? 'required' : null;
  if (charCount(normalized) > MAX_BODY_LENGTH) return 'tooLong';
  if (lineCount(normalized) > MAX_LINES) return 'tooManyLines';

  return null;
}

export type BlockProblems = { body: BodyProblem | null; bodyEn: BodyProblem | null };

export const blockProblems = (block: ContentBlock): BlockProblems => ({ body: bodyProblem(block.body, true), bodyEn: bodyProblem(block.bodyEn, false) });
export const blockValid = (block: ContentBlock): boolean => {
  const p = blockProblems(block);
  return p.body === null && p.bodyEn === null;
};

/** الأنواع المتاحة للإضافة: ما لم يُستعمل بعد، بترتيب القائمة المغلقة. */
export const availableTypes = (blocks: readonly ContentBlock[]): ContentType[] => CONTENT_TYPES.filter((type) => !blocks.some((b) => b.type === type));
