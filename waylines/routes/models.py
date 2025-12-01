__all__ = ()

from django.contrib.auth.models import User
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models
import qrcode
from io import BytesIO
from django.core.files import File
from django.urls import reverse


class Route(models.Model):
    PRIVACY_CHOICES = [
        ("public", "Публичный"),
        ("private", "Приватный"),
        ("link", "По ссылке"),
        ("personal", "Персональный"),
    ]

    ROUTE_TYPE_CHOICES = [
        ("driving", "Автомобильный"),
        ("walking", "Пеший"),
        ("cycling", "Велосипедный"),
        ("mixed", "Смешанный"),
    ]

    MOOD_CHOICES = [
        ("calm", "Спокойный"),
        ("active", "Активный"),
        ("extreme", "Экстремальный"),
        ("romantic", "Романтический"),
        ("family", "Семейный"),
        ("adventure", "Приключенческий"),
    ]

    THEME_CHOICES = [
        ("historical", "Исторический"),
        ("nature", "Природный"),
        ("urban", "Городской"),
        ("cultural", "Культурный"),
        ("gastronomic", "Гастрономический"),
        ("religious", "Религиозный"),
        ("architectural", "Архитектурный"),
    ]

    author = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="routes",
        verbose_name="Автор",
    )
    name = models.CharField("Название", max_length=200)
    description = models.TextField("Описание", blank=True)
    short_description = models.TextField(
        "Краткое описание", max_length=300, blank=True
    )
    privacy = models.CharField(
        "Приватность", max_length=20, choices=PRIVACY_CHOICES, default="public"
    )
    route_type = models.CharField(
        "Тип маршрута",
        max_length=20,
        choices=ROUTE_TYPE_CHOICES,
        default="walking",
    )
    mood = models.CharField(
        "Настроение", max_length=20, choices=MOOD_CHOICES, blank=True
    )
    theme = models.CharField(
        "Тема", max_length=20, choices=THEME_CHOICES, blank=True
    )
    duration_minutes = models.IntegerField(
        "Продолжительность (минут)", default=0
    )
    country = models.CharField(
        max_length=100, blank=True, null=True, verbose_name="Страна"
    )
    total_distance = models.FloatField("Общее расстояние (км)", default=0)
    is_active = models.BooleanField("Актуален", default=True)
    has_audio_guide = models.BooleanField("Есть аудиогид", default=False)
    is_elderly_friendly = models.BooleanField("Для пожилых", default=False)
    shared_with = models.ManyToManyField(
        User,
        related_name="shared_routes",
        blank=True,
        verbose_name="Доступно для",
    )
    created_at = models.DateTimeField("Создан", auto_now_add=True)
    updated_at = models.DateTimeField("Обновлён", auto_now=True)
    last_status_update = models.DateTimeField(
        "Последнее обновление статуса", auto_now=True
    )

    qr_code = models.ImageField(
        upload_to="qr_codes/", blank=True, null=True, verbose_name="QR код"
    )

    class Meta:
        verbose_name = "Маршрут"
        verbose_name_plural = "Маршруты"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} (ID: {self.id})"

    def get_average_rating(self):
        ratings = self.ratings.all()
        if ratings:
            return sum(r.rating for r in ratings) / len(ratings)
        return 0

    def get_absolute_url(self):
        from django.urls import reverse

        return reverse("route_detail", kwargs={"route_id": self.id})

    def generate_qr_code(self, request=None):
        """Генерация QR кода для маршрута"""
        if self.qr_code:
            return self.qr_code.url

        # Генерируем полный URL маршрута
        if request:
            full_url = request.build_absolute_uri(self.get_absolute_url())
        else:
            # Fallback - используем домен из настроек
            from django.conf import settings

            domain = getattr(settings, "DOMAIN", "http://localhost:8000")
            full_url = f"{domain}{self.get_absolute_url()}"

        # Создаем QR код
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=10,
            border=4,
        )
        qr.add_data(full_url)
        qr.make(fit=True)

        # Создаем изображение
        img = qr.make_image(fill_color="black", back_color="white")

        # Сохраняем в BytesIO
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        # Создаем файл для Django
        filename = f"qr_code_route_{self.id}.png"
        self.qr_code.save(filename, File(buffer), save=False)
        self.save()

        return self.qr_code.url

    def save(self, *args, **kwargs):
        # При сохранении генерируем QR код если его нет
        if not self.qr_code and self.id:
            super().save(*args, **kwargs)
            # Генерацию QR кода делаем отдельно, так как нужен request для полного URL
        else:
            super().save(*args, **kwargs)


