import { describe, expect, it } from 'vitest';
import { resolvePosDefaultCustomer } from './pos-default-customer';

const WALKIN = 'عميل نقدي (POS)';

describe('resolvePosDefaultCustomer', () => {
  it('يحوّل مرجعاً صالحاً إلى كيان عميل فعلي بالاسم المطبّع من الخادم', () => {
    const resolved = resolvePosDefaultCustomer(
      { default_customer_id: 'customer-1', default_customer: 'شركة العميل المحدد' },
      WALKIN,
    );

    expect(resolved).toEqual({ id: 'customer-1', name: 'شركة العميل المحدد' });
  });

  it('يرجع null عند غياب المعرّف فيعود POS للعميل النقدي الآمن', () => {
    // لا معرّف مثبت أصلاً.
    expect(resolvePosDefaultCustomer({ default_customer_id: null, default_customer: WALKIN }, WALKIN)).toBeNull();
    // معرّف فارغ لا يُعامَل كمرجع.
    expect(resolvePosDefaultCustomer({ default_customer_id: '', default_customer: 'اسم' }, WALKIN)).toBeNull();
  });

  it('لا مرجع صالح في الفرع الحالي: الخادم يعيد المعرّف null فيسقط للعميل النقدي', () => {
    // `normalizePosDefaultCustomerForRead` يعيد null لأي مرجع خارج النطاق،
    // فلا يصل معرّف غير صالح إلى هذه الطبقة — والنتيجة الرجوع النقدي بلا تسريب.
    expect(resolvePosDefaultCustomer({ default_customer_id: null, default_customer: 'اسم قديم' }, WALKIN)).toBeNull();
  });

  it('يسقط اسم العرض على تسمية العميل النقدي إن غاب اسم السجل', () => {
    expect(resolvePosDefaultCustomer({ default_customer_id: 'customer-2', default_customer: '' }, WALKIN))
      .toEqual({ id: 'customer-2', name: WALKIN });
  });
});
