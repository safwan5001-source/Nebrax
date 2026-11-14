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
    errors: ['attachment_invalid', 'attachment_type_not_allowed', 'attachment_too_large', 'attachment_limit_reached', 'attachment_add_blocked', 'attachment_removal_blocked', 'attachment_not_active', 'attachment_same_content', 'attachment_duplicate', 'attachment_storage_failed', 'attachment_conflict', 'forbidden', 'not_found'],
  };
  for (const [group, values] of Object.entries(attachmentGroups)) for (const value of values) keys.add(`attachments.${group}.${value}`);
  for (const value of ['never', 'before_shift_approval', 'before_settlement']) keys.add(`settings.attachments.required.${value}`);
  for (const value of ['images_and_pdf', 'images_only']) keys.add(`settings.attachments.types.${value}`);
  for (const value of ['allow', 'deny']) keys.add(`settings.attachments.afterClose.${value}`);
  for (const value of ['open_shift_only', 'always', 'never']) keys.add(`settings.attachments.removal.${value}`);
  // TANKER-PR6A: مراجعة الدمج المخزني (`useTranslations('fuelTankers.inventory')` في المجلد الفرعي) + خيارات سياستها الديناميكية.
  const inventoryDir = join(dir, 'inventory');
  for (const file of readdirSync(inventoryDir).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))) {
    for (const m of readFileSync(join(inventoryDir, file), 'utf8').matchAll(/\bt\(\s*(['`])([A-Za-z0-9_.${}]+)\1/g)) keys.add(`inventory.${m[2]}`);
  }
  const inventoryGroups: Record<string, string[]> = {
    readiness: ['ready', 'needs_review', 'blocked'],
    blocker: ['station_not_active', 'station_warehouse_required', 'warehouse_unavailable', 'warehouse_branch_mismatch', 'fuel_product_unavailable', 'stock_record_missing', 'cost_baseline_required', 'cost_history_open', 'cost_pool_quantity_mismatch', 'insufficient_balance', 'period_locked', 'settlement_mode_conflict', 'clearing_account_missing', 'clearing_account_invalid', 'unknown'],
    reason: ['capacity_overrun', 'insufficient_balance', 'overdue', 'unknown'],
    summary: ['total', 'ready', 'needs_review', 'blocked', 'overdue'],
    // PR-6B-0: لوحة مطابقة الأستاذ (مفاتيح ديناميكية بحسب رموز الخادم).
    'reconciliation.status': ['consistent', 'differences'],
    'reconciliation.value': ['restricted_warehouse_scope', 'hidden_no_cost_permission'],
    'reconciliation.causes': ['entryAmountDiffers', 'reversedEntries', 'movementsWithoutJournal', 'stateVsMovements'],
    'reconciliation.findings': ['pool_quantity_mismatch', 'stock_without_cost_pool', 'cost_pool_without_stock_record', 'state_not_derived_from_movements', 'open_cost_history', 'value_difference', 'entry_amount_differs_from_movements', 'movements_without_journal', 'inventory_account_split_configured', 'inventory_account_split_in_ledger', 'linked_entries_touch_unlisted_asset_accounts', 'unknown'],
    'reconciliation.accounts.source': ['role_current', 'system_default', 'history', 'station_override', 'station_override_history', 'other'],
    'reconciliation.limits': ['price_and_average_correctness', 'manual_inventory_entries_not_linked_to_fuel_movements', 'non_fuel_lines_inside_linked_entries', 'tank_level_vs_book_stock', 'other'],
  };
  for (const [group, values] of Object.entries(inventoryGroups)) for (const value of values) keys.add(`inventory.${group}.${value}`);
  for (const value of ['block', 'hold_for_review']) keys.add(`settings.inventory.policy.${value}`);
  // TANKER-PR6B-1: بطاقة إعدادات الدمج المخزني (`useTranslations('fuelTankers.inventorySettings')` في المجلد الفرعي) + مفاتيحها الديناميكية من قوائم مغلقة.
  const inventorySettingsDir = join(dir, 'inventory-settings');
  for (const file of readdirSync(inventorySettingsDir).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))) {
    for (const m of readFileSync(join(inventorySettingsDir, file), 'utf8').matchAll(/\bt\(\s*(['`])([A-Za-z0-9_.${}]+)\1/g)) keys.add(`inventorySettings.${m[2]}`);
  }
  const inventorySettingsGroups: Record<string, string[]> = {
    blocker: ['clearing_account_missing', 'clearing_account_invalid', 'settlement_mode_conflict', 'unknown'],
    notice: ['posting_start_not_set', 'posting_gate_closed', 'unknown'],
    reason: ['not_found', 'group', 'inactive', 'not_asset', 'inventory_account', 'cash_or_bank', 'tax_account', 'reserved_role', 'other'],
    'cost.option': ['clearing_until_invoice'],
    'variance.option': ['block', 'warn'],
  };
  for (const [group, values] of Object.entries(inventorySettingsGroups)) for (const value of values) keys.add(`inventorySettings.${group}.${value}`);
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