class RoutePhoto(models.Model):
    route = models.ForeignKey(
        Route,
        on_delete=models.CASCADE,
        related_name="photos",
        verbose_name="Маршрут",
    )
    image = models.ImageField("Фото", upload_to="route_photos/")
    caption = models.CharField("Подпись", max_length=255, blank=True)
    order = models.PositiveIntegerField("Порядок", default=0)
    created_at = models.DateTimeField("Создано", auto_now_add=True)

    class Meta:
        verbose_name = "Фото маршрута"
        verbose_name_plural = "Фото маршрута"
        ordering = ["order"]

    def __str__(self):
        return f"Фото для {self.route.name}"


class RouteRating(models.Model):
    route = models.ForeignKey(
        Route,
        on_delete=models.CASCADE,
        related_name="ratings",
        verbose_name="Маршрут",
    )
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, verbose_name="Пользователь"
    )
    rating = models.IntegerField(
        "Оценка", validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    comment = models.TextField("Комментарий", blank=True)
    created_at = models.DateTimeField("Создано", auto_now_add=True)

    class Meta:
        verbose_name = "Оценка маршрута"
        verbose_name_plural = "Оценки маршрута"
        unique_together = ["route", "user"]

    def __str__(self):
        return f"{self.rating}★ для {self.route.name}"


class RouteFavorite(models.Model):
    route = models.ForeignKey(
        Route,
        on_delete=models.CASCADE,
        related_name="favorites",
        verbose_name="Маршрут",
    )
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, verbose_name="Пользователь"
    )
    created_at = models.DateTimeField("Добавлено", auto_now_add=True)

    class Meta:
        verbose_name = "Избранный маршрут"
        verbose_name_plural = "Избранные маршруты"
        unique_together = ["route", "user"]

    def __str__(self):
        return f"{self.user.username} → {self.route.name}"


class RoutePoint(models.Model):
    CATEGORY_CHOICES = [
        ("attraction", "Изюминка"),
        ("nature", "Естественная"),
        ("forest", "Лес"),
        ("bus_stop", "Автобусная остановка"),
        ("viewpoint", "Смотровая площадка"),
        ("restaurant", "Ресторан"),
        ("hotel", "Отель"),
        ("museum", "Музей"),
        ("park", "Парк"),
        ("monument", "Памятник"),
        ("church", "Храм"),
        ("beach", "Пляж"),
    ]

    route = models.ForeignKey(
        Route,
        on_delete=models.CASCADE,
        related_name="points",
        verbose_name="Маршрут",
    )
    name = models.CharField("Название", max_length=200)
    description = models.TextField("Описание", blank=True)
    address = models.TextField("Адрес", blank=True)
    latitude = models.FloatField(
        "Широта",
        validators=[MinValueValidator(-90.0), MaxValueValidator(90.0)],
    )
    longitude = models.FloatField(
        "Долгота",
        validators=[MinValueValidator(-180.0), MaxValueValidator(180.0)],
    )
    elevation = models.FloatField("Высота", null=True, blank=True)
    category = models.CharField(
        "Категория", max_length=20, choices=CATEGORY_CHOICES, blank=True
    )
    hint_author = models.CharField(
        "Автор подсказки", max_length=100, blank=True
    )
    tags = models.JSONField("Теги", default=list, blank=True)
    order = models.PositiveIntegerField("Порядок", default=0)
    has_panorama = models.BooleanField("Есть панорама", default=False)
    audio_guide = models.FileField(
        "Аудиогид", upload_to="point_audio/", blank=True, null=True
    )
    created_at = models.DateTimeField("Создано", auto_now_add=True)

    class Meta:
        verbose_name = "Точка маршрута"
        verbose_name_plural = "Точки маршрута"
        ordering = ["order"]

    def __str__(self):
        return f"{self.name} (lat: {self.latitude}, lng: {self.longitude})"


