FROM php:8.3-cli

# إضافات PHP المطلوبة
RUN apt-get update && apt-get install -y \
    libzip-dev zip unzip libsqlite3-dev \
    && docker-php-ext-install pdo pdo_sqlite bcmath zip \
    && rm -rf /var/lib/apt/lists/*

# Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /app
COPY . /app

CMD ["bash", "setup.sh"]
