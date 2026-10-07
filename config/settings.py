"""
Django settings for the messaging platform project.

Development-oriented defaults with production-ready structure:
secrets read from environment (optionally via a .env file), secure cookie
flags toggleable via DEBUG.
"""

import os
from urllib.parse import parse_qsl, urlparse
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - python-dotenv is in requirements
    def load_dotenv(*args, **kwargs):
        return False

BASE_DIR = Path(__file__).resolve().parent.parent

# Load .env from the project root if present (development convenience;
# real deployments should set environment variables directly).
load_dotenv(BASE_DIR / '.env')

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.environ.get(
    'DJANGO_SECRET_KEY',
    'django-insecure-d!_e((-r$2&6zpleky+tyt8c5@k6u06if@g)q50j6#t6cjdu%t',
)

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = os.environ.get('DJANGO_DEBUG', '1') == '1'

ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get(
        'DJANGO_ALLOWED_HOSTS',
        'localhost,127.0.0.1,192.168.1.166',
    ).split(',')
    if host.strip()
]
if DEBUG:
    # Sandboxed previews and tunnels (e.g. *.e2b.app) expose the app on
    # arbitrary subdomains, so in development we accept any host. Production
    # must always set DJANGO_ALLOWED_HOSTS explicitly.
    ALLOWED_HOSTS.append('*')

# Cloud/preview proxies forward the app under a different scheme+host than
# the local bind. Trust X-Forwarded-Proto so CSRF's origin/referer checks see
# the externally visible origin, and register forwarded origins (received via
# DJANGO_CSRF_TRUSTED_ORIGINS) as CSRF-trusted.
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')


def _split_env(name):
    return [item.strip() for item in os.environ.get(name, '').split(',') if item.strip()]


CSRF_TRUSTED_ORIGINS = ['http://localhost:8000', 'http://127.0.0.1:8000']
CORS_ALLOWED_ORIGINS = [
    'http://localhost:8081', 'http://127.0.0.1:8081', 'http://192.168.1.166:8081',
    'http://localhost:19006', 'http://127.0.0.1:19006', 'http://192.168.1.166:19006',
]
CSRF_TRUSTED_ORIGINS += _split_env('DJANGO_CSRF_TRUSTED_ORIGINS')
CORS_ALLOWED_ORIGINS += _split_env('DJANGO_CORS_ALLOWED_ORIGINS')

# Render injects RENDER_EXTERNAL_URL automatically; trust that origin so
# logins/CSRF work without extra configuration after a deploy.
_render_external_url = os.environ.get('RENDER_EXTERNAL_URL', '').rstrip('/')
if _render_external_url:
    _render_host = urlparse(_render_external_url).hostname
    if _render_host and _render_host not in ALLOWED_HOSTS:
        ALLOWED_HOSTS.append(_render_host)
    if _render_external_url not in CSRF_TRUSTED_ORIGINS:
        CSRF_TRUSTED_ORIGINS.append(_render_external_url)

# Freebuff preview sandboxes are HTTPS proxies whose host changes per
# session; while DEBUG is on, trust them so sign-up/login forms work in
# the preview without manual configuration.
if DEBUG:
    if '.e2b.app' not in ALLOWED_HOSTS:
        ALLOWED_HOSTS.append('.e2b.app')
    if 'https://*.e2b.app' not in CSRF_TRUSTED_ORIGINS:
        CSRF_TRUSTED_ORIGINS.append('https://*.e2b.app')

# Application definition

INSTALLED_APPS = [
    'daphne',  # must come before django.contrib.staticfiles
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django.contrib.sitemaps',
    'corsheaders',
    'rest_framework',
    'rest_framework.authtoken',
    'channels',
    # Local apps
    'accounts',
    'messaging',
]

