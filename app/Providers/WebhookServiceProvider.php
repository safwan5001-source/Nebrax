<?php

namespace App\Providers;

use App\Http\Resources\PublicInvoiceResource;
use App\Http\Resources\PublicPartnerResource;
use App\Http\Resources\PublicProductResource;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Product;
use App\Services\WebhookEmitter;
use App\Support\WebhookEventCatalog;
use App\Support\WebhookHostResolver;
use App\Support\WebhookUrlValidator;
use App\Support\SystemWebhookHostResolver;
use Illuminate\Support\ServiceProvider;

/**
 * يسجّل بنية الـ Webhooks الصادرة (PR-7): تحقّق SSRF، و**إصدار على مستوى المجال**.
 *
 * الإصدار عبر مُلاحِظ `created` لنماذج Partner/Product/Invoice، فأيّ واجهة أنشأت
 * الكيان (Public API أو الواجهة الداخليّة) تُنتج الحدث نفسه — يراقب المتكامل حدث
 * الأعمال بصرف النظر عن منشئه. المُلاحِظ أثرٌ جانبيّ للقراءة فقط (يُدرج صفّ صندوق
 * صادر عند وجود مشترِك)، فلا يغيّر سلوك الأعمال، وعزلُ الفشل يضمن ألّا يكسر الإنشاء.
 *
 * الحمولة تُبنى من مورد الـ Public المُنتقى (لا Eloquent خام): الفاتورة **ملخّص
 * بلا سطور** (يطابق دلالة الـ API)، وتحمل `data.status` (مسودّة عبر الـ Public API).
 *
 * التسجيل: يُضاف إلى `bootstrap/providers.php` عبر سكربتات التجميع
 * (setup.sh · ci.yml · deploy/assemble.sh) بنمط TenancyServiceProvider.
 */
class WebhookServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(WebhookHostResolver::class, SystemWebhookHostResolver::class);

        // مُتحقّق SSRF: يُبنى من المُحلِّل الحاليّ + سياسة http (bind لا singleton
        // فتلتقط الاختبارات مُحلِّلًا حتميًّا). الإنتاج: HTTPS إلزاميّ.
        $this->app->bind(WebhookUrlValidator::class, function ($app): WebhookUrlValidator {
            return new WebhookUrlValidator(
                $app->make(WebhookHostResolver::class),
                (bool) config('webhooks.allow_insecure_url', false),
            );
        });
    }

    public function boot(): void
    {
        $emitter = fn (): WebhookEmitter => $this->app->make(WebhookEmitter::class);

        Partner::created(function (Partner $partner) use ($emitter): void {
            $emitter()->emit(
                $partner,
                WebhookEventCatalog::PARTNER_CREATED,
                fn (): array => (new PublicPartnerResource($partner))->resolve(request()),
            );
        });

        Product::created(function (Product $product) use ($emitter): void {
            $emitter()->emit(
                $product,
                WebhookEventCatalog::PRODUCT_CREATED,
                fn (): array => (new PublicProductResource($product))->resolve(request()),
            );
        });

        Invoice::created(function (Invoice $invoice) use ($emitter): void {
            $emitter()->emit(
                $invoice,
                WebhookEventCatalog::INVOICE_CREATED,
                // ملخّص بلا سطور — يطابق تمثيل إنشاء الفاتورة في الـ Public API.
                fn (): array => (new PublicInvoiceResource($invoice))->resolve(request()),
            );
        });
    }
}
