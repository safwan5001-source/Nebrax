import { Badge } from 'awj-design-system-v2';

export function Tones() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Badge tone="neutral">جديد</Badge>
      <Badge tone="muted">مسودة</Badge>
      <Badge tone="positive">مدفوعة</Badge>
      <Badge tone="warning">مستحقة قريباً</Badge>
      <Badge tone="negative">متأخرة</Badge>
    </div>
  );
}
