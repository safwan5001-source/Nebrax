import { Dialog, Button } from 'awj-design-system-v2';

export function Default() {
  // Dialog renders via `position: fixed; inset: 0`, sized relative to the card's
  // transformed mount point. That mount point has no intrinsic height of its own
  // (nothing else in the card is in normal flow), so without this sized sibling
  // the fixed overlay resolves to zero height in the static capture. This wrapper
  // is preview-only scaffolding — it does not change Dialog's own markup or behavior.
  return (
    <div style={{ position: 'relative', height: 420 }}>
      <Dialog open title="تأكيد حذف الفاتورة" onClose={() => {}}>
        <p style={{ fontSize: 14, marginBottom: 16 }}>
          هل أنت متأكد من حذف الفاتورة رقم INV-2026-0042؟ لا يمكن التراجع عن هذا الإجراء.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="outline">إلغاء</Button>
          <Button variant="danger">حذف</Button>
        </div>
      </Dialog>
    </div>
  );
}
