<script setup>
import InputError from "@/Components/InputError.vue";
import AuthenticatedLayout from "@/Layouts/AuthenticatedLayout.vue";
import { Head, Link, useForm } from "@inertiajs/vue3";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import utc from "dayjs/plugin/utc";
import { ElNotification } from "element-plus";
import { RefreshIcon } from "vue-tabler-icons";

dayjs.extend(relativeTime);
dayjs.extend(utc);

const refreshEntriesForm = useForm({});

defineProps({
    feed: {
        type: Object,
        required: true,
    },
    entries: {
        type: Array,
        required: true,
    },
});

const showRefreshSuccessNotification = () => {
    ElNotification({
        title: "Feed refreshed",
        message: "The feed entries have been fetched successfully.",
        type: "success",
        position: "bottom-right",
    });
};

const showRefreshFailureNotification = () => {
    ElNotification({
        title: "Error",
        message: "There was an error refreshing the feed.",
        type: "error",
        position: "bottom-right",
    });
};
</script>

<template>
    <Head title="Entries" />

    <AuthenticatedLayout>
        <template #header>
            <div class="flex items-center justify-between">
                <div>
                    <div class="flex items-center space-x-3">
                        <img
                            class="h-8 w-8 mb-1"
                            :src="feed.favicon_url"
                            alt="Favicon of {{ feed.name }}"
                        />
                        <h2
                            class="font-semibold text-xl text-gray-800 leading-tight"
                        >
                            {{ feed.name }} ({{ feed.entries_count }})
                        </h2>
                    </div>
                    <div class="flex space-x-2">
                        <div class="text-sm text-gray-500">
                            URL: {{ feed.site_url }}
                        </div>
                        <div class="text-sm text-gray-500">
                            Last refreshed:
                            {{ dayjs.utc(feed.last_crawled_at).fromNow() }}
                        </div>
                    </div>
                </div>
                <div class="flex flex-col text-right">
                    <form
                        @submit.prevent="
                            refreshEntriesForm.post(
                                route('feed.refresh', feed.id),
                                {
                                    onSuccess: () => {
                                        showRefreshSuccessNotification();
                                    },
                                    onError: () => {
                                        showRefreshFailureNotification();
                                    },
                                }
                            )
                        "
                    >
                        <button class="btn" type="submit">
                            <RefreshIcon class="mr-2" />
                            Refresh entries
                        </button>
                        <InputError
                            class="mt-2"
                            :message="refreshEntriesForm.errors.refresh"
                        />
                    </form>
                </div>
            </div>
        </template>

        <div class="py-12">
            <div class="max-w-7xl mx-auto sm:px-6 lg:px-8">
                <div class="bg-white overflow-hidden shadow-sm sm:rounded-lg">
                    <div
                        v-if="entries.length === 0"
                        class="p-6 bg-white border-b border-gray-200"
                    >
                        <p class="text-gray-500">No entries found.</p>
                    </div>
                    <div v-else class="p-6 bg-white border-b border-gray-200">
                        <ol
                            class="relative border-l border-gray-200 dark:border-gray-700"
                        >
                            <li
                                v-for="entry in entries"
                                :key="entry.id"
                                class="mb-10 ml-4"
                            >
                                <Link
                                    :href="
                                        route('feed.entry', {
                                            feed: feed.id,
                                            entry: entry.id,
                                        })
                                    "
                                    class="flex-shrink-0 group block"
                                >
                                    <div
                                        class="absolute w-3 h-3 bg-gray-200 rounded-full mt-1.5 -left-1.5 border border-white dark:border-gray-900 dark:bg-gray-700"
                                    ></div>
                                    <time
                                        class="mb-1 text-sm font-normal leading-none text-gray-400 dark:text-gray-500"
                                        >{{
                                            dayjs
                                                .utc(entry.published_at)
                                                .fromNow()
                                        }}</time
                                    >
                                    <h3
                                        class="text-lg font-semibold text-gray-900 dark:text-white"
                                    >
                                        {{ entry.title }}
                                    </h3>
                                    <p
                                        class="mb-4 text-base font-normal text-gray-500 dark:text-gray-400"
                                    >
                                        {{ entry.url }}
                                    </p>
                                </Link>
                            </li>
                        </ol>
                    </div>
                </div>
            </div>
        </div>
    </AuthenticatedLayout>
</template>
