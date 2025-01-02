# Adapted from https://github.com/exaco/laravel-octane-dockerfile

ARG PHP_VERSION=8.4
ARG FRANKENPHP_VERSION=1.3
ARG COMPOSER_VERSION=2.8
ARG NODE_VERSION=22

FROM composer:${COMPOSER_VERSION} AS composer

FROM dunglas/frankenphp:${FRANKENPHP_VERSION}-php${PHP_VERSION}-alpine AS base

ARG WWWUSER=1000
ARG WWWGROUP=1000
ARG TZ=UTC
ARG APP_DIR=/var/www/html

ENV OCTANE_SERVER=frankenphp \
    TZ=${TZ} \
    USER=octane \
    ROOT=${APP_DIR} \
    COMPOSER_FUND=0 \
    COMPOSER_MAX_PARALLEL_HTTP=24 \
    XDG_CONFIG_HOME=${APP_DIR}/.config \
    XDG_DATA_HOME=${APP_DIR}/.data

WORKDIR ${ROOT}

RUN ln -snf /usr/share/zoneinfo/${TZ} /etc/localtime \
    && echo ${TZ} > /etc/timezone

RUN apk update \
    && apk add --no-cache \
    curl \
    git \
    bash \
    ca-certificates \
    # Install PHP extensions
    && install-php-extensions \
    pgsql \
    pdo_pgsql \
    opcache \
    redis \
    pcntl \
    zip \
    excimer \
    && docker-php-source delete \
    && rm -rf /var/cache/apk/* /tmp/* /var/tmp/*

RUN deluser --remove-home www-data 2>/dev/null || true \
    && addgroup -g ${WWWGROUP} ${USER} \
    && adduser -D -s /bin/sh -u ${WWWUSER} -G ${USER} ${USER}

RUN cp ${PHP_INI_DIR}/php.ini-production ${PHP_INI_DIR}/php.ini

USER ${USER}

COPY --link --chown=${WWWUSER}:${WWWUSER} --from=composer /usr/bin/composer /usr/bin/composer

COPY --link --chown=${WWWUSER}:${WWWUSER} deploy/php.ini ${PHP_INI_DIR}/conf.d/99-octane.ini

COPY --link --chown=${WWWUSER}:${WWWUSER} composer.json composer.lock ./

RUN composer install \
    --no-dev \
    --no-interaction \
    --no-autoloader \
    --no-ansi \
    --no-scripts \
    --audit

FROM node:${NODE_VERSION}-alpine AS npm_build

ENV ROOT=/var/www/html

WORKDIR ${ROOT}

COPY --link package.json ./

RUN npm install --frozen-lockfile

COPY --link . .

RUN npm run build

FROM base AS app

USER ${USER}

COPY --link --chown=${WWWUSER}:${WWWUSER} . .
COPY --link --chown=${WWWUSER}:${WWWUSER} --from=npm_build ${ROOT}/public public

RUN mkdir -p \
    storage/framework/{sessions,views,cache,testing} \
    storage/logs \
    bootstrap/cache && chmod -R a+rw storage

RUN composer install \
    --classmap-authoritative \
    --no-interaction \
    --no-ansi \
    --no-dev \
    && composer clear-cache
