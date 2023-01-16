<script setup>
import AuthenticatedLayout from "@/Layouts/AuthenticatedLayout.vue";
import { Head, Link } from "@inertiajs/vue3";
import dayjs from "dayjs";
import { FileRssIcon } from "vue-tabler-icons";

defineProps(["feeds"]);

// TODO: https://inertiajs.com/pages#persistent-layouts
</script>

<template>
    <Head title="Feeds" />

    <AuthenticatedLayout>
        <template #header>
            <div class="flex items-center justify-between">
                <h2 class="font-semibold text-xl text-gray-800 leading-tight">
                    Feeds
                </h2>
                <div class="flex flex-col text-right">
                    <Link :href="route('feed.create')">
                        <button class="btn" type="submit">
                            <FileRssIcon class="mr-2" />
                            New feed
                        </button>
                    </Link>
                </div>
            </div>
        </template>

        <div class="py-12">
            <div class="max-w-7xl mx-auto sm:px-6 lg:px-8">
                <div class="bg-white overflow-hidden shadow-sm sm:rounded-lg">
                    <div
                        v-if="feeds.length === 0"
                        class="p-6 bg-white border-b border-gray-200"
                    >
                        <p class="text-gray-500">No feeds found.</p>
                    </div>
                    <div v-else class="p-6 bg-white border-b border-gray-200">
                        <ul class="divide-y divide-gray-200">
                            <li
                                v-for="feed in feeds"
                                :key="feed.id"
                                class="py-4"
                            >
                                <div class="flex items center justify-between">
                                    <div class="flex items center">
                                        <Link
                                            :href="
                                                route('feed.entries', feed.id)
                                            "
                                            class="flex-shrink-0 group block"
                                        >
                                            <div class="flex">
                                                <img
                                                    class="h-10 w-10 rounded-full"
                                                    :src="feed.favicon_url"
                                                    alt="Favicon of {{ feed.name }}"
                                                />
                                                <div class="ml-4">
                                                    <div
                                                        class="text-sm font-medium text-gray-900"
                                                    >
                                                        {{ feed.name }}
                                                        {{
                                                            "(" +
                                                            feed.entries_count +
                                                            ")"
                                                        }}
                                                    </div>
                                                    <div
                                                        class="text-sm text-gray-500"
                                                    >
                                                        {{ feed.site_url }}
                                                    </div>
                                                    <div
                                                        class="text-sm text-gray-500"
                                                    >
                                                        {{
                                                            dayjs(
                                                                feed.last_crawled_at
                                                            ).format(
                                                                "MMMM D, YYYY"
                                                            )
                                                        }}
                                                    </div>
                                                </div>
                                            </div>
                                        </Link>
                                    </div>
                                </div>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    </AuthenticatedLayout>
</template>
