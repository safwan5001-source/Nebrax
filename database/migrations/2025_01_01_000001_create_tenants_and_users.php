<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // المستأجرون (الشركات المشتركة في النظام)
        Schema::create('tenants', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name');                       // اسم الشركة
            $table->string('slug')->unique();             // معرّف فريد للرابط
            $table->string('vat_number', 15)->nullable(); // الرقم الضريبي (15 رقم في السعودية)
            $table->string('cr_number')->nullable();      // السجل التجاري
            $table->string('currency', 3)->default('SAR');
            $table->string('country', 2)->default('SA');
            $table->string('timezone')->default('Asia/Riyadh');
            $table->string('plan')->default('free');      // free | basic | pro | enterprise
            $table->json('feature_flags')->nullable();    // الوحدات المفعّلة
            $table->json('plan_limits')->nullable();      // {users:5, invoices_month:100, branches:1}
            $table->timestamp('trial_ends_at')->nullable();
            $table->timestamp('subscription_ends_at')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();
        });

        // المستخدمون (مربوطون بمستأجر)
        Schema::create('users', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('name');
            $table->string('email');
            $table->timestamp('email_verified_at')->nullable();
            $table->string('password');
            $table->string('role')->default('staff');     // owner | admin | accountant | staff
            $table->json('permissions')->nullable();       // صلاحيات دقيقة إضافية
            $table->boolean('is_active')->default(true);
            $table->rememberToken();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['tenant_id', 'email']);        // البريد فريد داخل المستأجر فقط
            $table->index('tenant_id');
        });

        Schema::create('personal_access_tokens', function (Blueprint $table) {
            $table->id();
            $table->morphs('tokenable');
            $table->string('name');
            $table->string('token', 64)->unique();
            $table->text('abilities')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('personal_access_tokens');
        Schema::dropIfExists('users');
        Schema::dropIfExists('tenants');
    }
};
