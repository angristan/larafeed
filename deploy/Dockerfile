# Adapted from https://github.com/exaco/laravel-octane-dockerfile

ARG PHP_VERSION=8.5
ARG FRANKENPHP_VERSION=1.10
ARG COMPOSER_VERSION=2.9
ARG NODE_VERSION=24

FROM composer:${COMPOSER_VERSION} AS composer

FROM dunglas/frankenphp:${FRANKENPHP_VERSION}-php${PHP_VERSION} AS base

ARG WWWUSER=1000
ARG WWWGROUP=1000
ARG TZ=UTC
ARG APP_DIR=/var/www/html

ENV DEBIAN_FRONTEND=noninteractive \
    TERM=xterm-color \
    OCTANE_SERVER=frankenphp \
    APP_ENV=production \
    TZ=${TZ} \
    USER=octane \
    ROOT=${APP_DIR} \
    COMPOSER_FUND=0 \
    COMPOSER_MAX_PARALLEL_HTTP=24 \
    XDG_CONFIG_HOME=${APP_DIR}/.config \
    XDG_DATA_HOME=${APP_DIR}/.data

WORKDIR ${ROOT}

SHELL ["/bin/bash", "-eou", "pipefail", "-c"]

RUN ln -snf /usr/share/zoneinfo/${TZ} /etc/localtime \
    && echo ${TZ} > /etc/timezone

RUN apt-get update; \
    apt-get upgrade -yqq; \
    apt-get install -yqq --no-install-recommends --show-progress \
    apt-utils \
    curl \
    git \
    ca-certificates \
    # Install PHP extensions (included with dunglas/frankenphp)
    && install-php-extensions \
    pgsql \
    pdo_pgsql \
    opcache \
    redis \
    pcntl \
    zip \
    # for sentry profiles
    # excimer \
    # for datadog
    && curl -LO https://github.com/DataDog/dd-trace-php/releases/latest/download/datadog-setup.php \
    && php datadog-setup.php --php-bin=all \
    && apt-get -y autoremove \
    && apt-get clean \
    && docker-php-source delete \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* \
    && rm /var/log/lastlog

RUN userdel --remove --force www-data \
    && groupadd --force -g ${WWWGROUP} ${USER} \
    && useradd -ms /bin/bash --no-log-init --no-user-group -g ${WWWGROUP} -u ${WWWUSER} ${USER}

RUN chown -R ${USER}:${USER} ${ROOT} /var/{log,run} \
    && chmod -R a+rw ${ROOT} /var/{log,run}

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

FROM node:${NODE_VERSION}-slim AS npm_build

ENV ROOT=/var/www/html

WORKDIR ${ROOT}

COPY --link package.json ./

RUN npm install --frozen-lockfile

COPY --link . .

RUN npm run build

FROM base AS app

ARG DD_GIT_REPOSITORY_URL
ARG DD_GIT_COMMIT_SHA
ENV DD_GIT_REPOSITORY_URL=${DD_GIT_REPOSITORY_URL}
ENV DD_GIT_COMMIT_SHA=${DD_GIT_COMMIT_SHA}
ENV DD_VERSION=${DD_GIT_COMMIT_SHA}

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
