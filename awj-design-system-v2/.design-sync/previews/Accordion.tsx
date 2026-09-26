import { useState } from 'react';
import { Accordion, AccordionItem } from 'awj-design-system-v2';

export function Default() {
  const [openId, setOpenId] = useState('shipping');
  return (
    <Accordion style={{ maxWidth: 340 }}>
      <AccordionItem
        id="shipping"
        title="سياسة الشحن"
        count={2}
        open={openId === 'shipping'}
        onToggle={() => setOpenId(openId === 'shipping' ? '' : 'shipping')}
      >
        <p style={{ fontSize: 13 }}>يتم الشحن خلال 3-5 أيام عمل داخل المنطقة الشرقية.</p>
      </AccordionItem>
      <AccordionItem
        id="returns"
        title="سياسة الإرجاع"
        open={openId === 'returns'}
        onToggle={() => setOpenId(openId === 'returns' ? '' : 'returns')}
      >
        <p style={{ fontSize: 13 }}>يمكن إرجاع المنتج خلال 14 يوماً بفاتورة الشراء.</p>
      </AccordionItem>
    </Accordion>
  );
}
