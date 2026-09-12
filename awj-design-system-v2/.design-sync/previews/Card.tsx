import { Card, CardHeader, CardTitle, CardContent, Badge } from 'awj-design-system-v2';

export function Default() {
  return (
    <Card style={{ maxWidth: 320 }}>
      <CardHeader>
        <CardTitle>إجمالي المبيعات هذا الشهر</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="num" style={{ fontSize: 24, fontWeight: 600 }}>
          48,320.00 ر.س
        </p>
        <div style={{ marginTop: 8 }}>
          <Badge tone="positive">+12% عن الشهر الماضي</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
