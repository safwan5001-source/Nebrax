import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import { KNOWN_BLOCKERS, KNOWN_REASONS } from './logic';

type Tree = { [key: string]: string | Tree };
const flat = (tree: Tree, prefix = ''): string[] => Object.entries(tree).flatMap(([key, value]) => (typeof value === 'string' ? [`${prefix}${key}`] : flat(value, `${prefix}${key}.`)));
const root = (messages: unknown) => (messages as { fuelTankerFills: Tree }).fuelTankerFills;
const arKeys = flat(root(ar));
const enKeys = flat(root(en));
const get = (messages: unknown, key: string) => key.split('.').reduce<unknown>((node, part) => (node as Tree)[part], root(messages)) as string;

/** مفاتيح `t('…')` الحرفية في الملفات + المفاتيح الديناميكية المبنية من قوائم مغلقة معروفة. */
function usedKeys(): Set<string> {
  const keys = new Set<string>();
  const dir = __dirname;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))) {
    for (const m of readFileSync(join(dir, file), 'utf8').matchAll(/\bt\(\s*(['`])([A-Za-z0-9_.${}]+)\1/g)) keys.add(m[2]);
  }
  const groups: Record<string, readonly string[]> = {
    tabs: ['pending', 'posted', 'reversed', 'attention'],
    inventoryStatus: ['pending_integration', 'posted', 'reversed'],
    readiness: ['ready', 'needs_review', 'blocked', 'not_applicable'],
    operation: ['post', 'reverse'],
    'attempt.outcome': ['succeeded', 'rejected', 'failed'],
    blocker: [...KNOWN_BLOCKERS, 'unknown'],
    reason: [...KNOWN_REASONS, 'unknown'],
    'list.empty': ['pending', 'posted', 'reversed', 'attention'],
    'list.emptyHint': ['pending', 'posted', 'reversed', 'attention'],
    'detail.statusHint': ['pending_integration', 'posted', 'reversed'],
    'dialog.title': ['post', 'reverse'],
    'dialog.intro': ['post', 'reverse'],
    'dialog.status.post': ['ready', 'blocked', 'not_applicable'],
    'dialog.status.reverse': ['ready', 'blocked', 'not_applicable'],
    'dialog.notApplicable': ['post', 'reverse'],
    'dialog.consequences': ['post', 'reverse'],
    'dialog.noPermission': ['post', 'reverse'],
    'dialog.confirm': ['post', 'reverse'],
    'dialog.problem': ['historical_review_required', 'reason_required', 'reason_too_short', 'reason_too_long'],
    'dialog.entry.side': ['debit', 'credit'],
    'dialog.entry.role': ['tanker_issue_clearing', 'inventory'],
    'dialog.entry.costRecognitionValue': ['clearing_until_invoice'],
    'dialog.entry.variancePolicyValue': ['block', 'warn'],
    'dialog.entry.valuationValue': ['historical_cost'],
    'dialog.outcome.ok': ['post', 'reverse'],
    'dialog.outcome.okBody': ['post', 'reverse'],
    'dialog.outcome.notSent': ['validation', 'offline', 'invalid_id'],
    'dialog.outcome.unknownBody': ['timeout', 'network', 'server', 'unverified'],
    'dialog.outcome.verifiedDone': ['post', 'reverse'],
  };
  for (const [group, values] of Object.entries(groups)) for (const value of values) keys.add(`${group}.${value}`);
  for (const key of [...keys]) if (key.includes('${')) keys.delete(key);
  return keys;
}

describe('fuelTankerFills messages', () => {
  it('has identical key sets in Arabic and English', () => {
    expect([...arKeys].sort()).toEqual([...enKeys].sort());
  });

  it('defines every key the module uses, in both languages', () => {
    for (const key of usedKeys()) {
      expect(arKeys, `ar is missing ${key}`).toContain(key);
      expect(enKeys, `en is missing ${key}`).toContain(key);
    }
  });

  it('has no unused keys', () => {
    const used = usedKeys();
    expect(arKeys.filter((key) => !used.has(key))).toEqual([]);
  });

  it('keeps ICU placeholders identical across languages', () => {
    for (const key of arKeys) {
      const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(placeholders(get(ar, key)), key).toEqual(placeholders(get(en, key)));
    }
  });

  it('never claims an invoice, revenue or receivable is created or that ownership moved', () => {
    for (const key of ['dialog.consequences.post', 'dialog.consequences.reverse', 'dialog.outcome.okBody.post', 'subtitle']) {
      expect(get(en, key).toLowerCase()).toMatch(/no invoice|creates no invoice|no .*invoice/);
      expect(get(ar, key)).toMatch(/لا (?:تُنشأ|ينشئ|يُنشئ)[^.]*فاتورة|لم تُنشأ فاتورة/);
    }
  });

  it('adds the navigation label in both languages', () => {
    expect((ar as unknown as { fuelWorkspaceNav: Record<string, string> }).fuelWorkspaceNav.tankerFills).toBeTruthy();
    expect((en as unknown as { fuelWorkspaceNav: Record<string, string> }).fuelWorkspaceNav.tankerFills).toBeTruthy();
  });
});
