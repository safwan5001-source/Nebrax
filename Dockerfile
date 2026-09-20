# ════════════════════════════════════════════════════════════════
#  أَوْج AWJ — صورة الإنتاج (Backend Laravel 11 + PostgreSQL)
#  Apache + mod_php provides a production-capable concurrent HTTP runtime.
# ════════════════════════════════════════════════════════════════
FROM php:8.3-apache

RUN apt-get update && apt-get install -y --no-install-recommends \
        git unzip zip poppler-utils libpq-dev libzip-dev libonig-dev libsqlite3-dev libxml2-dev libxml2-utils \
    && rm -rf /var/lib/apt/lists/*

RUN docker-php-ext-install pdo_pgsql pdo_sqlite mbstring bcmath zip opcache dom \
    && a2enmod rewrite

COPY --from=composer:2.7 /usr/bin/composer /usr/bin/composer

ENV COMPOSER_ALLOW_SUPERUSER=1 \
    COMPOSER_NO_INTERACTION=1 \
    COMPOSER_MEMORY_LIMIT=-1

COPY . /core
RUN bash /core/deploy/assemble.sh /core /app \
    && chmod -R 775 /app/storage /app/bootstrap/cache

RUN cp /core/deploy/entrypoint.sh /usr/local/bin/entrypoint.sh \
    && chmod +x /usr/local/bin/entrypoint.sh \
    && rm -rf /core \
    && sed -ri 's!DocumentRoot /var/www/html!DocumentRoot /app/public!g' /etc/apache2/sites-available/000-default.conf \
    && printf '<Directory /app/public>\n    AllowOverride All\n    Require all granted\n</Directory>\n' > /etc/apache2/conf-available/awj-laravel.conf \
    && a2enconf awj-laravel

WORKDIR /app

ENV APP_ENV=production \
    APP_DEBUG=false \
    DB_CONNECTION=pgsql \
    LOG_CHANNEL=stderr \
    CACHE_STORE=file \
    SESSION_DRIVER=file \
    QUEUE_CONNECTION=sync

EXPOSE 8000
CMD ["/usr/local/bin/entrypoint.sh"]
