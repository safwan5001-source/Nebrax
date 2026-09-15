import { useState } from 'react';
import { Switch, Label } from 'awj-design-system-v2';

export function States() {
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Switch id="preview-switch-on" checked={on} onCheckedChange={setOn} aria-labelledby="preview-switch-on-label" />
        <Label id="preview-switch-on-label" htmlFor="preview-switch-on">
          إرسال إشعار عبر البريد
        </Label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Switch id="preview-switch-off" checked={off} onCheckedChange={setOff} aria-labelledby="preview-switch-off-label" />
        <Label id="preview-switch-off-label" htmlFor="preview-switch-off">
          تفعيل الوضع الليلي
        </Label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Switch id="preview-switch-disabled" checked={false} onCheckedChange={() => {}} disabled aria-labelledby="preview-switch-disabled-label" />
        <Label id="preview-switch-disabled-label" htmlFor="preview-switch-disabled">
          غير متاح لهذا الدور
        </Label>
      </div>
    </div>
  );
}
