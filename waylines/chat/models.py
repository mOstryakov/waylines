__all__ = ('Conversation', 'PrivateMessage', 'RouteChat', 'RouteChatMessage')

from django.db import models
from django.contrib.auth.models import User
from django.db.models.signals import post_save
from django.dispatch import receiver
from routes.models import Route


class Conversation(models.Model):
    """Диалог между двумя пользователями"""
    participants = models.ManyToManyField(User, related_name='conversations')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Диалог"
        verbose_name_plural = "Диалоги"
        ordering = ['-updated_at']

    def __str__(self):
        participants = self.participants.all()
        return f"Диалог: {', '.join([p.username for p in participants])}"

    def get_other_participant(self, user):
        """Получить второго участника диалога"""
        return self.participants.exclude(id=user.id).first()

    def get_other_participant_id(self, user):
        """Получить ID второго участника диалога"""
        other = self.get_other_participant(user)
        return other.id if other else None

    def get_unread_count(self, user):
        """Получить количество непрочитанных сообщений для пользователя"""
        return self.messages.exclude(sender=user).filter(is_read=False).count()

    def get_last_message(self):
        """Получить последнее сообщение"""
        return self.messages.order_by('-created_at').first()

    def mark_messages_as_read(self, user):
        """Пометить все сообщения как прочитанные для пользователя"""
        self.messages.exclude(sender=user).filter(is_read=False).update(is_read=True)


class PrivateMessage(models.Model):
    """Личное сообщение между пользователями"""
    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        related_name='messages',
        verbose_name="Диалог"
    )
    sender = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='sent_messages',
        verbose_name="Отправитель"
    )
    content = models.TextField("Сообщение", max_length=1000)
    is_read = models.BooleanField("Прочитано", default=False)
    created_at = models.DateTimeField("Создано", auto_now_add=True)

    class Meta:
        verbose_name = "Личное сообщение"
        verbose_name_plural = "Личные сообщения"
        ordering = ['created_at']

    def __str__(self):
        return f"{self.sender.username}: {self.content[:50]}"

    def save(self, *args, **kwargs):
        """Переопределяем save для обновления времени беседы"""
        from django.utils import timezone
        if self.conversation and (not self.pk or kwargs.get('force_insert')):
            self.conversation.updated_at = timezone.now()
            self.conversation.save()
        super().save(*args, **kwargs)


class RouteChat(models.Model):
    """Чат для маршрута"""
    route = models.OneToOneField(
        Route,
        on_delete=models.CASCADE,
        related_name='chat',
        verbose_name="Маршрут"
    )
    is_active = models.BooleanField("Активен", default=True)
    created_at = models.DateTimeField("Создан", auto_now_add=True)
    updated_at = models.DateTimeField("Обновлён", auto_now=True)

    class Meta:
        verbose_name = "Чат маршрута"
        verbose_name_plural = "Чаты маршрутов"
        ordering = ['-updated_at']

    def __str__(self):
        return f"Чат маршрута: {self.route.name}"

    def get_last_message(self):
        """Получить последнее сообщение"""
        return self.messages.order_by('-timestamp').first()

    def get_unread_count(self, user):
        """Получить количество непрочитанных сообщений для пользователя"""
        return self.messages.exclude(user=user).filter(is_read=False).count()


class RouteChatMessage(models.Model):
    """Сообщение в чате маршрута"""
    route_chat = models.ForeignKey(
        RouteChat,
        on_delete=models.CASCADE,
        related_name='messages',
        verbose_name="Чат маршрута"
    )
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        verbose_name="Пользователь"
    )
    message = models.TextField("Сообщение", max_length=1000)
    timestamp = models.DateTimeField("Время", auto_now_add=True)
    is_read = models.BooleanField("Прочитано", default=False)

    class Meta:
        verbose_name = "Сообщение чата маршрута"
        verbose_name_plural = "Сообщения чатов маршрутов"
        ordering = ['timestamp']

    def __str__(self):
        return f"{self.user.username} в {self.route_chat.route.name}: {self.message[:50]}"

    def save(self, *args, **kwargs):
        """Переопределяем save для обновления времени чата"""
        from django.utils import timezone
        if self.route_chat and (not self.pk or kwargs.get('force_insert')):
            self.route_chat.updated_at = timezone.now()
            self.route_chat.save()
        super().save(*args, **kwargs)


# Сигналы для автоматического создания чатов
@receiver(post_save, sender=Route)
def create_route_chat(sender, instance, created, **kwargs):
    """Автоматически создаем чат при создании маршрута"""
    if created:
        RouteChat.objects.create(route=instance)