import InputError from "@/Components/InputError";
import AuthenticatedLayout from "@/Layouts/AuthenticatedLayout";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
dayjs.extend(relativeTime);

export default function Entries({ auth, feed }) {
    return (
        <AuthenticatedLayout
            auth={auth}
            header={
                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center space-x-3">
                            <img
                                className="h-10 w-10 rounded-full"
                                src={feed.favicon_url}
                                alt="Favicon of {{ feed.name }}"
                            />
                            <h2 className="font-semibold text-xl text-gray-800 leading-tight">
                                Entries for "{feed.name}"
                            </h2>
                        </div>
                        <div className="flex space-x-2">
                            <div className="text-sm text-gray-500">
                                URL: {feed.site_url}
                            </div>
                            <div className="text-sm text-gray-500">
                                {"Last refreshed: " +
                                    dayjs(feed.last_crawled_at).fromNow()}
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col text-right">
                        <form>
                            <button className="btn" type="submit">
                                Refresh entries
                            </button>
                            <InputError className="mt-2" message={undefined} />
                        </form>
                    </div>
                </div>
            }
        >
            <div></div>
        </AuthenticatedLayout>
    );
}
