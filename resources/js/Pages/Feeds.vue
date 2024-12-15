<script setup lang="ts">
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout.vue';
import { Head, Link, router } from '@inertiajs/vue3';
import { watchDebounced } from '@vueuse/core';
import dayjs from 'dayjs';
import { ref } from 'vue';
import { FileRssIcon } from 'vue-tabler-icons';

interface Feed {
    id: number;
    name: string;
    favicon_url: string;
    site_url: string;
    entries_count: number;
    last_crawled_at: string;
    sparkline: string;
}

const props = defineProps<{
    feeds: Feed[];
    filters: {
        search: string;
    };
}>();

const term = ref(props.filters.search);

watchDebounced(
    term,
    (value) => {
        router.get(route('feeds.index'), value ? { search: value } : {}, {
            preserveState: true,
        });
    },
    { debounce: 200, maxWait: 500 },
);
</script>

<template>
    <Head title="Feeds" />

    <AuthenticatedLayout>
        <template #header>
            <div class="flex items-center justify-between">
                <h2 class="text-xl font-semibold leading-tight text-gray-800">
                    Feeds
                </h2>
                <form>
                    <label
                        for="default-search"
                        class="sr-only mb-2 text-sm font-medium text-gray-900 dark:text-white"
                        >Search</label
                    >
                    <div class="relative w-96">
                        <div
                            class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3"
                        >
                            <svg
                                aria-hidden="true"
                                class="h-5 w-5 text-gray-500 dark:text-gray-400"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                                xmlns="http://www.w3.org/2000/svg"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                                ></path>
                            </svg>
                        </div>
                        <input
                            type="search"
                            id="default-search"
                            class="block w-full rounded-lg border border-gray-300 bg-gray-50 p-4 pl-10 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500"
                            placeholder="Search feeds by title"
                            v-model="term"
                            required
                        />
                        <button
                            type="submit"
                            class="absolute bottom-2.5 right-2.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
                        >
                            Search
                        </button>
                    </div>
                </form>
                <div class="flex flex-col text-right">
                    <Link prefetch :href="route('feed.create')">
                        <button class="btn" type="submit">
                            <FileRssIcon class="mr-2" />
                            New feed
                        </button>
                    </Link>
                </div>
            </div>
        </template>

        <div class="py-12">
            <div class="mx-auto max-w-7xl sm:px-6 lg:px-8">
                <div class="overflow-hidden bg-white shadow-sm sm:rounded-lg">
                    <div
                        v-if="feeds.length === 0"
                        class="border-b border-gray-200 bg-white p-6"
                    >
                        <p class="text-gray-500">No feeds found.</p>
                    </div>
                    <div v-else class="border-b border-gray-200 bg-white p-6">
                        <ul class="divide-y divide-gray-200">
                            <li
                                v-for="feed in feeds"
                                :key="feed.id"
                                class="py-4"
                            >
                                <div class="items center flex justify-between">
                                    <div class="items center flex">
                                        <Link
                                            prefetch
                                            :href="
                                                route('feed.entries', feed.id)
                                            "
                                            class="group block flex-shrink-0"
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
                                                            '(' +
                                                            feed.entries_count +
                                                            ')'
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
                                                                feed.last_crawled_at,
                                                            ).format(
                                                                'MMMM D, YYYY',
                                                            )
                                                        }}
                                                    </div>
                                                </div>
                                            </div>
                                        </Link>
                                    </div>
                                    <div v-html="feed.sparkline"></div>
                                </div>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    </AuthenticatedLayout>
</template>
