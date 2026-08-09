import { describe, expect, it } from 'vitest';
import { resolveActiveBranchId } from '../branch';

/**
 * قاعدة حلّ الفرع النشط. أهميتها أن ترويسة `X-Branch-Id` تُبنى من نتيجتها،
 * فأي انحراف هنا يعني واجهةً تعرض فرعاً وخادماً يقرأ فرعاً آخر.
 */
describe('resolveActiveBranchId', () => {
  const branches = [{ id: 'main' }, { id: 'khobar' }, { id: 'jubail' }];

  it('يحترم الفرع المخزَّن ما دام قائماً', () => {
    expect(resolveActiveBranchId(branches, 'khobar', 'main')).toBe('khobar');
  });

  it('يسقط للفرع الرئيسي بلا فرع مخزَّن', () => {
    expect(resolveActiveBranchId(branches, null, 'main')).toBe('main');
  });

  it('يسقط للفرع الرئيسي إذا كان المخزَّن لفرع محذوف', () => {
    expect(resolveActiveBranchId(branches, 'deleted-branch', 'main')).toBe('main');
  });

  it('يسقط لأول فرع حين لا يوجد فرع رئيسي', () => {
    expect(resolveActiveBranchId(branches, null, null)).toBe('main');
    expect(resolveActiveBranchId([{ id: 'only' }], 'ghost', null)).toBe('only');
  });

  it('يُعيد null بلا فروع إطلاقاً', () => {
    expect(resolveActiveBranchId([], 'anything', null)).toBeNull();
  });
});
