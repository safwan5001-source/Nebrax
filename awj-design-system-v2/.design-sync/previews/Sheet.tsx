import { Sheet, SheetContent, SheetTitle, SheetDescription, Button } from 'awj-design-system-v2';

export function Default() {
  return (
    <Sheet defaultOpen modal={false}>
      <SheetContent closeLabel="إغلاق">
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
          <SheetTitle style={{ fontSize: 16, fontWeight: 600 }}>تفاصيل الصنف</SheetTitle>
          <SheetDescription style={{ fontSize: 13, color: 'var(--muted)' }}>
            لابتوب Dell Latitude — الكمية المتوفرة: 12 قطعة
          </SheetDescription>
          <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="primary">تعديل الصنف</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
