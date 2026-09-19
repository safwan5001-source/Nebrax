import { Button } from 'awj-design-system-v2';

export function Variants() {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <Button variant="primary">حفظ الفاتورة</Button>
      <Button variant="outline">إلغاء</Button>
      <Button variant="ghost">عرض التفاصيل</Button>
      <Button variant="danger">حذف</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Button size="sm">صغير</Button>
      <Button size="md">متوسط</Button>
      <Button size="icon" aria-label="إضافة">+</Button>
    </div>
  );
}

export function Disabled() {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <Button variant="primary" disabled>
        جارٍ الحفظ...
      </Button>
      <Button variant="outline" disabled>
        غير متاح
      </Button>
    </div>
  );
}
