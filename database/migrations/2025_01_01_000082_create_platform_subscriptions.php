<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // عقد تشغيل داخلي للمنصة، منفصل عن فواتير وقيود المستأجر المحاسبية.
        // `monthly_amount` التزام شهري متعاقد عليه بالهللات، وليس تحصيل نقدي فعلياً.
        Schema::create('platform_subscriptions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('plan');
            $table->string('status')->default('active'); // trial | active | cancelled | expired
            $table->unsignedBigInteger('monthly_amount');
            $table->string('currency', 3)->default('SAR');
            $table->date('starts_on');
            $table->date('ends_on')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->string('external_reference')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'status']);
            $table->index(['status', 'starts_on', 'ends_on']);
            $table->unique(['tenant_id', 'external_reference']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_subscriptions');
    }
};
