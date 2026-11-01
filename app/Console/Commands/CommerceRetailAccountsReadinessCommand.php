<?php

namespace App\Console\Commands;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;

/**
 * B2C ACTIVATION READINESS — فحص تشغيلي **للقراءة فقط** قبل تفعيل حسابات المتسوّقين.
 *
 * لا يرسل بريداً، لا يكتب في أي جدول، لا يطبع سراً (المفاتيح تُعرض كـ«موجود/غائب» فقط). يجيب عن: هل البوابة مغلقة؟ أي متاجر فُعّلت
 * حساباتها؟ هل لكل منها نطاق موثَّق نشط (مضيف الروابط في البريد)؟ هل ناقل البريد يسلّم فعلاً؟ هل المرسِل مضبوط؟ هل هوية الزائر الموقَّعة
 * مفعّلة؟ ثم يخرج بـ1 إن وُجد مانع يمنع التفعيل الآمن.
 *
 *   php artisan commerce:retail-accounts-readiness
 *
 * إثبات وصول الرسالة إلى صندوق وارد حقيقي لا يمكن أن يتم من هنا (لا يُرسَل شيء): الخطوة اليدوية في تقرير الجاهزية.
 */
final class CommerceRetailAccountsReadinessCommand extends Command
{
    /** نواقل لا تسلّم بريداً إلى صندوق حقيقي. */
    private const NON_DELIVERING_MAILERS = ['log', 'array', 'null'];

    protected $signature = 'commerce:retail-accounts-readiness';

    protected $description = 'فحص جاهزية تفعيل حسابات المتسوّقين (قراءة فقط: بوابات، بريد، روابط، حدود معدل) — لا يرسل شيئاً';

    public function handle(TenantContext $tenantContext): int
    {
        $blockers = [];
        $notes = [];
        $activation = []; // blockers that only matter once accounts are (about to be) switched on

        $deployment = (bool) config('commerce.retail_accounts_enabled');
        $this->line('COMMERCE_RETAIL_ACCOUNTS_ENABLED: '.($deployment ? 'ON' : 'OFF (closed — the safe default)'));
        $this->line('COMMERCE_WHOLESALE_BUYER_ENABLED: '.((bool) config('commerce.wholesale_buyer_enabled') ? 'ON' : 'OFF'));

        // ── البريد ─────────────────────────────────────────────
        $mailer = (string) config('mail.default');
        $from = (string) config('mail.from.address');
        $this->line("mail transport: {$mailer}");
        $this->line('mail from: '.($from !== '' ? $from : '(missing)').' / name: '.((string) config('mail.from.name') !== '' ? 'set' : '(missing)'));
        if ($mailer === 'resend') {
            $this->line('RESEND_KEY: '.((string) config('services.resend.key') !== '' ? 'present' : 'MISSING'));
        }
        $this->line('verification link ttl: '.(int) config('commerce.buyer_verification_ttl_minutes').' min · reset link ttl: '.(int) config('commerce.buyer_password_reset_ttl_minutes').' min · session: '.(int) config('commerce.account_session_days').' days');

        if (in_array($mailer, self::NON_DELIVERING_MAILERS, true)) {
            $activation[] = "mail transport '{$mailer}' does not deliver to real inboxes";
        }
        if (filter_var($from, FILTER_VALIDATE_EMAIL) === false) {
            $activation[] = 'MAIL_FROM_ADDRESS is missing or not a valid address';
        }
        if ($mailer === 'resend' && (string) config('services.resend.key') === '') {
            $activation[] = 'MAIL_MAILER=resend but RESEND_KEY is missing';
        }
        if (in_array(strtolower((string) (explode('@', $from)[1] ?? '')), ['example.com', 'example.org', 'localhost', 'resend.dev'], true)) {
            $activation[] = 'sender domain is a placeholder/sandbox domain (resend.dev only delivers to the account owner)';
        }

        // ── حدود المعدل ────────────────────────────────────────
        $signed = (bool) config('storefront.client_identity.enabled');
        $this->line('STOREFRONT_SIGNED_CLIENT_IP_ENABLED: '.($signed ? 'ON' : 'OFF (shared per-store login bucket)'));
        $this->line('STOREFRONT_GATEWAY_SECRET: '.((string) config('storefront.gateway_secret') !== '' ? 'present' : 'MISSING'));
        if ((string) config('storefront.gateway_secret') === '') {
            $activation[] = 'STOREFRONT_GATEWAY_SECRET is missing — the storefront cannot reach tenant stores';
        }

        // ── المتاجر المفعّلة ───────────────────────────────────
        $enabled = 0;
        foreach (Tenant::query()->orderBy('created_at')->get(['id', 'slug']) as $tenant) {
            $tenantContext->set($tenant->id);
            try {
                $channels = SalesChannel::query()->where('type', SalesChannel::TYPE_WEB)->where('customer_accounts_enabled', true)->get();
                foreach ($channels as $channel) {
                    $enabled++;
                    $storefront = Storefront::query()->where('sales_channel_id', $channel->id)->where('is_active', true)->first();
                    $host = $storefront === null ? null : StorefrontDomain::query()
                        ->where('storefront_id', $storefront->id)->where('is_active', true)
                        ->where('verification_status', StorefrontDomain::VERIFICATION_VERIFIED)
                        ->orderByDesc('is_primary')->orderBy('created_at')->value('hostname');
                    $this->line("  store {$tenant->slug}: accounts ON · e-mail link host: ".($host ?? 'NONE').($channel->wholesale_membership_enabled ? ' · wholesale ALSO open' : ''));
                    if ($host === null) {
                        $blockers[] = "tenant {$tenant->slug}: accounts enabled but no verified active domain — verification/reset e-mails cannot be sent";
                    }
                }
            } finally {
                $tenantContext->forget();
            }
        }
        $this->line("stores with accounts enabled: {$enabled}");

        if ($enabled > 0 && ! $deployment) {
            $notes[] = 'channels are flagged but the deployment flag is OFF — they are inert (uniform 404) until it is turned on';
        }
        if ($deployment || $enabled > 0) {
            $blockers = array_merge($blockers, $activation);
        } elseif ($activation !== []) {
            $notes = array_merge($notes, array_map(fn (string $m): string => "before activation: {$m}", $activation));
        }

        foreach ($notes as $note) {
            $this->warn("note: {$note}");
        }
        foreach ($blockers as $blocker) {
            $this->error("BLOCKER: {$blocker}");
        }
        $this->line($blockers === [] ? 'readiness: no blockers detected (inbox delivery still needs the manual check in the readiness report)' : 'readiness: BLOCKED');

        return $blockers === [] ? self::SUCCESS : self::FAILURE;
    }
}
