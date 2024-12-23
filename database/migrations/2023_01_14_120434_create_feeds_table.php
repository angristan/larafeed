<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::create('feeds', function (Blueprint $table) {
            $table->id()->primary();

            $table->timestamps();

            $table->string('name');
            $table->string('feed_url')->unique();
            $table->string('site_url');
            $table->string('favicon_url')->nullable();
            $table->timestamp('last_successful_refresh_at')->nullable();
            $table->timestamp('last_failed_refresh_at')->nullable();
            $table->string('last_error_message')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::dropIfExists('feeds');
    }
};
