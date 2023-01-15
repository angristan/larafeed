import AuthenticatedLayout from "@/Layouts/AuthenticatedLayout";
import { Link } from "@inertiajs/react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
dayjs.extend(relativeTime);

export default function Feeds({ auth, feeds }) {
    return (
        <AuthenticatedLayout
            auth={auth}
            header={
                <h2 className="font-semibold text-xl text-gray-800 leading-tight">
                    Feeds
                </h2>
            }
        >
            <div className="py-12">
                <div className="max-w-7xl mx-auto sm:px-6 lg:px-8">
                    <div className="bg-white overflow-hidden shadow-sm sm:rounded-lg">
                        {feeds.length === 0 ? (
                            <div className="p-6 bg-white border-b border-gray-200">
                                <p className="text-gray-500">No feeds found.</p>
                            </div>
                        ) : (
                            <div className="p-6 bg-white border-b border-gray-200">
                                <ul className="divide-y divide-gray-200">
                                    {feeds.map((feed) => (
                                        <li key={feed.id} className="py-4">
                                            <div className="flex items center justify-between">
                                                <div className="flex items center">
                                                    <Link
                                                        href={route(
                                                            "feed.entries",
                                                            feed.id
                                                        )}
                                                        className="flex-shrink-0 group block"
                                                    >
                                                        <div className="flex">
                                                            <img
                                                                className="h-10 w-10 rounded-full"
                                                                src={
                                                                    feed.favicon_url
                                                                }
                                                                alt="Favicon of {{ feed.name }}"
                                                            />
                                                            <div className="ml-4">
                                                                <div className="text-sm font-medium text-gray-900">
                                                                    {feed.name}
                                                                </div>
                                                                <div className="text-sm text-gray-500">
                                                                    {
                                                                        feed.site_url
                                                                    }
                                                                </div>
                                                                <div className="text-sm text-gray-500">
                                                                    {dayjs(
                                                                        feed.last_crawled_at
                                                                    ).format(
                                                                        "MMMM D, YYYY"
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </Link>
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </AuthenticatedLayout>
    );
}
