<?php

namespace App\Console\Commands;

use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * COM-7-OPS-1 — ضمان وجود قناة بيع web نشطة لمستأجر محدَّد صراحةً.
 *
 * مثالي التكرار (idempotent): إعادة التشغيل لنفس المستأجر لا تُنشئ صفاً مكرراً
 * ولا تُعدّل قناةً قائمة صحيحة. يفشل مغلقاً عند الغموض أو التعارض
 * (عدة قنوات web نشطة، قناة web معطّلة، سلاج web محجوز بنوع غير متوافق).
 *
 * لا يُنشئ Storefront ولا StorefrontDomain ولا يُسجّل نطاقاً — ذلك
 * يبقى مسؤولية `storefront:register-domain` بعد وجود القناة.
 */
class EnsureWebSalesChannelCommand extends Command
{
    protected $signature = 'sales-channel:ensure-web
        {tenant : معرّف المستأجر (UUID) أو الـ slug — يزوّده المشغّل صراحةً، لا تخمين}';

    protected $description = 'ضمان وجود قناة بيع web نشطة لمستأجر محدَّد صراحةً — مثالي التكرار، لا يخمّن المستأجر ولا يُعيد تفعيل قناة معطّلة';

    public function handle(): int
    {
        $tenantRef = (string) $this->argument('tenant');

        // عمود tenants.id من نوع uuid حرفياً في PostgreSQL — مقارنته بقيمة ليست
        // UUID (مثل slug عادي) تفشل الاستعلام كاملاً هناك. نفس نمط
        // RegisterStorefrontDomainCommand / RecordPlatformSubscriptionCommand.
        $tenants = Tenant::query()
            ->when(
                Str::isUuid($tenantRef),
                fn ($query) => $query->where('id', $tenantRef)->orWhere('slug', $tenantRef),
                fn ($query) => $query->where('slug', $tenantRef),
            )
            ->get();

        if ($tenants->isEmpty()) {
            $this->error("المستأجر «{$tenantRef}» غير موجود. لم يُغيَّر شيء — زوّد معرّفاً أو slug صحيحاً لمستأجر قائم فعلاً.");

            return self::FAILURE;
        }

        if ($tenants->count() > 1) {
            $ids = $tenants->pluck('id')->implode(', ');
            $this->error(
                "معرّف المستأجر «{$tenantRef}» غامض — يطابق أكثر من مستأجر ({$ids}). لم يُغيَّر شيء.",
            );

            return self::FAILURE;
        }

        $tenant = $tenants->first();

        // ResolveStorefrontTenant يرفض المستأجر غير النشط لمسارات الكتالوج العام.
        // إنشاء قناة تجارة لمستأجر موقوف ليس فعلاً تجارياً — يفشل مغلقاً.
        if (! $tenant->is_active) {
            $this->error(
                "المستأجر «{$tenant->slug}» غير نشط. لم يُغيَّر شيء — تفعيل المستأجر قرار تشغيلي صريح خارج هذا الأمر.",
            );

            return self::FAILURE;
        }

        app(TenantContext::class)->set($tenant->id);

        try {
            return $this->ensureChannel($tenant);
        } catch (RuntimeException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        } finally {
            app(TenantContext::class)->forget();
        }
    }

    private function ensureChannel(Tenant $tenant): int
    {
        $activeWeb = SalesChannel::query()
            ->where('type', SalesChannel::TYPE_WEB)
            ->where('is_active', true)
            ->get();

        if ($activeWeb->count() > 1) {
            $ids = $activeWeb->pluck('id')->implode(', ');
            $this->error(
                "يوجد أكثر من قناة بيع web نشطة لهذا المستأجر ({$ids}). ".
                'لم يُغيَّر شيء — لا يخمّن هذا الأمر أي قناة ولا يعدّل أياً منها.',
            );

            return self::FAILURE;
        }

        if ($activeWeb->count() === 1) {
            $channel = $activeWeb->first();
            $this->info(
                "قناة البيع web قائمة بالفعل: {$channel->name} ({$channel->id}) للمستأجر {$tenant->name} ({$tenant->slug}). لم يُعدَّل شيء.",
            );

            return self::SUCCESS;
        }

        $occupant = SalesChannel::query()
            ->withTrashed()
            ->where('slug', 'web')
            ->first();

        if ($occupant !== null) {
            if ($occupant->trashed()) {
                $this->error(
                    "السلاج «web» محجوز بقناة محذوفة ناعماً (معرّف {$occupant->id}). ".
                    'لم يُغيَّر شيء — الاستعادة قرار تجاري صريح خارج هذا الأمر.',
                );

                return self::FAILURE;
            }

            if ($occupant->type === SalesChannel::TYPE_WEB && ! $occupant->is_active) {
                $this->error(
                    "توجد قناة بيع web بالسلاج «web» لكنها غير نشطة (معرّف {$occupant->id}). ".
                    'لم يُغيَّر شيء — إعادة التفعيل قرار تجاري صريح خارج هذا الأمر.',
                );

                return self::FAILURE;
            }

            $this->error(
                "السلاج «web» محجوز بقناة غير متوافقة (نوع {$occupant->type}، معرّف {$occupant->id}). ".
                'لم يُغيَّر شيء — هذا الأمر لا يستبدل قناةً قائمة ولا يغيّر نوعها.',
            );

            return self::FAILURE;
        }

        $channel = DB::transaction(function () use ($tenant) {
            $created = SalesChannel::create([
                'tenant_id' => $tenant->id,
                'slug' => 'web',
                'name' => 'المتجر الإلكتروني',
                'type' => SalesChannel::TYPE_WEB,
                'is_active' => true,
            ]);

            if ($created->tenant_id !== $tenant->id) {
                throw new RuntimeException(
                    'عزل المستأجر انكسر عند إنشاء قناة البيع. أُلغي الإنشاء. لم يُغيَّر شيء.',
                );
            }

            return $created;
        });

        $this->info(
            "أُنشئت قناة البيع web: {$channel->name} ({$channel->id}) للمستأجر {$tenant->name} ({$tenant->slug}).",
        );

        return self::SUCCESS;
    }
}
