# ════════════════════════════════════════════════════════════════
#  نبراس ERP — صورة الإنتاج (Backend Laravel 11 + PostgreSQL)
#  تُجمّع التطبيق الكامل من النواة وقت البناء، ثم تُقلع خادماً جاهزاً.
#  (للتشغيل/الاختبار المحلي بـ SQLite استخدم setup.sh — انظر HOW_TO_RUN.md)
# ════════════════════════════════════════════════════════════════
FROM php:8.3-cli

# اعتماديات النظام (libonig-dev لـ mbstring، libpq-dev لـ pgsql، libzip-dev لـ zip)
RUN apt-get update && apt-get install -y --no-install-recommends \
        git unzip zip libpq-dev libzip-dev libonig-dev \
    && rm -rf /var/lib/apt/lists/*

# إضافات PHP — pdo مضمّن أصلاً. mbstring إلزامي لـ Laravel وغير مضمّن.
# pdo_sqlite لأوامر الترحيل وقت البناء (Laravel skeleton يفترض sqlite افتراضياً).
RUN docker-php-ext-install pdo_pgsql pdo_sqlite mbstring bcmath zip opcache

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# COMPOSER_MEMORY_LIMIT=-1 يمنع نفاد ذاكرة composer أثناء البناء (أشيع فشل)
ENV COMPOSER_ALLOW_SUPERUSER=1 \
    COMPOSER_NO_INTERACTION=1 \
    COMPOSER_MEMORY_LIMIT=-1

# النواة إلى /core، ثم تجميع تطبيق Laravel كامل في /app
COPY . /core
RUN bash /core/deploy/assemble.sh /core /app \
    && chmod -R 775 /app/storage /app/bootstrap/cache

# نقطة التشغيل (تُنسخ قبل حذف النواة)
RUN cp /core/deploy/entrypoint.sh /usr/local/bin/entrypoint.sh \
    && chmod +x /usr/local/bin/entrypoint.sh \
    && rm -rf /core

WORKDIR /app

# قيم بيئة إنتاجية افتراضية (تُتجاوَز بمتغيّرات المنصة)
ENV APP_ENV=production \
    APP_DEBUG=false \
    DB_CONNECTION=pgsql \
    LOG_CHANNEL=stderr \
    CACHE_STORE=file \
    SESSION_DRIVER=file \
    QUEUE_CONNECTION=sync

EXPOSE 8000
CMD ["/usr/local/bin/entrypoint.sh"]
