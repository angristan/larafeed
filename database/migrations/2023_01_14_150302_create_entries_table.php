<?php

declare(strict_types=1);

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
        Schema::create('entries', function (Blueprint $table) {
            $table->id()->primary();

            $table->timestamps();

            $table->string('title');
            $table->string('url');
            $table->string('author')->nullable();
            // TODO: use fullText?
            $table->text('content');
            $table->timestamp('published_at');

            $table->foreignId('feed_id')
                ->constrained('feeds')
                ->cascadeOnDelete();

            $table->unique(['feed_id', 'url']);
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::dropIfExists('entries');
    }
};
