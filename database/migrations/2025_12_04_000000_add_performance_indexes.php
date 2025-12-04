<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('entries', function (Blueprint $table) {
            $table->index('published_at');
        });

        Schema::table('entry_interactions', function (Blueprint $table) {
            $table->index('read_at');
            $table->index('starred_at');
            $table->index('archived_at');
        });
    }

    public function down(): void
    {
        Schema::table('entries', function (Blueprint $table) {
            $table->dropIndex(['published_at']);
        });

        Schema::table('entry_interactions', function (Blueprint $table) {
            $table->dropIndex(['read_at']);
            $table->dropIndex(['starred_at']);
            $table->dropIndex(['archived_at']);
        });
    }
};
