<script setup>
import AuthenticatedLayout from "@/Layouts/AuthenticatedLayout.vue";
import { Head } from "@inertiajs/vue3";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import utc from "dayjs/plugin/utc";

dayjs.extend(relativeTime);
dayjs.extend(utc);

defineProps(["feed", "entry"]);
</script>

<template>
    <Head title="Entry" />

    <AuthenticatedLayout>
        <template #header>
            <div class="flex items-center justify-between">
                <div>
                    <div class="flex items-center space-x-3">
                        <img
                            class="h-10 w-10 rounded-full"
                            :src="feed.favicon_url"
                            alt="Favicon of {{ feed.name }}"
                        />
                        <h2
                            class="font-semibold text-xl text-gray-800 leading-tight"
                        >
                            {{ entry.title }} - {{ feed.name }}
                        </h2>
                    </div>
                    <div class="flex space-x-2">
                        <div class="text-sm text-gray-500">
                            URL: {{ entry.url }}
                        </div>
                        <div class="text-sm text-gray-500">
                            Published:
                            {{ dayjs.utc(entry.published_at).fromNow() }}
                        </div>
                    </div>
                </div>
            </div>
        </template>

        <div class="py-12">
            <div class="max-w-3xl mx-auto sm:px-6 lg:px-8">
                <div class="bg-white overflow-hidden shadow-sm sm:rounded-lg">
                    <div class="p-6 bg-white border-b border-gray-200">
                        <div
                            class="prose prose-base max-w-none"
                            v-html="entry.content"
                        />
                    </div>
                </div>
            </div>
        </div>
    </AuthenticatedLayout>
</template>
