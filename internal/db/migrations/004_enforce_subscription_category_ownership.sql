-- +goose Up
-- Ensure a subscription can only reference a category owned by the same user.

ALTER TABLE subscription_categories
    ADD CONSTRAINT subscription_categories_user_id_id_unique UNIQUE (user_id, id);

ALTER TABLE feed_subscriptions
    ADD CONSTRAINT feed_subscriptions_user_category_fk
    FOREIGN KEY (user_id, category_id)
    REFERENCES subscription_categories(user_id, id);

-- +goose Down
ALTER TABLE feed_subscriptions
    DROP CONSTRAINT feed_subscriptions_user_category_fk;

ALTER TABLE subscription_categories
    DROP CONSTRAINT subscription_categories_user_id_id_unique;
