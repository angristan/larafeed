<script setup>
import AuthenticatedLayout from "@/Layouts/AuthenticatedLayout.vue";
import { Head, Link } from '@inertiajs/vue3';

defineProps(["feed", "entries"]);
</script>

<template>
    <Head title="Entries" />

    <AuthenticatedLayout>
        <template #header>
            <div class="flex items-center justify-between">
                <h2 class="font-semibold text-xl text-gray-800 leading-tight">
                    Entries for "{{ feed.name }}"
                </h2>
                <Link
                    method="post"
                    :href="route('feed.refresh', feed.id)"
                    preserveScroll
                    as="button"
                    class="btn"
                >
                    Refresh entries
                </Link>
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
                        <ul class="divide-y divide-gray-200">
                            <li
                                v-for="entry in entries"
                                :key="entry.id"
                                class="py-4"
                            >
                                <div class="flex items center justify-between">
                                    <div class="flex items center">
                                        <div class="ml-4">
                                            <div
                                                class="text-sm font-medium text-gray-900"
                                            >
                                                {{ entry.title }}
                                            </div>
                                            <div class="text-sm text-gray-500">
                                                {{ entry.url }}
                                            </div>
                                        </div>
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