MIDDLEWARE = [
    'config.csrf_proxy.ProxySchemeFixMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

# Channels: keep the zero-dependency in-memory layer for development, but use
# Redis whenever a deployment supplies CHANNEL_REDIS_URL.
CHANNEL_REDIS_URL = os.environ.get('CHANNEL_REDIS_URL', '').strip()
CHANNEL_LAYERS = {
    'default': (
        {'BACKEND': 'channels_redis.core.RedisChannelLayer', 'CONFIG': {'hosts': [CHANNEL_REDIS_URL]}}
        if CHANNEL_REDIS_URL else
        {'BACKEND': 'channels.layers.InMemoryChannelLayer'}
    ),
}

# Database: SQLite by default; DATABASE_URL enables PostgreSQL/MySQL deployments.

DATABASE_URL = os.environ.get('DATABASE_URL', '').strip()
if DATABASE_URL:
    parsed_database = urlparse(DATABASE_URL)
    database_engine = {
        'postgres': 'django.db.backends.postgresql',
        'postgresql': 'django.db.backends.postgresql',
        'mysql': 'django.db.backends.mysql',
    }.get(parsed_database.scheme)
    if not database_engine:
        raise ValueError('DATABASE_URL must use postgres, postgresql, or mysql.')
    DATABASES = {
        'default': {
            'ENGINE': database_engine,
            'NAME': parsed_database.path.lstrip('/'),
            'USER': parsed_database.username or '',
            'PASSWORD': parsed_database.password or '',
            'HOST': parsed_database.hostname or '',
            'PORT': str(parsed_database.port or ''),
            **dict(parse_qsl(parsed_database.query)),
        },
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

# Authentication

AUTH_USER_MODEL = 'accounts.User'

LOGIN_URL = 'accounts:login'
LOGIN_REDIRECT_URL = 'messaging:conversations'
LOGOUT_REDIRECT_URL = 'accounts:login'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# REST Framework

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
        'rest_framework.authentication.TokenAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_PAGINATION_CLASS': None,
    'DEFAULT_THROTTLE_RATES': {
        # Burst protection for writes; generous reads for chat UX.
        'messages': '120/minute',
        'search': '60/minute',
        'auth': '20/minute',
        # Contact matching is an enumeration risk: keep it tight.
        'contact_match': '20/minute',
    },
}

# Phone-number handling

# Region used to interpret numbers entered without a country code.
DEFAULT_PHONE_REGION = os.environ.get('DEFAULT_PHONE_REGION', 'US')

# Internationalization

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

# Static files
STATIC_URL = 'static/'
STATICFILES_DIRS = [BASE_DIR / 'static']
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

# User uploads (profile pictures)
MEDIA_URL = 'media/'
MEDIA_ROOT = BASE_DIR / 'media'

# Push notifications (Expo). EXPO_ACCESS_TOKEN is optional — tokenless
# pushes are allowed at lower rates. EXPO_PUSH_URL is for tests.
EXPO_ACCESS_TOKEN = os.environ.get('EXPO_ACCESS_TOKEN', '').strip() or None
EXPO_PUSH_URL = os.environ.get('EXPO_PUSH_URL', '').strip() or None

# SEO: absolute site URL used for canonical links, Open Graph, sitemap and
# robots.txt. Derive a safe default from CSRF/allowed-hosts configuration.
SITE_URL = os.environ.get('SITE_URL', '').strip().rstrip('/')
if not SITE_URL:
    _seo_origin = ''
    for _origin in CSRF_TRUSTED_ORIGINS:
        # Skip wildcard origins (e.g. https://*.sandbox.example): a literal
        # '*' would produce an invalid canonical URL.
        if _origin.startswith('https://') and '*' not in _origin:
            _seo_origin = _origin
            break
    SITE_URL = _seo_origin or 'http://127.0.0.1:8000'

# Google Search Console verification token (optional). Set the env var to the
# "google-site-verification" content value from Search Console; it renders as
# <meta name="google-site-verification" content="..."> on public pages.
GOOGLE_SITE_VERIFICATION = os.environ.get('GOOGLE_SITE_VERIFICATION', '').strip()

# Bing Webmaster Tools verification token (optional, same mechanism).
BING_SITE_VERIFICATION = os.environ.get('BING_SITE_VERIFICATION', '').strip()

# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Security hardening (full effect in production when DEBUG=False)
if not DEBUG:
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_REFERRER_POLICY = 'same-origin'
else:
    # Allow plain-http localhost while keeping CSRF protections active
    pass

X_FRAME_OPTIONS = 'DENY'
SECURE_CONTENT_TYPE_NOSNIFF = True
SESSION_COOKIE_HTTPONLY = True

# Email: console backend by default; configure SMTP in production.
EMAIL_BACKEND = os.environ.get(
    'EMAIL_BACKEND',
    'django.core.mail.backends.console.EmailBackend',
)
EMAIL_HOST = os.environ.get('EMAIL_HOST', '')
EMAIL_PORT = int(os.environ.get('EMAIL_PORT', '587'))
EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', '')
EMAIL_HOST_PASSWORD_FILE = os.environ.get('EMAIL_HOST_PASSWORD_FILE', '')
if not EMAIL_HOST_PASSWORD and EMAIL_HOST_PASSWORD_FILE:
    password_path = BASE_DIR / EMAIL_HOST_PASSWORD_FILE
    if password_path.is_file():
        EMAIL_HOST_PASSWORD = ''.join(
            password_path.read_text(encoding='utf-8').split(),
        )
EMAIL_USE_TLS = os.environ.get('EMAIL_USE_TLS', '1') == '1'
DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL', 'no-reply@chatapp.local')
