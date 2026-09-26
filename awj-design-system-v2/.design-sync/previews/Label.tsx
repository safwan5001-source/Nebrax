import { Label, Input } from 'awj-design-system-v2';

export function WithField() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 260 }}>
      <Label htmlFor="preview-partner-name">اسم العميل</Label>
      <Input id="preview-partner-name" defaultValue="مؤسسة الأفق التجارية" />
    </div>
  );
}
