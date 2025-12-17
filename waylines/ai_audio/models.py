from django.db import models
from django.contrib.auth.models import User
from routes.models import RoutePoint, Route


class AudioGeneration(models.Model):
    STATUS_CHOICES = [
        ("pending", "В ожидании"),
        ("processing", "Обрабатывается"),
        ("completed", "Завершено"),
        ("failed", "Ошибка"),
    ]

    VOICE_CHOICES = [
        ("alloy", "Alloy (нейтральный)"),
        ("echo", "Echo (мужской)"),
        ("fable", "Fable (сказочный)"),
        ("onyx", "Onyx (глубокий)"),
        ("nova", "Nova (женский)"),
        ("shimmer", "Shimmer (легкий)"),
    ]

    LANGUAGE_CHOICES = [
        ("auto", "Автоопределение"),
        ("ru-RU", "Русский"),
        ("en-US", "Английский"),
        ("es-ES", "Испанский"),
        ("fr-FR", "Французский"),
        ("de-DE", "Немецкий"),
    ]

    point = models.ForeignKey(
        RoutePoint, on_delete=models.CASCADE, related_name="audio_generations"
    )
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default="pending"
    )
    voice_type = models.CharField(
        max_length=20, choices=VOICE_CHOICES, default="alloy"
    )
    language = models.CharField(
        max_length=10, choices=LANGUAGE_CHOICES, default="auto"
    )
    audio_file = models.FileField(
        upload_to="audio_guides/%Y/%m/%d/", null=True, blank=True
    )
    text_content = models.TextField()
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    processing_time = models.FloatField(null=True, blank=True)
    is_route_audio = models.BooleanField(
        default=False, verbose_name="Аудио всего маршрута"
    )
    route = models.ForeignKey(
        Route,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="audio_generations",
    )

    class Meta:
        db_table = "ai_audio_generations"
        verbose_name = "Генерация аудио"
        verbose_name_plural = "Генерации аудио"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Аудио для {self.point.name} ({self.get_status_display()})"


class RouteAudioGuide(models.Model):
    route = models.OneToOneField(
        Route, on_delete=models.CASCADE, related_name="full_audio_guide"
    )
    audio_file = models.FileField(
        upload_to="route_audio_guides/%Y/%m/%d/", null=True, blank=True
    )
    total_points = models.IntegerField(default=0)
    total_duration = models.FloatField(default=0)
    status = models.CharField(
        max_length=20,
        choices=[
            ("processing", "Формируется"),
            ("completed", "Завершено"),
            ("failed", "Ошибка"),
        ],
        default="processing",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Аудиогид маршрута"
        verbose_name_plural = "Аудиогиды маршрутов"

    def __str__(self):
        return f"Аудиогид для {self.route.name}"


class VoiceProfile(models.Model):
    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name="voice_profile"
    )
    preferred_voice = models.CharField(
        max_length=20, choices=AudioGeneration.VOICE_CHOICES, default="alloy"
    )
    preferred_language = models.CharField(
        max_length=10, choices=AudioGeneration.LANGUAGE_CHOICES, default="auto"
    )
    auto_generate = models.BooleanField(
        default=False,
        help_text="Автоматически генерировать аудио для новых точек",
    )

    class Meta:
        verbose_name = "Голосовой профиль"
        verbose_name_plural = "Голосовые профили"

    def __str__(self):
        return f"Голосовой профиль {self.user.username}"
