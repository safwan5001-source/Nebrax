<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\Warehouse;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * FLOWERS-H2-15 — رحلة التاجر الإدارية الكاملة على الـAPI الفعلي، كعقد مشترك مع واجهة الإدارة.
 *
 * `contracts/flowers-admin-journey/requests.json` يُولَّد من اختبار الواجهة (`admin-journey-contract.test.ts`) من
 * طلبات العميل الفعلية؛ هنا تُعاد **كما هي** على الخادم (سياسة الإهداء ← قواعد الجدولة ← النوافذ ← التواريخ المحجوبة ←
 * مخزن التنفيذ ← تجهيز المنتج ← التخصيص ← الإضافات ← المحتوى ← قائمة الإعداد). كل طلب يجب أن يُقبل (2xx)، وتُلتقط
 * الاستجابات في `responses/*.json` وتُقارَن بالعقد في كل تشغيل؛ تقرؤها واجهة الإدارة بمحلّلاتها الفعلية.
 * فلا ينحرف الخادم عن الواجهة بصمت، ولا يُقبل من الواجهة طلبٌ يرفضه الخادم.
 *
 * تحديث العقد عمداً: FLOWERS_WRITE_CONTRACT=1 php artisan test --filter=FlowersMerchantAdminJourneyTest
 */
class FlowersMerchantAdminJourneyTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @var array<string, string> */
    private array $ids = [];

    private function contractDir(): string
    {
        return base_path('contracts/flowers-admin-journey');
    }

    /** يستبدل رموز العقد (STORE/PRODUCT/…) بمعرّفات حقيقية، في المسار والجسم معاً. */
    private function bind(mixed $value, array $tokens): mixed
    {
        if (is_array($value)) {
            return array_map(fn ($v) => $this->bind($v, $tokens), $value);
        }
        if (is_string($value)) {
            return strtr($value, $tokens);
        }

        return $value;
    }

    private const REVISION_TOKEN = '<REVISION>';

    /**
     * الواجهة تمرّر بصمة المستند الذي قرأته (`expected_revision`)؛ العقد يحمل رمزاً نائباً، وهنا يُستبدل بالبصمة الحيّة
     * من قراءة المستند نفسه قبل الحفظ (كما تفعل اللوحة عند التحميل) — فيمرّ الطلب الحاوي للبصمة على الخادم الفعلي.
     */
    private function bindRevision(string $token, string $path, array $body): array
    {
        if (($body['expected_revision'] ?? null) !== self::REVISION_TOKEN) {
            return $body;
        }
        [$read, $key] = match (true) {
            str_ends_with($path, '/delivery-schedule/slots') => [dirname($path), 'slots_revision'],
            str_ends_with($path, '/delivery-schedule/blocked-dates') => [dirname($path), 'blocked_dates_revision'],
            default => [$path, 'revision'],
        };
        $revision = $this->withToken($token)->getJson('/api'.$read)->assertOk()->json('data.'.$key);
        $this->assertIsString($revision, "لا بصمة حيّة في قراءة {$read}");
        $body['expected_revision'] = $revision;

        return $body;
    }

    /** يستبدل المعرّفات (UUID) بمعرّفات نائبة ثابتة بترتيب الظهور فيبقى العقد ثابتاً بين التشغيلات. */
    private function normalize(mixed $value): mixed
    {
        if (is_array($value)) {
            $out = [];
            foreach ($value as $key => $v) {
                // البصمات (`revision`/`*_revision`) تُشتقّ من محتوى يضمّ معرّفات عشوائية؛ نثبت أنها sha1 صالحة ونعيّن لها قيمة نائبة.
                $out[$key] = is_string($key) && ($key === 'revision' || str_ends_with($key, '_revision')) && is_string($v)
                    ? (preg_match('/^[0-9a-f]{40}$/', $v) === 1 ? '<sha1-revision>' : '<invalid-revision>')
                    : $this->normalize($v);
            }

            return $out;
        }
        if (is_string($value) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value) === 1) {
            return $this->ids[$value] ??= sprintf('00000000-0000-4000-8000-%012d', count($this->ids) + 1);
        }

        return $value;
    }

    /** @test */
    public function the_merchant_admin_journey_replays_the_client_requests_and_matches_the_shared_contract(): void
    {
        $requests = json_decode((string) file_get_contents($this->contractDir().'/requests.json'), true);
        $this->assertIsArray($requests, 'requests.json يُولَّد من اختبار الواجهة (FLOWERS_ADMIN_WRITE_CONTRACT=1).');
        ksort($requests);

        $auth = $this->registerTenant('adm-journey', 'owner@adm-journey.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $store = Storefront::create(['slug' => 'main', 'name' => 'ورد الندى', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        $product = Product::create(['name' => 'باقة ورد', 'type' => 'good', 'unit' => 'piece', 'sale_price' => 25000, 'is_active' => true]);
        $addon = Product::create(['name' => 'شوكولاتة', 'type' => 'good', 'unit' => 'piece', 'sale_price' => 3500, 'is_active' => true]);
        $warehouse = Warehouse::create(['name' => 'المخزن الرئيسي', 'code' => 'JRN-1', 'city' => 'الدمام']);
        app(TenantContext::class)->forget();

        $tokens = ['STORE' => $store->id, 'PRODUCT' => $product->id, 'ADDON' => $addon->id, 'WAREHOUSE' => $warehouse->id];
        $token = $auth['token'];

        // ملف النشاط والقيم المبدئية: خطوات تهيئة سابقة للرحلة (شاشات المتاجر/الإعداد القائمة، خارج عقد الحفظ هذا).
        $this->withToken($token)->putJson('/api/commerce/workspace/storefronts/'.$store->id, ['business_vertical' => 'flowers_gifts'])->assertOk();
        $this->withToken($token)->postJson('/api/commerce/workspace/storefronts/'.$store->id.'/vertical-setup/starters')->assertOk();

        $captured = [];
        foreach ($requests as $name => $request) {
            $path = strtr($request['path'], $tokens);
            $body = $request['body'] === null ? [] : $this->bindRevision($token, $path, $this->bind($request['body'], $tokens));
            $response = $this->withToken($token)->json($request['method'], '/api'.$path, $body);
            $response->assertSuccessful("الطلب «{$name}» الذي تبنيه الواجهة رفضه الخادم: ".$response->getContent());
            $captured[$name] = $response->json();
        }

        // بصمةٌ قديمة تُرفض بـ409 ولا يُكتب شيء (التزامن بين تاجرين) — على المسار الحقيقي نفسه الذي حفظته الرحلة.
        $personalization = '/api/commerce/workspace/products/'.$product->id.'/personalization';
        $this->withToken($token)->putJson($personalization, ['expected_revision' => str_repeat('0', 40), 'fields' => []])->assertStatus(409);
        $this->withToken($token)->getJson($personalization)->assertOk()->assertJsonCount(2, 'data.fields');

        $this->assertMatchesContract($captured);
    }

    private function assertMatchesContract(array $captured): void
    {
        $dir = $this->contractDir().'/responses';
        $write = getenv('FLOWERS_WRITE_CONTRACT') === '1';
        if ($write && ! is_dir($dir)) {
            mkdir($dir, 0777, true);
        }

        foreach ($captured as $name => $payload) {
            $normalized = $this->normalize($payload);
            $file = $dir.'/'.$name.'.json';

            if ($write) {
                file_put_contents($file, json_encode($normalized, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)."\n");

                continue;
            }

            $this->assertFileExists($file, "عقد الخطوة «{$name}» غير موجود — شغّل الاختبار مع FLOWERS_WRITE_CONTRACT=1 وراجع الفرق.");
            // مقارنة صارمة (النوع والترتيب): `true` ⇒ `1` تغيّر نوع تكسره محلّلات الواجهة الصارمة وقد يمرّ بمقارنةٍ فضفاضة.
            $this->assertSame(
                json_decode((string) file_get_contents($file), true),
                json_decode(json_encode($normalized), true),
                "استجابة «{$name}» انحرفت عن العقد المشترك مع واجهة الإدارة — إن كان التغيير مقصوداً حدّث العقد ومحلّلات الواجهة معاً.",
            );
        }
    }
}
