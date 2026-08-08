import { Effect, Schema } from 'effect';

import type { D1, D1OperationError } from '../infrastructure/d1';

const FeedImageSourceRow = Schema.Struct({
    favicon_url: Schema.NullOr(Schema.String),
});
const ArticleImageSourceRow = Schema.Struct({
    content_html: Schema.String,
    entry_url: Schema.NullOr(Schema.String),
});

export interface FeedImageSource {
    readonly faviconUrl: string | null;
}

export interface ArticleImageSource {
    readonly contentHtml: string;
    readonly entryUrl: string | null;
}

export interface ImageRepository {
    /** Returns null unless the user has an active subscription to the feed. */
    readonly findOwnedFeedSource: (
        userId: number,
        feedId: number,
    ) => Effect.Effect<FeedImageSource | null, ImageStorageError>;
    /** Returns null unless the user owns the visible entry. */
    readonly findOwnedArticleSource: (
        userId: number,
        entryId: number,
    ) => Effect.Effect<ArticleImageSource | null, ImageStorageError>;
}

export class ImageStorageError extends Schema.TaggedError<ImageStorageError>()(
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
    findOwnedArticleSource: (userId, entryId) =>
        d1
            .first({
                sql: `SELECT ec.content_html, e.url AS entry_url
                    FROM entries e
                    JOIN feed_subscriptions fs
                      ON fs.feed_id = e.feed_id AND fs.user_id = ?
                    JOIN entry_contents ec ON ec.entry_id = e.id
                    LEFT JOIN entry_interactions ei
                      ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                    WHERE e.id = ? AND ei.filtered_at IS NULL
                    LIMIT 1`,
                bindings: [userId, entryId],
            })
            .pipe(
                Effect.mapError((cause) =>
                    storageError('findOwnedArticleSource', cause),
                ),
                Effect.flatMap((row) =>
                    row === null
                        ? Effect.succeed(null)
                        : Schema.decodeUnknownEffect(ArticleImageSourceRow)(
                              row,
                          ).pipe(
                              Effect.map(
                                  (decoded): ArticleImageSource => ({
                                      contentHtml: decoded.content_html,
                                      entryUrl: decoded.entry_url,
                                  }),
                              ),
                              Effect.mapError((cause) =>
                                  storageError(
                                      'decodeOwnedArticleSource',
                                      cause,
                                  ),
                              ),
                          ),
                ),
            ),
});
