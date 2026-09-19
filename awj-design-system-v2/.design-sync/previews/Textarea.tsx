import { Textarea, Label } from 'awj-design-system-v2';

export function Default() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 320 }}>
      <Label htmlFor="preview-textarea">ملاحظات الفاتورة</Label>
      <Textarea
        id="preview-textarea"
        defaultValue={'يرجى التسليم قبل الساعة 5 مساءً.\nالدفع خلال 30 يوماً من تاريخ الاستحقاق.'}
      />
    </div>
  );
}

export function Placeholder() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 320 }}>
      <Label htmlFor="preview-textarea-placeholder">وصف المشترى</Label>
      <Textarea id="preview-textarea-placeholder" placeholder="أدخل تفاصيل إضافية عن أمر الشراء..." />
    </div>
  );
}
