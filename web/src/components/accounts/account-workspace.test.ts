import { describe, expect, it } from 'vitest';
import { ancestorIds, buildAccountTree, searchAccounts } from './account-workspace';
import type { WorkspaceAccount } from './account-workspace';

const account = (overrides: Partial<WorkspaceAccount>): WorkspaceAccount => ({
  id: 'a1',
  parent_id: null,
  code: '1',
  name: 'الأصول',
  name_en: 'Assets',
  type: 'asset',
  normal_balance: 'debit',
  is_group: true,
  is_system: true,
  is_active: true,
  children_count: 0,
  has_entries: false,
  balance: '0.00',
  direct_balance: '0.00',
  aggregated_balance: '0.00',
  path: [{ id: 'a1', code: '1', name: 'الأصول' }],
  ...overrides,
});

describe('account workspace tree', () => {
  const assets = account({ id: 'assets', code: '1', name: 'الأصول', path: [{ id: 'assets', code: '1', name: 'الأصول' }] });
  const currentAssets = account({ id: 'current', parent_id: 'assets', code: '11', name: 'الأصول المتداولة', path: [...assets.path, { id: 'current', code: '11', name: 'الأصول المتداولة' }] });
  const cash = account({ id: 'cash', parent_id: 'current', code: '1110', name: 'الصندوق', name_en: 'Cash', is_group: false, path: [...currentAssets.path, { id: 'cash', code: '1110', name: 'الصندوق' }] });

  it('يبني شجرة مرتبة ويحافظ على كل عقدة عند بيانات أبوية معيبة', () => {
    const orphan = account({ id: 'orphan', parent_id: 'missing', code: '9', name: 'يتيم', path: [{ id: 'orphan', code: '9', name: 'يتيم' }] });
    const tree = buildAccountTree([cash, orphan, currentAssets, assets]);

    expect(tree.roots.map((node) => node.id)).toEqual(['assets', 'orphan']);
    expect(tree.byId.get('assets')?.children[0]?.id).toBe('current');
    expect(tree.byId.get('current')?.children[0]?.id).toBe('cash');
  });

  it('يبحث بالاسم والكود والاسم الإنجليزي ويعيد مسار النتيجة', () => {
    const accounts = [assets, currentAssets, cash];

    expect(searchAccounts(accounts, '1110').map((item) => item.id)).toEqual(['cash']);
    expect(searchAccounts(accounts, 'cash').map((item) => item.id)).toEqual(['cash']);
    expect(ancestorIds(cash)).toEqual(['assets', 'current']);
  });
});
