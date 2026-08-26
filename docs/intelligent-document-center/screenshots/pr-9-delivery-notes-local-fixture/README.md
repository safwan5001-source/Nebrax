# PR-9 Delivery Notes — Local Fixture Screenshots

> هذه اللقطات صادرة من **fixture محلية فقط** عبر Playwright. لا تتصل بواجهة Laravel ولا تمثل بيانات إنتاجية أو معاينة منشورة.

| الملف | المشهد | نتيجة المراجعة البصرية |
|---|---|---|
| `rtl-desktop-light-local-fixture.png` | قائمة RTL على سطح المكتب، وضع فاتح | يظهر عنوان سندات التسليم والفلاتر وجدول كثيف ومؤشرات الحالة ورابط التنقل تحت المبيعات بوضوح. لا يظهر أي إجراء فاتورة أو مخزون أو دفتر. |
| `rtl-mobile-light-local-fixture.png` | قائمة RTL على جوال 390px، وضع فاتح | تتحول القائمة إلى بطاقات قابلة للقراءة، وتظهر المرشحات ضمن عمود واحد بلا جدول عريض أو تمرير أفقي. |
| `rtl-desktop-confirmed-local-fixture.png` | سند تم تأكيده، RTL | يوثق الانتقال إلى حالة القراءة فقط في fixture. |
| `ltr-desktop-dark-local-fixture.png` | قائمة LTR، وضع داكن | يوثق توافق اتجاه LTR والسمات الداكنة في fixture. |

أُنشئت اللقطات من السيناريو `web/e2e/delivery-notes.fixture.spec.ts` بعد نجاح سيناريوهات Playwright الثمانية في البيئة المحلية.
