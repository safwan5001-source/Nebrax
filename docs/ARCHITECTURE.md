# نبراس ERP — المخطط المعماري (SaaS متعدد المستأجرين)

## نظرة عامة
نظام محاسبي سحابي ERP، multi-tenant، بنموذج اشتراكات. مبني على نواة قيد مزدوج صارمة.

## الطبقات (Layers)

```
┌─────────────────────────────────────────────────────────┐
│  Frontend: Next.js 15 (TypeScript, Tailwind, shadcn/ui)  │  ← RTL أولاً
├─────────────────────────────────────────────────────────┤
│  API Gateway: Laravel Sanctum (JWT) + RBAC + Rate Limit  │
├─────────────────────────────────────────────────────────┤
│  Application Services (Domain Logic)                      │
│   • LedgerService (محرك القيد المزدوج) ← النواة          │
│   • InvoiceService / PurchaseService / InventoryService  │
│   • TaxService (VAT 15%) / ZatcaService (الفاتورة)       │
├─────────────────────────────────────────────────────────┤
│  Tenancy Layer: TenantScope (Global Scope) + Middleware  │
├─────────────────────────────────────────────────────────┤
│  PostgreSQL (single DB, tenant_id discriminator)         │
│  Redis (cache + BullMQ-style queues عبر Horizon)         │
│  S3/R2 (مرفقات + PDF الفواتير)                            │
└─────────────────────────────────────────────────────────┘
```

## نموذج Multi-Tenancy
- **Discriminator**: عمود `tenant_id` على كل جدول أعمال.
- **العزل**: `TenantScope` (Eloquent Global Scope) يحقن `WHERE tenant_id = ?` تلقائياً.
- **السياق**: `app(TenantContext::class)->id()` يُحدَّد من JWT في الـ middleware.
- **منع التسرّب**: لا استعلام يدوي بدون scope — تُفرض عبر BaseModel.

## النواة المالية (Double-Entry)
كل حدث مالي يُترجم إلى **Journal Entry** متوازن:
- `Σ debit = Σ credit` (يُفرض داخل transaction، يُرفض غير المتوازن).
- القيود **immutable** — التعديل ممنوع، التصحيح بقيد عكسي (reversal).
- الأرصدة تُحسب من القيود (source of truth)، مع لقطات (snapshots) للأداء.

## النقود
- كل المبالغ بالـ **minor units** (هللات) كـ `bigint`. 100.50 ريال = `10050`.
- لا `float` / `double` في أي مكان مالي إطلاقاً.

## الوحدات (Build Order)
1. ✅ Auth + Tenancy + RBAC
2. ✅ Chart of Accounts + Ledger Engine  ← **التسليم الحالي**
3. Partners (عملاء/موردون) + Products
4. Sales (فواتير → قيود تلقائية)
5. Purchases
6. Inventory (perpetual)
7. Financial Reports (ميزان المراجعة، قائمة الدخل، الميزانية)
8. ZATCA e-invoicing (Phase 1 + 2)
9. POS + HR/Payroll

## نموذج الاشتراكات (SaaS)
- خطط: Free / Basic / Pro / Enterprise.
- حدود لكل خطة: عدد المستخدمين، الفواتير/شهر، الفروع، الوحدات المفعّلة.
- يُفرض عبر `PlanLimit` middleware + feature flags على مستوى المستأجر.
