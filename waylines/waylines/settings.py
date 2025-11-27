from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent



SECRET_KEY = "django-insecure-r0#y!8!8l2+hqss+926&ke408+6n=xp=zir+0xz31ig6lq9fjp"

DEBUG = True

ALLOWED_HOSTS = ["127.0.0.1", "localhost"]



INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "channels",
    "routes.apps.RoutesConfig",
    "chat.apps.ChatConfig",
    "users.apps.UsersConfig",
    "django_cleanup.apps.CleanupConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "waylines.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "users.context_processors.navbar_context",
            ],
        },
    },
]

WSGI_APPLICATION = "waylines.wsgi.application"
ASGI_APPLICATION = 'waylines.asgi.application'

CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels.layers.InMemoryChannelLayer',
    },
}

# CHANNEL_LAYERS = {
#     'default': {
#         'BACKEND': 'channels_redis.core.RedisChannelLayer',
#         'CONFIG': {
#             "hosts": [('127.0.0.1', 6379)],
#         },
#     },
# }



DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}




AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]



LANGUAGE_CODE = "ru-ru"
USE_I18N = True

TIME_ZONE = "UTC"
USE_TZ = True

USE_L10N = True
LOCALE_PATHS = [
    BASE_DIR / "locale",
]

LANGUAGES = [
    ("ru-ru", "Русский"),
    ("en-us", "English"),
]




DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

STATIC_URL = "/static/"

STATICFILES_DIRS = [
    BASE_DIR / "static_dev",
]

static_path = BASE_DIR / "static"
if static_path.exists():
    STATICFILES_DIRS.append(static_path)

STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
