# AWJ-PAY-H4-01 — ربط مشتري المتجر بطرف (D-05 خيار A) — تقرير التنفيذ

**الحالة:** مُنفَّذ. لا أثر محاسبي، لا هجرة، لا تغيير صلاحيات، البوابة الإلكترونية تبقى مغلقة افتراضياً.

## ما بُني
| البند | التفصيل |
|---|---|
| `CommercePartnerPolicy` | `link_verified_else_create` (افتراضي) · `generic_cash_customer` · `manual_link`؛ قيمة غير معروفة ⇒ الافتراضي |
| إعداد | `sales.commerce_partner_policy` في `Settings::DEFAULTS` و`UpdateSalesSettingsRequest` (تحقق `Rule::in`) |
| `ContactKey` | تطبيع هاتف (`05…`/`5…`/`00966`/`+966` ⇒ `966…`) وبريد |
| `CustomerPartnerResolver` | طرف `WEB-<hash>` حتمي، قفل استشاري على PG، استعادة المحذوف، رفض المعطَّل، تقدّم ربط الموظف لهوية موثَّقة |
| الربط | `CommercePaymentIntentService::createForOrder` — فرع الدفع الإلكتروني فقط |

## الاختبارات
- `CustomerPartnerResolverTest` (10) · `StorefrontOnlinePaymentTest` (31) · `CommerceOnlinePaymentPostgresConcurrencyTest` (4، منها سباق ٦ طلبات لنفس الهاتف ⇒ طرف واحد على PostgreSQL).
- انحدار: Settings/Storefront/CommerceOrder/CommerceCheckout/BranchIsolation/Flowers/PublicApi — 1961 ناجح، 20 مُتخطّى.

## المخاطر والمتبقي
- طرف لكل طلب حين لا يوجد هاتف/بريد (يتضخم عدد الأطراف) — مقبول؛ المتجر يفرض هاتفاً غالباً.
- لا ربط `CustomerIdentity ↔ Partner` تلقائي (لا قيمة `link_method` آلية) — مؤجَّل.
