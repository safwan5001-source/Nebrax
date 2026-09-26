import { useState } from 'react';
import { Tabs, TabPanel } from 'awj-design-system-v2';

const tabs = [
  { id: 'summary', label: 'الملخص' },
  { id: 'lines', label: 'البنود', count: 4 },
  { id: 'payments', label: 'المدفوعات', count: 1 },
];

export function Default() {
  const [value, setValue] = useState('lines');
  return (
    <div style={{ maxWidth: 360 }}>
      <Tabs tabs={tabs} value={value} onChange={setValue} />
      <TabPanel id={value}>
        <div style={{ padding: '12px 4px', fontSize: 13 }}>
          {value === 'summary' && 'إجمالي الفاتورة 4,830.00 ر.س شامل الضريبة.'}
          {value === 'lines' && 'أربعة بنود مضافة للفاتورة.'}
          {value === 'payments' && 'دفعة واحدة مسجّلة بتاريخ اليوم.'}
        </div>
      </TabPanel>
    </div>
  );
}
