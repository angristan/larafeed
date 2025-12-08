<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('feed_subscriptions', function (Blueprint $table) {
            $table->json('filter_rules')->nullable()->after('category_id');
        });

        Schema::table('entry_interactions', function (Blueprint $table) {
            $table->timestamp('filtered_at')->nullable()->after('archived_at');
            $table->index(['user_id', 'filtered_at']);
        });
    }

    public function down(): void
    {
        Schema::table('feed_subscriptions', function (Blueprint $table) {
            $table->dropColumn('filter_rules');
        });

        Schema::table('entry_interactions', function (Blueprint $table) {
            $table->dropIndex(['user_id', 'filtered_at']);
            $table->dropColumn('filtered_at');
        });
    }
};
