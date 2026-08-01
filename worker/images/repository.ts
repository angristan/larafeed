import { Effect, Schema } from 'effect';

import type { D1, D1OperationError } from '../infrastructure/d1';

const FeedImageSourceRow = Schema.Struct({
    favicon_url: Schema.NullOr(Schema.String),
});

export interface FeedImageSource {
    readonly faviconUrl: string | null;
}

export interface ImageRepository {
    /** Returns null unless the user has an active subscription to the feed. */
    readonly findOwnedFeedSource: (
        userId: number,
        feedId: number,
    ) => Effect.Effect<FeedImageSource | null, ImageStorageError>;
}

export class ImageStorageError extends Schema.TaggedErrorClass<ImageStorageError>()(
    'ImageStorageError',
    {
        operation: Schema.String,
        cause: Schema.Defect(),
    },
) {}

const storageError = (operation: string, cause: D1OperationError | unknown) =>
    new ImageStorageError({ operation, cause });

export const makeImageRepository = (d1: D1): ImageRepository => ({
    findOwnedFeedSource: (userId, feedId) =>
        d1
            .first({
                sql: `SELECT f.favicon_url
                    FROM feed_subscriptions fs
                    JOIN feeds f ON f.id = fs.feed_id
                    WHERE fs.user_id = ? AND fs.feed_id = ?
                    LIMIT 1`,
                bindings: [userId, feedId],
            })
            .pipe(
                Effect.mapError((cause) =>
                    storageError('findOwnedFeedSource', cause),
                ),
                Effect.flatMap((row) =>
                    row === null
                        ? Effect.succeed(null)
                        : Schema.decodeUnknownEffect(FeedImageSourceRow)(
                              row,
                          ).pipe(
                              Effect.map(
                                  (decoded): FeedImageSource => ({
                                      faviconUrl: decoded.favicon_url,
                                  }),
                              ),
                              Effect.mapError((cause) =>
                                  storageError('decodeOwnedFeedSource', cause),
                              ),
                          ),
                ),
            ),
});
