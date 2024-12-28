FROM dunglas/frankenphp:latest-php8.3

# Install dependencies untuk Composer dan ekstensi PHP
RUN apt-get update && apt-get install -y \
    curl \
    unzip \
    libpq-dev \
    libexif-dev \
    libsodium-dev

# Install Composer
RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer

RUN install-php-extensions \
    pgsql \
    pdo_pgsql \
    gd \
    intl \
    zip \
    exif \
    sodium \
    pcntl \
    redis

WORKDIR /app

COPY . ./

# Install dependencies using Composer
RUN composer install --no-dev --optimize-autoloader
# Build assets using NPM
RUN npm run build

RUN rm -rf ./git

# Run FrankenPHP
CMD ["php", "artisan", "octane:frankenphp", "--host=0.0.0.0", "--port=80", "--admin-port=2019"]
