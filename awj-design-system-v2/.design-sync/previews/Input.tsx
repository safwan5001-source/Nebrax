import { Input, Label } from 'awj-design-system-v2';

export function Text() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 260 }}>
      <Label htmlFor="preview-input-text">اسم الصنف</Label>
      <Input id="preview-input-text" defaultValue="لابتوب Dell Latitude" />
    </div>
  );
}

export function Placeholder() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 260 }}>
      <Label htmlFor="preview-input-placeholder">رقم الجوال</Label>
      <Input id="preview-input-placeholder" placeholder="05xxxxxxxx" dir="ltr" />
    </div>
  );
}

export function GregorianDate() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 260 }}>
      <Label htmlFor="preview-input-date">تاريخ الاستحقاق</Label>
      <Input id="preview-input-date" type="date" defaultValue="2026-09-08" />
    </div>
  );
}

export function Invalid() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 260 }}>
      <Label htmlFor="preview-input-invalid">الرقم الضريبي</Label>
      <Input id="preview-input-invalid" defaultValue="12345" aria-invalid="true" />
    </div>
  );
}

export function Disabled() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 260 }}>
      <Label htmlFor="preview-input-disabled">رقم المستند</Label>
      <Input id="preview-input-disabled" defaultValue="INV-2026-0042" disabled />
    </div>
  );
}
