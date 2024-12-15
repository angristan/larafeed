<script setup>
import TextParagraphSkeleton from '@/Components/Skeleton/TextParagraphSkeleton.vue';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout.vue';
import { Head, router } from '@inertiajs/vue3';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import { ref } from 'vue';
import { BrainIcon } from 'vue-tabler-icons';

dayjs.extend(relativeTime);
dayjs.extend(utc);

defineProps({
    feed: {
        type: Object,
        required: true,
    },
    entry: {
        type: Object,
        required: true,
    },
    summary: {
        type: String,
        required: false,
    },
});

const loading = ref(false);
const showSummary = ref(false);

function getSummary() {
    // Intertial partial reload with lazy data evaluation
    // https://inertiajs.com/partial-reloads
    router.reload({ only: ['summary'] });
}

// https://inertiajs.com/events
router.on('start', (event) => {
    // Summary: show loader
    if (event.detail.visit.only.includes('summary')) {
        loading.value = true;
    }
});

router.on('finish', (event) => {
    // Summary: hide loader and show summary
    if (event.detail.visit.only.includes('summary')) {
        loading.value = false;
        showSummary.value = true;
    }
});

function hideSummary() {
    showSummary.value = false;
}

/**
 * Alternative: fetch summary from API call and use a ref to hold the data
 */

// const summary = ref("");

// async function getSummary(entryId) {
//     loading.value = true;
//     const res = await fetch(
//         `http://localhost/api/entry/${entryId}/gpt-summary`
//     );
//     const data = await res.json();
//     console.log(data.summary);
//     summary.value = data.summary;
//     loading.value = false;
// }
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
                            class="text-xl font-semibold leading-tight text-gray-800"
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
                <div class="flex flex-col text-right">
                    <div class="tooltip" data-tip="Ask ChatGPT for a summary">
                        <button
                            class="btn"
                            :class="{ loading: loading }"
                            @click="getSummary(entry.id)"
                        >
                            <BrainIcon class="mr-2" v-if="!loading" />
                            Summarize entry
                        </button>
                    </div>
                </div>
            </div>
        </template>

        <div class="py-12">
            <div class="mx-auto max-w-3xl sm:px-6 lg:px-8">
                <div
                    class="mb-3 overflow-hidden bg-white shadow-sm sm:rounded-lg"
                    v-if="showSummary || loading"
                >
                    <div class="border-b border-gray-200 bg-white p-6">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center">
                                <h3
                                    class="mb-2 text-xl font-semibold leading-tight text-gray-800"
                                >
                                    Summary
                                </h3>
                                <figcaption class="ml-2 text-xs text-gray-500">
                                    Powered by ChatGPT
                                </figcaption>
                            </div>
                            <button
                                type="button"
                                @click="hideSummary"
                                v-if="summary"
                                class="inline-flex items-center justify-center rounded-md bg-white p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                            >
                                <span class="sr-only">Close menu</span>
                                <svg
                                    class="h-6 w-6"
                                    xmlns="http://www.w3.org/2000/svg"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    aria-hidden="true"
                                >
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M6 18L18 6M6 6l12 12"
                                    />
                                </svg>
                            </button>
                        </div>
                        <div v-if="summary && !loading" v-html="summary" />
                        <div v-else>
                            <TextParagraphSkeleton />
                        </div>
                    </div>
                </div>
                <div class="overflow-hidden bg-white shadow-sm sm:rounded-lg">
                    <div class="border-b border-gray-200 bg-white p-6">
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
