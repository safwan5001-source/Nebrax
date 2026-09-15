import { Table, THead, TBody, TR, TH, TD, Badge } from 'awj-design-system-v2';

const rows = [
  { name: 'مؤسسة الأفق التجارية', number: 'INV-2026-0041', total: '4,830.00', status: 'مدفوعة' as const },
  { name: 'شركة الواحة للتجارة', number: 'INV-2026-0042', total: '1,250.50', status: 'مستحقة' as const },
  { name: 'محمد العتيبي', number: 'INV-2026-0043', total: '860.00', status: 'متأخرة' as const },
];

const tone = { مدفوعة: 'positive', مستحقة: 'warning', متأخرة: 'negative' } as const;

export function Default() {
  return (
    <Table>
      <THead>
        <TR>
          <TH>العميل</TH>
          <TH>رقم الفاتورة</TH>
          <TH>الإجمالي</TH>
          <TH>الحالة</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TR key={row.number}>
            <TD>{row.name}</TD>
            <TD className="num">{row.number}</TD>
            <TD className="num">{row.total} ر.س</TD>
            <TD>
              <Badge tone={tone[row.status]}>{row.status}</Badge>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
