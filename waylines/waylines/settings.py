from importlib.metadata import FastPath
from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent


SECRET_KEY = (
    "django-insecure-r0#y!8!8l2+hqss+926&ke408+6n=xp=zir+0xz31ig6lq9fjp"
)
DEBUG = True

ALLOWED_HOSTS = ["127.0.0.1", "localhost"]


INSTALLED_APPS = [
    "channels",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.humanize",
    "routes.apps.RoutesConfig",
    "chat.apps.ChatConfig",
    "interactions.apps.InteractionsConfig",
    "users.apps.UsersConfig",
    "django_cleanup.apps.CleanupConfig",
    "ai_audio.apps.AiAudioConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
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
ASGI_APPLICATION = "waylines.asgi.application"

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
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
        "NAME": "django.contrib.auth."
                "password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth."
                "password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth."
                "password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth."
                "password_validation.NumericPasswordValidator",
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

STATICFILES_FINDERS = [
    "django.contrib.staticfiles.finders.FileSystemFinder",
    "django.contrib.staticfiles.finders.AppDirectoriesFinder",
]

MEDIA_URL = "/media/"
MEDIA_ROOT = os.path.join(BASE_DIR, "media")


STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

DOMAIN = "http://localhost:8000"
OPENAI_API_KEY = os.getenv(
    "OPENAI_API_KEY",
    "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",
)
YANDEX_TTS_API_KEY = os.getenv("YANDEX_TTS_API_KEY", "your-yandex-key-here")
GOOGLE_APPLICATION_CREDENTIALS = os.getenv(
    "GOOGLE_APPLICATION_CREDENTIALS", "path-to-google-credentials.json"
)

DATA_UPLOAD_MAX_MEMORY_SIZE = 20 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 20 * 1024 * 1024
