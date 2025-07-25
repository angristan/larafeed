<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('entries', function (Blueprint $table) {
            // Drop the existing unique constraint
            $table->dropUnique(['feed_id', 'url']);

            // Add new unique constraint with published_at
            $table->unique(['feed_id', 'url', 'published_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('entries', function (Blueprint $table) {
            // Drop the new unique constraint
            $table->dropUnique(['feed_id', 'url', 'published_at']);

            // Restore the original unique constraint
            $table->unique(['feed_id', 'url']);
        });
    }
};
