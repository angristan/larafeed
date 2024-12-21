<?php

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
        Schema::table('feeds', function (Blueprint $table) {
            $table->index('id');
        });

        Schema::table('entries', function (Blueprint $table) {
            $table->index('id');
            $table->index('feed_id');
            $table->index('url');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('feeds', function (Blueprint $table) {
            $table->dropIndex(['id']);
        });

        Schema::table('entries', function (Blueprint $table) {
            $table->dropIndex(['id']);
            $table->dropIndex(['feed_id']);
            $table->dropIndex(['url']);
        });
    }
};
