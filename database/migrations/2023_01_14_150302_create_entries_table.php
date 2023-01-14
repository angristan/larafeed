<?php

use App\Enums\EntryStatus;
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
            $table->id();
            $table->timestamps();

            $table->string('title');
            $table->string('url');
            $table->string('author')->nullable();
            $table->text('content')->nullable();
            $table->timestamp('published_at');
            $table->enum('status', EntryStatus::getValues())->default(EntryStatus::Unread);
            $table->boolean('starred')->default(false);

            $table->foreignId('feed_id')
                ->constrained('feeds')
                ->cascadeOnDelete();
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
