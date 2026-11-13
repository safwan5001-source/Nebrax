import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';

type Tree = { [key: string]: string | Tree };
const flat = (tree: Tree, prefix = ''): string[] => Object.entries(tree).flatMap(([key, value]) => (typeof value === 'string' ? [`${prefix}${key}`] : flat(value, `${prefix}${key}.`)));
const arKeys = flat((ar as unknown as { fuelTankers: Tree }).fuelTankers);
const enKeys = flat((en as unknown as { fuelTankers: Tree }).fuelTankers);

/** مفاتيح t('…') الحرفية المستعملة في المصدر + الديناميكية المعروفة (حالات، مراحل، أخطاء). */
function usedKeys(): Set<string> {
  const keys = new Set<string>();
  const dir = __dirname;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))) {
    for (const m of readFileSync(join(dir, file), 'utf8').matchAll(/\bt\(\s*(['`])([A-Za-z0-9_.${}]+)\1/g)) keys.add(m[2]);
  }
  for (const status of ['active', 'suspended', 'inactive']) keys.add(`status.${status}`);
  for (const phase of ['active', 'upcoming', 'ended']) keys.add(`phase.${phase}`);
  for (const code of ['required', 'too_long', 'invalid_capacity', 'invalid_date', 'end_before_start']) keys.add(`errors.${code}`);
  // TANKER-PR3: خيارات السياسات وعمليات الفوهات تُبنى ديناميكياً من قوائم مغلقة.
  for (const scope of ['station', 'tenant', 'owner', 'none']) keys.add(`settings.voucher.scope.${scope}`);
  for (const policy of ['allow_with_confirmation', 'block', 'allow']) keys.add(`settings.overrun.policy.${policy}`);
  for (const operation of ['direct_sale', 'tanker_fill', 'internal_issue']) keys.add(`settings.nozzles.ops.${operation}`);
  // TANKER-PR5: مفاتيح مكوّن المرفقات (`useTranslations('fuelTankers.attachments')` في المجلد الفرعي) تُحسب بالبادئة `attachments.`.
  const attachmentsDir = join(dir, 'attachments');
  for (const file of readdirSync(attachmentsDir).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))) {
    for (const m of readFileSync(join(attachmentsDir, file), 'utf8').matchAll(/\bt\(\s*(['`])([A-Za-z0-9_.${}]+)\1/g)) keys.add(`attachments.${m[2]}`);
  }
  const attachmentGroups: Record<string, string[]> = {
    status: ['present', 'missing', 'none'],
    'blocked.add': ['fill_voided', 'shift_closed', 'limit_reached', 'removal_disabled'],
    'blocked.remove': ['fill_voided', 'shift_closed', 'limit_reached', 'removal_disabled'],
    rejected: ['type', 'size', 'empty', 'limit'],
    historyStatus: ['active', 'removed', 'replaced'],
    errors: ['attachment_invalid', 'attachment_type_not_allowed', 'attachment_too_large', 'attachment_limit_reached', 'attachment_add_blocked', 'attachment_removal_blocked', 'attachment_not_active', 'attachment_same_content', 'attachment_duplicate', 'attachment_storage_failed', 'forbidden', 'not_found'],
  };
  for (const [group, values] of Object.entries(attachmentGroups)) for (const value of values) keys.add(`attachments.${group}.${value}`);
  for (const value of ['never', 'before_shift_approval', 'before_settlement']) keys.add(`settings.attachments.required.${value}`);
  for (const value of ['images_and_pdf', 'images_only']) keys.add(`settings.attachments.types.${value}`);
  for (const value of ['allow', 'deny']) keys.add(`settings.attachments.afterClose.${value}`);
  for (const value of ['open_shift_only', 'always', 'never']) keys.add(`settings.attachments.removal.${value}`);
  for (const key of [...keys]) if (key.includes('${')) keys.delete(key);
  return keys;
}

describe('fuelTankers messages', () => {
  it('has identical key sets in Arabic and English', () => {
    expect([...arKeys].sort()).toEqual([...enKeys].sort());
  });

  it('defines every key the module uses, in both languages', () => {
    for (const key of usedKeys()) {
      expect(arKeys, `ar is missing ${key}`).toContain(key);
      expect(enKeys, `en is missing ${key}`).toContain(key);
    }
  });

  it('has no unused keys (keeps the namespace honest)', () => {
    const used = usedKeys();
    const unused = arKeys.filter((key) => !used.has(key));
    expect(unused).toEqual([]);
  });

  it('keeps ICU placeholders identical across languages', () => {
    const get = (messages: unknown, key: string) => key.split('.').reduce<unknown>((node, part) => (node as Tree)[part], (messages as { fuelTankers: Tree }).fuelTankers) as string;
    for (const key of arKeys) {
      const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(placeholders(get(ar, key)), key).toEqual(placeholders(get(en, key)));
    }
  });

  it('adds the navigation label in both languages', () => {
    expect((ar as unknown as { fuelWorkspaceNav: Record<string, string> }).fuelWorkspaceNav.tankerOwners).toBeTruthy();
    expect((en as unknown as { fuelWorkspaceNav: Record<string, string> }).fuelWorkspaceNav.tankerOwners).toBeTruthy();
    expect((ar as unknown as { fuelWorkspaceNav: Record<string, string> }).fuelWorkspaceNav.tankerSettings).toBeTruthy();
    expect((en as unknown as { fuelWorkspaceNav: Record<string, string> }).fuelWorkspaceNav.tankerSettings).toBeTruthy();
  });
});
