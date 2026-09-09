<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Composite parent keys let the link table enforce tenant equality in the
        // database, not only in application services.
        Schema::table('users', function (Blueprint $table) {
            $table->unique(['tenant_id', 'id'], 'users_tenant_id_id_unique');
        });
        Schema::table('partners', function (Blueprint $table) {
            $table->unique(['tenant_id', 'id'], 'partners_tenant_id_id_unique');
        });

        Schema::create('customer_identities', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('display_name');
            $table->string('email');
            $table->string('email_normalized');
            $table->string('phone')->nullable();
            $table->string('phone_e164')->nullable();
            $table->string('password');
            $table->timestamp('email_verified_at')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamp('last_login_at')->nullable();
            $table->rememberToken();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['tenant_id', 'email_normalized'], 'customer_identities_tenant_email_unique');
            $table->unique(['tenant_id', 'phone_e164'], 'customer_identities_tenant_phone_unique');
            $table->unique(['tenant_id', 'id'], 'customer_identities_tenant_id_id_unique');
            $table->index(['tenant_id', 'is_active'], 'customer_identities_tenant_active_index');
        });

        Schema::create('customer_partner_links', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('customer_identity_id');
            $table->uuid('partner_id');
            $table->enum('status', ['active', 'revoked'])->default('active');
            $table->enum('link_method', ['invitation', 'staff_verified_claim']);
            $table->uuid('linked_by_user_id')->nullable();
            $table->timestamp('linked_at');
            $table->uuid('revoked_by_user_id')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamps();

            $table->foreign(['tenant_id', 'customer_identity_id'], 'customer_partner_links_identity_fk')
                ->references(['tenant_id', 'id'])->on('customer_identities')->cascadeOnDelete();
            $table->foreign(['tenant_id', 'partner_id'], 'customer_partner_links_partner_fk')
                ->references(['tenant_id', 'id'])->on('partners')->restrictOnDelete();
            $table->foreign(['tenant_id', 'linked_by_user_id'], 'customer_partner_links_linked_by_fk')
                ->references(['tenant_id', 'id'])->on('users')->restrictOnDelete();
            $table->foreign(['tenant_id', 'revoked_by_user_id'], 'customer_partner_links_revoked_by_fk')
                ->references(['tenant_id', 'id'])->on('users')->restrictOnDelete();

            $table->index(
                ['tenant_id', 'customer_identity_id', 'partner_id'],
                'customer_partner_links_identity_partner_index'
            );
            $table->index(['tenant_id', 'partner_id', 'status'], 'customer_partner_links_partner_status_index');
        });

        // PostgreSQL and SQLite both enforce this partial unique index. It is the
        // concurrency-safe backstop for one current Partner link per identity.
        DB::statement(
            "CREATE UNIQUE INDEX customer_partner_links_one_active_per_identity "
            . "ON customer_partner_links (tenant_id, customer_identity_id) WHERE status = 'active'"
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_partner_links');
        Schema::dropIfExists('customer_identities');

        Schema::table('partners', function (Blueprint $table) {
            $table->dropUnique('partners_tenant_id_id_unique');
        });
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique('users_tenant_id_id_unique');
        });
    }
};
