from django.db import models
from django.contrib.auth.models import User
from routes.models import Route


class Favorite(models.Model):
    user = models.ForeignKey(
        User,
        related_name="favorite_routes",
        verbose_name="Пользователь",
        on_delete=models.CASCADE,
    )
    route = models.ForeignKey(
        Route,
        on_delete=models.CASCADE,
        related_name="favorites_by",
        verbose_name="Маршрут",
    )
    created_at = models.DateTimeField(
        auto_now_add=True, verbose_name="Дата добавления"
    )

    class Meta:
        unique_together = ("user", "route")
        verbose_name = "Изображение"
        verbose_name_plural = "Избранное"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.username} → {self.route.name}"


class Rating(models.Model):
    user = models.ForeignKey(
        User,
        related_name="interaction_ratings",
        verbose_name="Пользователь",
        on_delete=models.CASCADE,
    )
    route = models.ForeignKey(
        Route,
        on_delete=models.CASCADE,
        related_name="interaction_ratings",
        verbose_name="Маршрут",
    )
    score = models.PositiveIntegerField(
        choices=[(i, f'{i}') for i in range(1, 6)], verbose_name="Оценка"
    )
    created_at = models.DateTimeField(
        auto_now_add=True, verbose_name="Дата создания"
    )
    updated_at = models.DateTimeField(
        auto_now=True, verbose_name="Дата обновления"
    )

    class Meta:
        unique_together = ("user", "route")
        verbose_name = "Оценка"
        verbose_name_plural = "Оценки"

    def __str__(self):
        return f"{self.user.username} оценил {self.route.name} на {self.score}"


class Comment(models.Model):
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="interaction_comments",
        verbose_name="Пользователь",
    )
    route = models.ForeignKey(
        Route,
        on_delete=models.CASCADE,
        related_name="interaction_comments",
        verbose_name="Маршрут",
    )
    text = models.TextField(verbose_name="Текст комментария")
    created_at = models.DateTimeField(
        auto_now_add=True, verbose_name="Дата создания"
    )
    updated_at = models.DateTimeField(
        auto_now=True, verbose_name="Дата изменения"
    )

    class Meta:
        verbose_name = "Комментарий"
        verbose_name_plural = "Комментарии"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.username}: {self.text[:50]}"
