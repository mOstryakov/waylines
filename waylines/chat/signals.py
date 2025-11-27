from django.db.models.signals import post_save
from django.dispatch import receiver

from routes.models import Route
from .models import RouteChat


@receiver(post_save, sender=Route)
def create_route_chat(sender, instance, created, **kwargs):
    """Автоматически создаем чат при создании маршрута"""
    if created:
        RouteChat.objects.create(route=instance)
