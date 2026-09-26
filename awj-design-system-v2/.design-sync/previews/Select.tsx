import { Select, Label } from 'awj-design-system-v2';

export function Default() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 260 }}>
      <Label htmlFor="preview-select-branch">الفرع</Label>
      <Select id="preview-select-branch" defaultValue="dammam">
        <option value="dammam">الدمام</option>
        <option value="jubail">الجبيل</option>
        <option value="khobar">الخبر</option>
        <option value="dhahran">الظهران</option>
        <option value="ahsa">الأحساء</option>
      </Select>
    </div>
  );
}

export function Disabled() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 260 }}>
      <Label htmlFor="preview-select-disabled">طريقة الدفع</Label>
      <Select id="preview-select-disabled" defaultValue="cash" disabled>
        <option value="cash">نقدي</option>
        <option value="bank">تحويل بنكي</option>
      </Select>
    </div>
  );
}
