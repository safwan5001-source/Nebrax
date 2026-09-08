import { useState } from 'react';
import { Combobox } from 'awj-design-system-v2';

const options = [
  { value: 'p1', label: 'لابتوب Dell Latitude', sub: 'SKU-1001', hint: '12 قطعة' },
  { value: 'p2', label: 'شاشة Samsung 27 بوصة', sub: 'SKU-1002', hint: '5 قطع' },
  { value: 'p3', label: 'طابعة HP LaserJet', sub: 'SKU-1003', hint: 'نفدت الكمية', disabled: true },
];

export function Selected() {
  const [value, setValue] = useState('p1');
  return (
    <div style={{ maxWidth: 300 }}>
      <Combobox
        value={value}
        onChange={setValue}
        options={options}
        placeholder="اختر صنفاً"
        searchPlaceholder="ابحث عن صنف..."
        emptyText="لا توجد نتائج"
        clearLabel="(بدون صنف)"
        footerLabel="إضافة صنف جديد"
        aria-label="اختيار الصنف"
      />
    </div>
  );
}

export function Empty() {
  const [value, setValue] = useState('');
  return (
    <div style={{ maxWidth: 300 }}>
      <Combobox
        value={value}
        onChange={setValue}
        options={options}
        placeholder="اختر مورداً"
        searchPlaceholder="ابحث عن مورد..."
        emptyText="لا توجد نتائج"
        aria-label="اختيار المورد"
      />
    </div>
  );
}
