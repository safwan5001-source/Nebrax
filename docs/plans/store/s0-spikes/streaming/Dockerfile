# S0-E SPIKE image: the production base (php:8.3-apache, prefork) + the same php.ini overrides as /Dockerfile (deploy/php/awj-uploads.ini).
# Apache MPM settings are deliberately LEFT AT THE IMAGE DEFAULTS, exactly as production leaves them (the Dockerfile only switches event->prefork).
FROM php:8.3-apache
RUN a2dismod mpm_event mpm_worker || true && a2enmod mpm_prefork status rewrite \
 && printf '<IfModule mod_status.c>\nExtendedStatus On\n<Location /server-status>\n SetHandler server-status\n Require all granted\n</Location>\n</IfModule>\n' > /etc/apache2/conf-available/s0-status.conf && a2enconf s0-status
COPY awj-uploads.ini /usr/local/etc/php/conf.d/zz-awj-uploads.ini
COPY www/ /var/www/html/
