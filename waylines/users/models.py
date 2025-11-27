from django.contrib.auth.models import User
from django.db import models

class Friendship(models.Model):
    STATUS_CHOICES = [
        ("pending", "В ожидании"),
        ("accepted", "Принято"),
        ("rejected", "Отклонено"),
    ]

    from_user = models.ForeignKey(
        User, related_name="friendship_requests_sent", on_delete=models.CASCADE
    )
    to_user = models.ForeignKey(
        User,
        related_name="friendship_requests_received",
        on_delete=models.CASCADE,
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ["from_user", "to_user"]
        verbose_name = "Дружба"
        verbose_name_plural = "Дружбы"


class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    bio = models.TextField("О себе", blank=True)
    avatar = models.ImageField("Аватар", upload_to="avatars/", blank=True)
    location = models.CharField("Местоположение", max_length=100, blank=True)
    website = models.URLField("Веб-сайт", blank=True)
    created_at = models.DateTimeField("Создан", auto_now_add=True)
    updated_at = models.DateTimeField("Обновлён", auto_now=True)

    class Meta:
        verbose_name = "Профиль пользователя"
        verbose_name_plural = "Профили пользователей"

    def __str__(self):
        return f"Профиль {self.user.username}"