class PointPhoto(models.Model):
    point = models.ForeignKey(
        RoutePoint,
        on_delete=models.CASCADE,
        related_name="photos",
        verbose_name="Точка маршрута",
    )
    image = models.ImageField("Фото", upload_to="point_photos/")
    caption = models.CharField("Подпись", max_length=255, blank=True)
    order = models.PositiveIntegerField("Порядок", default=0)
    created_at = models.DateTimeField("Создано", auto_now_add=True)

    class Meta:
        verbose_name = "Фото точки"
        verbose_name_plural = "Фото точки"
        ordering = ["order"]

    def __str__(self):
        return f"Фото для {self.point.name}"


class PointComment(models.Model):
    point = models.ForeignKey(
        RoutePoint,
        on_delete=models.CASCADE,
        related_name="comments",
        verbose_name="Точка",
    )
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, verbose_name="Пользователь"
    )
    text = models.TextField("Текст комментария")
    created_at = models.DateTimeField("Создан", auto_now_add=True)
    updated_at = models.DateTimeField("Обновлён", auto_now=True)

    class Meta:
        verbose_name = "Комментарий точки"
        verbose_name_plural = "Комментарии точки"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Комментарий {self.user.username} для {self.point.name}"


class RouteComment(models.Model):
    route = models.ForeignKey(
        Route,
        on_delete=models.CASCADE,
        related_name="comments",
        verbose_name="Маршрут",
    )
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, verbose_name="Пользователь"
    )
    text = models.TextField("Текст комментария")
    created_at = models.DateTimeField("Создан", auto_now_add=True)
    updated_at = models.DateTimeField("Обновлён", auto_now=True)

    class Meta:
        verbose_name = "Комментарий маршрута"
        verbose_name_plural = "Комментарии маршрута"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Комментарий {self.user.username} для {self.route.name}"


class UserVisitedPoint(models.Model):
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="visited_points",
        verbose_name="Пользователь",
    )
    point = models.ForeignKey(
        RoutePoint, on_delete=models.CASCADE, verbose_name="Точка"
    )
    visited_at = models.DateTimeField("Посещено", auto_now_add=True)

    class Meta:
        verbose_name = "Посещенная точка"
        verbose_name_plural = "Посещенные точки"
        unique_together = ["user", "point"]

    def __str__(self):
        return f"{self.user.username} посетил {self.point.name}"


class SavedPlace(models.Model):
    CATEGORY_CHOICES = [
        ("home", "Дом"),
        ("work", "Работа"),
        ("favorite", "Избранное"),
        ("restaurant", "Ресторан"),
        ("park", "Парк"),
        ("shop", "Магазин"),
        ("hotel", "Отель"),
        ("other", "Другое"),
    ]

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="saved_places",
        verbose_name="Пользователь",
    )
    name = models.CharField("Название", max_length=200)
    category = models.CharField(
        "Категория", max_length=20, choices=CATEGORY_CHOICES, default="other"
    )
    address = models.TextField("Адрес")
    latitude = models.FloatField(
        "Широта",
        validators=[MinValueValidator(-90.0), MaxValueValidator(90.0)],
    )
    longitude = models.FloatField(
        "Долгота",
        validators=[MinValueValidator(-180.0), MaxValueValidator(180.0)],
    )
    notes = models.TextField("Заметки", blank=True)
    created_at = models.DateTimeField("Создано", auto_now_add=True)

    class Meta:
        verbose_name = "Сохраненное место"
        verbose_name_plural = "Сохраненные места"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.user.username})"
