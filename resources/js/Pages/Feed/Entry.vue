<script setup>
import TextParagraphSkeleton from "@/Components/Skeleton/TextParagraphSkeleton.vue";
import AuthenticatedLayout from "@/Layouts/AuthenticatedLayout.vue";
import { Head } from "@inertiajs/vue3";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import utc from "dayjs/plugin/utc";
import { ref } from "vue";
import { BrainIcon } from "vue-tabler-icons";

dayjs.extend(relativeTime);
dayjs.extend(utc);

defineProps(["feed", "entry"]);

const summary = ref("");
const loading = ref(false);

async function getSummary(entryId) {
    loading.value = true;
    const res = await fetch(
        `http://localhost/api/entry/${entryId}/gpt-summary`
    );
    const data = await res.json();
    console.log(data.summary);
    summary.value = data.summary;
    loading.value = false;
}
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
            <div class="max-w-3xl mx-auto sm:px-6 lg:px-8">
                <div
                    class="bg-white overflow-hidden shadow-sm sm:rounded-lg mb-3"
                    v-if="summary || loading"
                >
                    <div class="p-6 bg-white border-b border-gray-200">
                        <div class="flex items-center justify-between">
                            <h3
                                class="font-semibold text-xl text-gray-800 leading-tight mb-2"
                            >
                                Summary
                            </h3>
                            <button
                                className="btn btn-square btn-outline"
                                @click="summary = ''"
                                v-if="summary"
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-2 w-2"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth="2"
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
